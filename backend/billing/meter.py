"""Electricity meter readings, and how a bill charges the units between them.

A tenancy's meter is measured from its baseline (Tenancy.meter_baseline_reading, entered in
admin, and when it was recorded, set by the server). Readings are recorded on the day they're
taken, from the day the baseline was recorded on, never below an earlier one or above a later
one, and never create, change or settle a bill.

A bill that charges electricity from the meter (RentEntry.ElectricityMode.METER) is measured
from the **last billed reading**, the closing reading of the tenancy's latest active meter
bill (or the baseline when there's none), to a later reading. A bill that leaves electricity
off (NOT_CHARGED) moves nothing, so the units it skipped are charged by the next meter bill:
October billed at 2563, November read at 2876 but not charged, December billed at 2985 charges
422 units. Unique constraints on the bills' readings (RentEntry.Meta), checked here first under
the tenancy's lock, keep the active meter bills one unbroken chain, so no stretch of the meter
is billed twice or lost.

Corrections never change a bill silently: a reading an active bill is measured from can't be
voided or corrected until that bill is voided (after its payments are reversed), newest first.
Nor do they leave a reading entered as units stale: units are added to the reading before, so
that one can't change until the units-entered readings after it are voided, newest first.

Lock order: the tenancy (FOR UPDATE: the same lock as creating a bill, so readings and bills
of one tenancy are written one at a time), then the reading.
"""

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from properties.models import Tenancy, business_date
from properties.queries import properties_for_user
from properties.roles import Capability, role_can

from .models import MeterReading, RentEntry

READING_DAY_CONSTRAINT = "unique_active_meter_reading_per_day"
READING_KEY_CONSTRAINT = "unique_meter_reading_idempotency_key"


class ReadingNotFoundError(Exception):
    """No such tenancy or reading, or the actor can't access its property."""


class ReadingNotAllowedError(Exception):
    """The actor's role can't record or correct meter readings."""


class MeterNotSetUpError(Exception):
    """The tenancy has no meter baseline yet (it's set in admin)."""


class InvalidReadingError(Exception):
    """The reading doesn't fit the tenancy's meter: a date outside the occupancy, before the
    baseline or in the future, or a value below an earlier reading or above a later one."""

    def __init__(self, field: str, detail: str):
        super().__init__(detail)
        self.field = field
        self.detail = detail


class DuplicateReadingDayError(Exception):
    """The tenancy already has an active reading on that day."""


class ReadingIdempotencyConflictError(Exception):
    """The key was already used for a different reading request."""


class ReadingVoidError(Exception):
    """The reading is void: it can't be voided, corrected or billed."""


class ReadingVoidConflictError(Exception):
    """The reading was already voided, with another reason."""


class ReadingInUseError(Exception):
    """Active bills are measured from this reading. entries: every bill to void first (those
    and the meter bills after them), newest first."""

    def __init__(self, entries: list[RentEntry]):
        super().__init__(f"{len(entries)} bill(s) are measured from this reading.")
        self.entries = entries


class ReadingFeedsUnitsError(Exception):
    """Readings entered as units are worked out from this reading, so changing it would leave
    their totals stale. readings: those to void first, newest first."""

    def __init__(self, readings: list[MeterReading]):
        super().__init__(f"{len(readings)} reading(s) were worked out from this one.")
        self.readings = readings


class NothingToCorrectReadingError(Exception):
    """The replacement has the same reading, date and notes as the reading it corrects."""


class ClosingReadingRequiredError(Exception):
    """Charging electricity from the meter needs a closing reading."""


class ReadingAlreadyBilledError(Exception):
    """The chosen closing reading isn't after the last billed reading."""

    def __init__(self, last: "MeterPoint | None"):
        super().__init__(
            "These readings are already billed."
            if last is None
            else f"Electricity is billed up to {last.reading} on {last.read_on}."
        )
        self.last = last


class LaterMeterBillError(Exception):
    """A later meter bill is measured from this bill's closing reading: void that one first."""

    def __init__(self, entry: RentEntry):
        super().__init__(f"The {entry.billing_month:%B %Y} bill is measured from this one.")
        self.entry = entry


@dataclass(frozen=True)
class MeterPoint:
    """A reading on the meter: a recorded reading (reading_id) or the baseline (None)."""

    reading: Decimal
    read_on: date
    reading_id: uuid.UUID | None


@dataclass(frozen=True)
class RecordedReading:
    reading: MeterReading
    # False when the key's reading already existed: a retry, nothing was recorded now.
    created: bool


@dataclass(frozen=True)
class VoidedReading:
    reading: MeterReading
    created: bool


@dataclass(frozen=True)
class CorrectedReading:
    original: MeterReading
    replacement: MeterReading
    created: bool


@dataclass(frozen=True)
class ElectricityCharge:
    """What a new bill's electricity is: its mode, units and the readings measured between."""

    mode: str
    units: Decimal
    opening: MeterPoint | None = None
    closing: MeterReading | None = None


def _violated_constraint(error: IntegrityError) -> str | None:
    diag = getattr(error.__cause__, "diag", None)
    return getattr(diag, "constraint_name", None)


def _fingerprint(request: dict) -> str:
    return hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()


def _reading_fingerprint(
    tenancy_id, value: Decimal | None, read_on: date, notes: str, replaces=None, *, units=None
):
    """The request, not the reading worked out from it: units entered are fingerprinted as
    units (the reading they become depends on the meter at the time)."""
    request = {
        "tenancy_id": str(tenancy_id),
        "read_on": read_on.isoformat(),
        "notes": notes,
        "replaces": None if replaces is None else str(replaces),
    }
    if units is None:
        request["reading"] = f"{value:.3f}"
    else:
        request["units"] = f"{units:.3f}"
    return _fingerprint(request)


def _check_can_record_readings(actor, property_id) -> None:
    """No access is "not found", as for bills: the property's records never show."""
    role = (
        properties_for_user(actor).filter(pk=property_id).values_list("role", flat=True).first()
    )
    if role is None:
        raise ReadingNotFoundError()
    if not role_can(role, Capability.RECORD_READINGS):
        raise ReadingNotAllowedError()


def _lock_tenancy(tenancy_id) -> Tenancy:
    """FOR UPDATE, as creating a bill locks it: readings and bills of one tenancy are written
    one at a time, so each sees the other's last committed state."""
    try:
        return Tenancy.objects.select_for_update().get(pk=tenancy_id)
    except Tenancy.DoesNotExist:
        raise ReadingNotFoundError() from None


def baseline(tenancy: Tenancy) -> MeterPoint | None:
    if tenancy.meter_baseline_reading is None:
        return None
    return MeterPoint(tenancy.meter_baseline_reading, tenancy.meter_baseline_date(), None)


def last_billed(tenancy: Tenancy) -> MeterPoint | None:
    """Where the next meter bill starts: the closing reading of the latest active meter bill
    (the chain's end; readings only go up and each starts where the one before ended), else the
    baseline. None when the meter isn't set up."""
    start = baseline(tenancy)
    if start is None:
        return None
    latest = (
        RentEntry.objects.active()
        .filter(tenancy=tenancy, electricity_mode=RentEntry.ElectricityMode.METER)
        .select_related("closing_reading")
        .order_by("-closing_reading__read_on")
        .first()
    )
    if latest is None:
        return start
    closing = latest.closing_reading
    return MeterPoint(closing.reading, closing.read_on, closing.pk)


def latest_reading(tenancy: Tenancy) -> MeterPoint | None:
    """What the meter last said: the newest active reading, else the baseline. Units entered
    are added to it. None when the meter isn't set up."""
    start = baseline(tenancy)
    if start is None:
        return None
    newest = MeterReading.objects.active().filter(tenancy=tenancy).order_by("-read_on").first()
    if newest is None:
        return start
    return MeterPoint(newest.reading, newest.read_on, newest.pk)


# The largest reading the column holds (max_digits=10, decimal_places=3).
MAX_READING = Decimal("9999999.999")


def reading_from_units(tenancy: Tenancy, units: Decimal, read_on: date) -> Decimal:
    """The reading that units used since the latest reading make, on a tenancy the caller has
    locked. Units are always added to the newest reading, so they're dated after it (or on the
    baseline's day, when there's no reading yet): a backdated reading is entered as the reading
    itself."""
    latest = latest_reading(tenancy)
    if latest is None:
        raise MeterNotSetUpError()
    if units < 0:
        raise InvalidReadingError("units", "Units used can't be negative.")
    # A day no reading can have says why first, rather than that it's before the latest.
    _check_reading_date(tenancy, baseline(tenancy), read_on)
    from_baseline = latest.reading_id is None
    if read_on < latest.read_on or (read_on == latest.read_on and not from_baseline):
        raise InvalidReadingError(
            "readOn",
            f"Units are added to the latest reading, {latest.reading.normalize():f} on "
            f"{latest.read_on:%d %b %Y}: date them after it, or enter the meter reading.",
        )
    value = latest.reading + units
    if value > MAX_READING:
        raise InvalidReadingError("units", "That's more units than the meter can show.")
    return value


def _check_reading_date(tenancy: Tenancy, start: MeterPoint, read_on: date) -> None:
    """A reading's day: not ahead, within the tenancy, and not before tracking started."""
    if read_on > business_date():
        raise InvalidReadingError("readOn", "A reading can't be dated in the future.")
    if read_on < tenancy.start_date or (tenancy.end_date and read_on > tenancy.end_date):
        raise InvalidReadingError("readOn", "The reading's date must be within the tenancy.")
    if read_on < start.read_on:
        raise InvalidReadingError(
            "readOn",
            f"The reading can't be dated before meter tracking started on "
            f"{start.read_on:%d %b %Y}.",
        )


def _check_reading_fits(tenancy: Tenancy, value: Decimal, read_on: date, *, ignore=None) -> None:
    """The order checks every new reading passes, against the baseline and the tenancy's other
    active readings (`ignore` is the one being corrected)."""
    start = baseline(tenancy)
    if start is None:
        raise MeterNotSetUpError()
    if value < 0:
        raise InvalidReadingError("reading", "A meter reading can't be negative.")
    _check_reading_date(tenancy, start, read_on)
    if value < start.reading:
        raise InvalidReadingError(
            "reading", f"The reading can't be below the baseline of {start.reading.normalize()}."
        )

    others = MeterReading.objects.active().filter(tenancy=tenancy)
    if ignore is not None:
        others = others.exclude(pk=ignore)
    if others.filter(read_on=read_on).exists():
        raise DuplicateReadingDayError()
    before = others.filter(read_on__lt=read_on).order_by("-read_on").first()
    after = others.filter(read_on__gt=read_on).order_by("read_on").first()
    if before is not None and value < before.reading:
        raise InvalidReadingError(
            "reading",
            f"The reading can't be below {before.reading.normalize()}, read on "
            f"{before.read_on:%d %b %Y}.",
        )
    if after is not None and value > after.reading:
        raise InvalidReadingError(
            "reading",
            f"The reading can't be above {after.reading.normalize()}, read on "
            f"{after.read_on:%d %b %Y}.",
        )


def _replay_reading(*, idempotency_key, tenancy_id, actor, fingerprint) -> RecordedReading:
    existing = MeterReading.objects.get(idempotency_key=idempotency_key)
    if (
        existing.tenancy_id != tenancy_id
        or existing.created_by_id != actor.pk
        or existing.fingerprint != fingerprint
    ):
        raise ReadingIdempotencyConflictError()
    return RecordedReading(reading=existing, created=False)


def record_reading_locked(
    tenancy: Tenancy,
    *,
    actor,
    read_on: date,
    notes: str,
    idempotency_key,
    value: Decimal | None = None,
    units: Decimal | None = None,
) -> MeterReading:
    """Records a reading on a tenancy the caller has locked (_lock_tenancy, or bill creation's
    lock), after the order checks. Either the reading itself (value) or the units used since
    the latest reading (units: reading_from_units, worked out here under the lock, and kept
    as entered_units). Access is the caller's to check."""
    if (value is None) == (units is None):
        raise ValueError("A reading is entered as the reading or as units, not both.")
    fingerprint = _reading_fingerprint(tenancy.pk, value, read_on, notes, units=units)
    if units is not None:
        value = reading_from_units(tenancy, units, read_on)
    _check_reading_fits(tenancy, value, read_on)
    return MeterReading.objects.create(
        tenancy=tenancy,
        reading=value,
        read_on=read_on,
        entered_units=units,
        notes=notes,
        created_by=actor,
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )


def record_meter_reading(*, tenancy_id, actor, validated_data: dict, idempotency_key):
    """Records one reading of the tenancy's meter (owners and managers).

    validated_data: reading (≥ 0, up to 3 decimals) or units (used since the latest reading,
    which they're added to), read_on, and optionally notes. A retry with the same key and
    request returns the reading it recorded; anything else with that key is
    ReadingIdempotencyConflictError. Never creates or changes a bill.
    """
    value = validated_data.get("reading")
    units = validated_data.get("units")
    read_on = validated_data["read_on"]
    notes = validated_data.get("notes", "")
    fingerprint = _reading_fingerprint(tenancy_id, value, read_on, notes, units=units)
    try:
        with transaction.atomic():
            tenancy = _lock_tenancy(tenancy_id)
            _check_can_record_readings(actor, tenancy.property_id)
            if MeterReading.objects.filter(idempotency_key=idempotency_key).exists():
                return _replay_reading(
                    idempotency_key=idempotency_key,
                    tenancy_id=tenancy.pk,
                    actor=actor,
                    fingerprint=fingerprint,
                )
            reading = record_reading_locked(
                tenancy,
                actor=actor,
                value=value,
                units=units,
                read_on=read_on,
                notes=notes,
                idempotency_key=idempotency_key,
            )
            return RecordedReading(reading=reading, created=True)
    except IntegrityError as error:
        # Caught outside the failed transaction, which has been rolled back.
        constraint = _violated_constraint(error)
        if constraint == READING_DAY_CONSTRAINT:
            raise DuplicateReadingDayError() from error
        if constraint == READING_KEY_CONSTRAINT:
            # The same key, at once, for another tenancy (which holds another lock).
            return _replay_reading(
                idempotency_key=idempotency_key,
                tenancy_id=tenancy_id,
                actor=actor,
                fingerprint=fingerprint,
            )
        raise


def bills_to_void_for(reading: MeterReading) -> list[RentEntry]:
    """The active meter bills to void before this reading can change, in the order to void
    them (newest first): the bills that open or close on it and every meter bill after them,
    since meter bills are voided newest first. Empty when no bill is measured from it."""
    bills = RentEntry.objects.active().filter(tenancy_id=reading.tenancy_id)
    if not bills.filter(Q(opening_reading=reading) | Q(closing_reading=reading)).exists():
        return []
    return list(
        bills.filter(
            electricity_mode=RentEntry.ElectricityMode.METER,
            closing_reading__read_on__gte=reading.read_on,
        ).order_by("-closing_reading__read_on")
    )


def readings_to_void_for(reading: MeterReading) -> list[MeterReading]:
    """The active readings entered as units whose totals were worked out from this one, newest
    first (the order to void them): the run of units-entered readings after it, up to the first
    reading typed in, which is the meter's own figure and absorbs any difference. Voided or
    corrected, this reading would leave their totals, and the consumption they stand for,
    stale. Empty when none depend on it."""
    later = MeterReading.objects.active().filter(
        tenancy_id=reading.tenancy_id, read_on__gt=reading.read_on
    )
    dependent = []
    for candidate in later.order_by("read_on"):
        if candidate.entered_units is None:
            break
        dependent.append(candidate)
    return dependent[::-1]


def _lock_reading(tenancy_id, reading_id, actor) -> tuple[Tenancy, MeterReading]:
    tenancy = _lock_tenancy(tenancy_id)
    _check_can_record_readings(actor, tenancy.property_id)
    try:
        reading = MeterReading.objects.select_for_update().get(pk=reading_id, tenancy=tenancy)
    except MeterReading.DoesNotExist:
        raise ReadingNotFoundError() from None
    return tenancy, reading


def _clean_reason(reason: str) -> str:
    reason = reason.strip()
    if not reason or len(reason) > 500:
        raise ValueError("Voiding a reading needs a reason of 1–500 characters.")
    return reason


def _void_reading(reading: MeterReading, *, actor, reason: str) -> None:
    reading.status = MeterReading.Status.VOID
    reading.voided_at = timezone.now()
    reading.voided_by = actor
    reading.void_reason = reason
    reading.save(update_fields=["status", "voided_at", "voided_by", "void_reason"])


def void_meter_reading(*, tenancy_id, reading_id, actor, reason: str) -> VoidedReading:
    """Voids a reading recorded by mistake (entered twice, say). Kept as history; it then
    measures nothing. Refused while an active bill is measured from it (ReadingInUseError). A
    retry with the same reason returns it; another reason is ReadingVoidConflictError."""
    reason = _clean_reason(reason)
    with transaction.atomic():
        _tenancy, reading = _lock_reading(tenancy_id, reading_id, actor)
        if reading.status == MeterReading.Status.VOID:
            if reading.void_reason != reason:
                raise ReadingVoidConflictError()
            return VoidedReading(reading=reading, created=False)
        in_use = bills_to_void_for(reading)
        if in_use:
            raise ReadingInUseError(in_use)
        feeding = readings_to_void_for(reading)
        if feeding:
            raise ReadingFeedsUnitsError(feeding)
        _void_reading(reading, actor=actor, reason=reason)
        return VoidedReading(reading=reading, created=True)


def correct_meter_reading(
    *, tenancy_id, reading_id, actor, reason: str, validated_data: dict, idempotency_key
) -> CorrectedReading:
    """Voids a wrong reading and records its replacement, in one transaction: both or neither.

    validated_data: the replacement's reading, read_on and optionally notes; it passes the
    same order checks as any reading, against the others. Refused while an active bill is
    measured from the original (ReadingInUseError): those bills are voided first, so no saved
    amount ever changes underneath a bill. A retry with the same key and request returns the
    correction.
    """
    reason = _clean_reason(reason)
    value = validated_data["reading"]
    read_on = validated_data["read_on"]
    notes = validated_data.get("notes", "")
    fingerprint = _fingerprint(
        {
            "reason": reason,
            "reading": _reading_fingerprint(tenancy_id, value, read_on, notes, reading_id),
        }
    )
    try:
        with transaction.atomic():
            tenancy, original = _lock_reading(tenancy_id, reading_id, actor)
            existing = MeterReading.objects.filter(idempotency_key=idempotency_key).first()
            if existing is not None:
                if (
                    existing.replaces_reading_id != original.pk
                    or existing.created_by_id != actor.pk
                    or existing.fingerprint != fingerprint
                ):
                    raise ReadingIdempotencyConflictError()
                return CorrectedReading(original=original, replacement=existing, created=False)

            if original.status == MeterReading.Status.VOID:
                raise ReadingVoidError()
            if (
                original.reading == value
                and original.read_on == read_on
                and original.notes == notes
            ):
                raise NothingToCorrectReadingError()
            in_use = bills_to_void_for(original)
            if in_use:
                raise ReadingInUseError(in_use)
            feeding = readings_to_void_for(original)
            if feeding:
                raise ReadingFeedsUnitsError(feeding)

            _check_reading_fits(tenancy, value, read_on, ignore=original.pk)
            _void_reading(original, actor=actor, reason=reason)
            replacement = MeterReading.objects.create(
                tenancy=tenancy,
                reading=value,
                read_on=read_on,
                notes=notes,
                created_by=actor,
                idempotency_key=idempotency_key,
                fingerprint=fingerprint,
                replaces_reading=original,
            )
            return CorrectedReading(original=original, replacement=replacement, created=True)
    except IntegrityError as error:
        constraint = _violated_constraint(error)
        if constraint == READING_DAY_CONSTRAINT:
            raise DuplicateReadingDayError() from error
        if constraint == READING_KEY_CONSTRAINT:
            raise ReadingIdempotencyConflictError() from error
        raise


def electricity_for_new_bill(
    tenancy: Tenancy, *, actor, validated_data: dict, reading_key
) -> ElectricityCharge:
    """Works out a new bill's electricity, on the tenancy bill creation has locked.

    validated_data (from RentEntryCreateSerializer): include_electricity (default True),
    electricity_units (typed units: only without a baseline), closing_reading ({reading,
    read_on, notes?}: a new reading, recorded now) or closing_reading_id (an existing one).

    - No baseline: included is typed units (MANUAL), as before meter readings; excluded is
      NOT_CHARGED. A reading is refused (MeterNotSetUpError).
    - Baseline, included: METER, from the last billed reading to the closing one, which must be
      after it. Typed units are refused: the readings decide them.
    - Baseline, excluded: NOT_CHARGED. A reading sent with it is recorded as a reading only;
      the last billed reading doesn't move, so its units wait for the next meter bill.

    reading_key: the idempotency key for a new reading recorded with the bill.
    """
    include = validated_data.get("include_electricity", True)
    new_reading = validated_data.get("closing_reading")
    reading_id = validated_data.get("closing_reading_id")
    typed_units = validated_data.get("electricity_units")
    start = baseline(tenancy)

    if start is None:
        if new_reading is not None or reading_id is not None:
            raise MeterNotSetUpError()
        if not include:
            return ElectricityCharge(RentEntry.ElectricityMode.NOT_CHARGED, Decimal("0"))
        if typed_units is None:
            raise InvalidReadingError("electricityUnits", "Enter the electricity units used.")
        return ElectricityCharge(RentEntry.ElectricityMode.MANUAL, typed_units)

    if typed_units is not None:
        raise InvalidReadingError(
            "electricityUnits",
            "This tenancy's units come from its meter readings: send the closing reading.",
        )

    closing = None
    if new_reading is not None:
        closing = record_reading_locked(
            tenancy,
            actor=actor,
            value=new_reading.get("reading"),
            units=new_reading.get("units"),
            read_on=new_reading["read_on"],
            notes=new_reading.get("notes", ""),
            idempotency_key=reading_key,
        )
    elif reading_id is not None:
        closing = (
            MeterReading.objects.select_for_update().filter(pk=reading_id, tenancy=tenancy).first()
        )
        if closing is None:
            raise InvalidReadingError("closingReadingId", "No such reading for this tenancy.")
        if closing.status == MeterReading.Status.VOID:
            raise ReadingVoidError()

    if not include:
        return ElectricityCharge(RentEntry.ElectricityMode.NOT_CHARGED, Decimal("0"))
    if closing is None:
        raise ClosingReadingRequiredError()

    opening = last_billed(tenancy)
    # A reading can be taken the day tracking starts (the baseline's day), never the same day
    # as another reading.
    from_baseline = opening.reading_id is None
    if (
        closing.pk == opening.reading_id
        or closing.read_on < opening.read_on
        or (closing.read_on == opening.read_on and not from_baseline)
    ):
        raise ReadingAlreadyBilledError(opening)
    # The order checks make this non-negative; checked again rather than trusted.
    units = closing.reading - opening.reading
    if units < 0:
        raise ReadingAlreadyBilledError(opening)
    return ElectricityCharge(RentEntry.ElectricityMode.METER, units, opening, closing)


def check_meter_bill_can_be_voided(entry: RentEntry) -> None:
    """A meter bill is voided only while no later active meter bill is measured from its
    closing reading, so the chain never has a gap. The caller holds the tenancy's lock."""
    if entry.electricity_mode != RentEntry.ElectricityMode.METER:
        return
    later = (
        RentEntry.objects.active()
        .filter(opening_reading_id=entry.closing_reading_id)
        .exclude(pk=entry.pk)
        .first()
    )
    if later is not None:
        raise LaterMeterBillError(later)


def meter_readings_with_consumption(tenancy: Tenancy) -> list[tuple[MeterReading, Decimal | None]]:
    """The tenancy's readings, newest first, each with the units since the active reading
    before it (or the baseline). Void readings have none. Derived here, never stored."""
    readings = list(
        MeterReading.objects.filter(tenancy=tenancy)
        .select_related("voided_by", "replaced_by")
        .order_by("-read_on", "-created_at")
    )
    start = baseline(tenancy)
    active = sorted(
        (r for r in readings if r.status == MeterReading.Status.ACTIVE), key=lambda r: r.read_on
    )
    consumption: dict[uuid.UUID, Decimal | None] = {}
    previous = start.reading if start is not None else None
    for reading in active:
        consumption[reading.pk] = None if previous is None else reading.reading - previous
        previous = reading.reading
    return [(reading, consumption.get(reading.pk)) for reading in readings]
