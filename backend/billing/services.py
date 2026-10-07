import hashlib
import json
import re
from dataclasses import dataclass
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Max, Sum
from django.utils import timezone

from properties.models import Tenancy, business_date
from properties.queries import properties_for_user
from properties.roles import Capability, role_can

from .calculations import ZERO, entry_amounts, to_paise
from .models import Payment, Receipt, RentEntry, receipt_reference, tenancy_covers_month

UNIQUE_MONTH_CONSTRAINT = "unique_tenancy_billing_month"
PAYMENT_KEY_CONSTRAINT = "unique_payment_idempotency_key"
CREATION_KEY_CONSTRAINT = "unique_rent_entry_creation_key"
# The unique column behind Receipt.payment (PostgreSQL's name for it).
RECEIPT_PAYMENT_CONSTRAINT = "billing_receipt_payment_id_key"
RECEIPT_REFERENCE_CONSTRAINT = "billing_receipt_reference_key"
# Retries when another bill's receipt took the same reference at the same moment.
REFERENCE_ATTEMPTS = 3


class DuplicateBillingMonthError(Exception):
    """The tenancy already has a bill for this month."""


class BillingMonthOutsideTenancyError(Exception):
    """No day of the billing month falls within the occupancy."""


class EntryNotFoundError(Exception):
    """No such bill, or the actor can't access its property."""


class PaymentNotAllowedError(Exception):
    """The actor's role can't record payments for this property."""


class IdempotencyConflictError(Exception):
    """The key was already used for a different request (another bill, other details or
    another person)."""


class PaymentNotFoundError(Exception):
    """No such payment, or the actor can't access its property."""


class ReceiptNotAllowedError(Exception):
    """The actor's role can't issue receipts for this property."""


class ReceiptConfigurationIncompleteError(Exception):
    """Details a new receipt needs are missing (the property's address, say)."""

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class PaymentExceedsOutstandingError(Exception):
    """The payment is more than the bill's outstanding amount (zero when it's fully paid)."""

    def __init__(self, outstanding: Decimal):
        super().__init__(f"The outstanding amount is {outstanding}.")
        self.outstanding = outstanding


@dataclass(frozen=True)
class RecordedPayment:
    payment: Payment
    # False when the key's payment already existed: a retry, nothing was recorded now.
    created: bool


@dataclass(frozen=True)
class IssuedReceipt:
    receipt: Receipt
    # False when the payment already had this receipt: nothing was issued now.
    created: bool


@dataclass(frozen=True)
class CreatedEntry:
    entry: RentEntry
    # False when the key's bill already existed: a retry, nothing was created now.
    created: bool


def _violated_constraint(error: IntegrityError) -> str | None:
    # psycopg reports which constraint failed. Callers map only their own constraint: any other
    # integrity failure is a real error and must not be reported as a duplicate.
    diag = getattr(error.__cause__, "diag", None)
    return getattr(diag, "constraint_name", None)


def _check_can_record_payments(actor, property_id) -> None:
    """Through the actor's active memberships, as every API lookup is: no access is "not
    found", so the bill's existence isn't revealed."""
    role = (
        properties_for_user(actor).filter(pk=property_id).values_list("role", flat=True).first()
    )
    if role is None:
        raise EntryNotFoundError()
    if not role_can(role, Capability.RECORD_PAYMENTS):
        raise PaymentNotAllowedError()


def _matches(payment: Payment, *, entry_id, actor, validated_data: dict) -> bool:
    """Whether a retry asks for exactly the payment this key already recorded. Validated
    values are compared (amounts as Decimals, notes trimmed), so "3000" and "3000.00" match."""
    return (
        payment.entry_id == entry_id
        and payment.created_by_id == actor.pk
        and payment.amount == validated_data["amount"]
        and payment.paid_date == validated_data["paid_date"]
        and payment.notes == validated_data.get("notes", "")
    )


def _replay_payment(*, idempotency_key, entry_id, actor, validated_data) -> RecordedPayment:
    """The payment this key already recorded, when the request matches it and the actor can
    still access its bill; otherwise the key was reused for another request."""
    existing = Payment.objects.select_related("entry__tenancy").get(idempotency_key=idempotency_key)
    if not _matches(existing, entry_id=entry_id, actor=actor, validated_data=validated_data):
        raise IdempotencyConflictError()
    # Access may have ended since the payment was recorded.
    _check_can_record_payments(actor, existing.entry.tenancy.property_id)
    return RecordedPayment(payment=existing, created=False)


def record_payment(*, entry_id, actor, idempotency_key, validated_data: dict) -> RecordedPayment:
    """Records money received against a bill, at most once per idempotency key.

    validated_data: amount (Decimal, > 0, two places), paid_date (not in the future) and
    optionally notes (trimmed). The bill is locked for the whole operation, so simultaneous
    payments are checked one at a time and can never together exceed it. Every way of
    creating a payment comes through here, so they all take the same lock.
    """
    try:
        with transaction.atomic():
            try:
                entry = RentEntry.objects.select_for_update().get(pk=entry_id)
            except RentEntry.DoesNotExist:
                raise EntryNotFoundError() from None

            # Checked again inside the lock: the view's lookup happened before it.
            _check_can_record_payments(actor, entry.tenancy.property_id)

            # Before the balance check: a retry of the payment that settled the bill must
            # return that payment, not report the bill as fully paid.
            if Payment.objects.filter(idempotency_key=idempotency_key).exists():
                return _replay_payment(
                    idempotency_key=idempotency_key,
                    entry_id=entry.pk,
                    actor=actor,
                    validated_data=validated_data,
                )

            outstanding = entry_amounts(entry).outstanding_amount
            if validated_data["amount"] > outstanding:
                raise PaymentExceedsOutstandingError(max(outstanding, Decimal("0.00")))

            last = entry.payments.aggregate(last=Max("sequence"))["last"] or 0
            payment = Payment.objects.create(
                entry=entry,
                sequence=last + 1,
                amount=validated_data["amount"],
                paid_date=validated_data["paid_date"],
                notes=validated_data.get("notes", ""),
                idempotency_key=idempotency_key,
                created_by=actor,
            )
            return RecordedPayment(payment=payment, created=True)
    except IntegrityError as error:
        # The same key on another bill locks another row, so both requests can reach the insert.
        # The failed transaction has been rolled back; look up the winner outside it.
        if _violated_constraint(error) != PAYMENT_KEY_CONSTRAINT:
            raise
        return _replay_payment(
            idempotency_key=idempotency_key,
            entry_id=entry_id,
            actor=actor,
            validated_data=validated_data,
        )


def _creation_fingerprint(validated_data: dict, initial_payment: dict | None) -> str:
    """The original creation request, to tell a retry from a different request with the same
    key. The bill's current balance isn't part of it, so later payments never make a genuine
    retry conflict."""

    def text(value):
        return None if value is None else str(value)

    request = {
        "billing_month": validated_data["billing_month"].isoformat(),
        "rent_amount": text(validated_data.get("rent_amount")),
        "electricity_units": text(validated_data["electricity_units"]),
        "water_amount": text(validated_data["water_amount"]),
        "notes": validated_data.get("notes", ""),
        "initial_payment": None
        if initial_payment is None
        else {
            "amount": text(initial_payment["amount"]),
            "paid_date": initial_payment["paid_date"].isoformat(),
            "notes": initial_payment.get("notes", ""),
        },
    }
    return hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()


def _replay_entry(*, creation_key, tenancy_id, actor, fingerprint) -> CreatedEntry:
    existing = RentEntry.objects.get(creation_key=creation_key)
    if (
        existing.tenancy_id != tenancy_id
        or existing.created_by_id != actor.pk
        or existing.creation_fingerprint != fingerprint
    ):
        raise IdempotencyConflictError()
    return CreatedEntry(entry=existing, created=False)


def create_rent_entry(
    *,
    tenancy: Tenancy,
    actor,
    validated_data: dict,
    creation_key=None,
    initial_payment: dict | None = None,
) -> CreatedEntry:
    """Creates a bill with the tenancy's current charges copied onto it, and optionally the
    payment received with it, together or not at all.

    validated_data: billing_month (first of the month), electricity_units, water_amount,
    and optionally rent_amount (defaults to the tenancy's rent) and notes. The electricity
    rate always comes from the tenancy.

    creation_key: the request's Idempotency-Key (required with an initial payment). A retry
    with the same key and request returns the bill it created; the initial payment is recorded
    with the same key.
    """
    if initial_payment is not None and creation_key is None:
        raise ValueError("An initial payment needs a creation key.")

    billing_month = validated_data["billing_month"]
    fingerprint = _creation_fingerprint(validated_data, initial_payment) if creation_key else ""

    try:
        with transaction.atomic():
            # Locked and reloaded, so its rent, rate and dates can't change while the bill is
            # created, and simultaneous bills for one tenancy are made one at a time.
            locked = Tenancy.objects.select_for_update().get(pk=tenancy.pk)

            if creation_key and RentEntry.objects.filter(creation_key=creation_key).exists():
                return _replay_entry(
                    creation_key=creation_key,
                    tenancy_id=locked.pk,
                    actor=actor,
                    fingerprint=fingerprint,
                )

            if not tenancy_covers_month(locked, billing_month):
                raise BillingMonthOutsideTenancyError()

            # A readable error for the common case; the unique constraint still decides.
            if RentEntry.objects.filter(tenancy=locked, billing_month=billing_month).exists():
                raise DuplicateBillingMonthError()

            rent_amount = validated_data.get("rent_amount")
            entry = RentEntry.objects.create(
                tenancy=locked,
                billing_month=billing_month,
                rent_amount=locked.rent_amount if rent_amount is None else rent_amount,
                electricity_units=validated_data["electricity_units"],
                electricity_rate=locked.electricity_rate,
                water_amount=validated_data["water_amount"],
                notes=validated_data.get("notes", ""),
                created_by=actor,
                creation_key=creation_key,
                creation_fingerprint=fingerprint,
            )

            if initial_payment is not None:
                # Through the same service and bill lock as every other payment. Any failure
                # (e.g. more than the bill) rolls the bill back with it.
                recorded = record_payment(
                    entry_id=entry.pk,
                    actor=actor,
                    idempotency_key=creation_key,
                    validated_data=initial_payment,
                )
                if not recorded.created:
                    # The key already recorded a payment on another bill.
                    raise IdempotencyConflictError()

            return CreatedEntry(entry=entry, created=True)
    except IntegrityError as error:
        # Caught outside the failed transaction, which has been rolled back.
        constraint = _violated_constraint(error)
        if constraint == UNIQUE_MONTH_CONSTRAINT:
            raise DuplicateBillingMonthError() from error
        if constraint == CREATION_KEY_CONSTRAINT:
            # The same key, simultaneously, for another tenancy (which holds another lock).
            return _replay_entry(
                creation_key=creation_key,
                tenancy_id=tenancy.pk,
                actor=actor,
                fingerprint=fingerprint,
            )
        raise


def _check_can_issue_receipts(actor, property_id) -> None:
    """As _check_can_record_payments: no access is "not found"."""
    role = (
        properties_for_user(actor).filter(pk=property_id).values_list("role", flat=True).first()
    )
    if role is None:
        raise PaymentNotFoundError()
    if not role_can(role, Capability.ISSUE_RECEIPTS):
        raise ReceiptNotAllowedError()


def _previous_month(billing_month):
    if billing_month.month == 1:
        return billing_month.replace(year=billing_month.year - 1, month=12)
    return billing_month.replace(month=billing_month.month - 1)


def _next_reference(tenancy, entry) -> str:
    """The bill's first receipt gets the plain reference; later ones _2, _3… Callers hold the
    bill's lock, so a bill's receipts are numbered one at a time."""
    base = receipt_reference(tenancy.name, tenancy.flat_number, entry.billing_month)
    pattern = re.compile(rf"^{re.escape(base)}(?:_(\d+))?$")
    taken = [
        pattern.match(reference)
        for reference in Receipt.objects.filter(reference__startswith=base).values_list(
            "reference", flat=True
        )
    ]
    numbers = [int(m.group(1) or 1) for m in taken if m]
    return base if not numbers else f"{base}_{max(numbers) + 1}"


def _receipt_problem(payment: Payment) -> str | None:
    """What stops a new receipt from being issued, or None."""
    entry = payment.entry
    tenancy = entry.tenancy
    prop = tenancy.property
    if not prop.name.strip():
        return "Configure the property name before issuing receipts."
    if not prop.address.strip():
        return "Configure the property address before issuing receipts."
    if not tenancy.name.strip() or not tenancy.flat_number.strip():
        return "The tenant needs a name and flat number before receipts can be issued."
    if payment.amount <= 0:
        return "Only a recorded payment of more than zero can have a receipt."
    return None


def issue_payment_receipt(*, payment_id, actor) -> IssuedReceipt:
    """Issues the payment's receipt, or returns the one it already has.

    Everything printed on the receipt is copied from the stored records now, so later payments
    or changed details never change it. The payment row is locked, so simultaneous requests
    issue one receipt; its unique column is the last guard. The bill is locked too, so its
    receipts are numbered one at a time.
    """
    for attempt in range(REFERENCE_ATTEMPTS):
        try:
            return _issue_payment_receipt(payment_id=payment_id, actor=actor)
        except IntegrityError as error:
            # The locks make these unlikely; the failed transaction has been rolled back, so
            # anything is looked up outside it.
            constraint = _violated_constraint(error)
            if constraint == RECEIPT_REFERENCE_CONSTRAINT and attempt + 1 < REFERENCE_ATTEMPTS:
                # Another bill (same name, flat and month) took the reference: number again.
                continue
            if constraint != RECEIPT_PAYMENT_CONSTRAINT:
                raise
            existing = Receipt.objects.select_related("payment__entry__tenancy").get(
                payment_id=payment_id
            )
            _check_can_issue_receipts(actor, existing.payment.entry.tenancy.property_id)
            return IssuedReceipt(receipt=existing, created=False)
    raise AssertionError("unreachable")


def _issue_payment_receipt(*, payment_id, actor) -> IssuedReceipt:
    with transaction.atomic():
        try:
            payment = (
                Payment.objects.select_for_update(of=("self",))
                .select_related("entry__tenancy__property")
                .get(pk=payment_id)
            )
        except Payment.DoesNotExist:
            raise PaymentNotFoundError() from None

        # Checked again inside the lock: the view's lookup happened before it.
        _check_can_issue_receipts(actor, payment.entry.tenancy.property_id)

        # Before validating today's details: an issued receipt reopens even if, say, the
        # property's address has since been cleared.
        existing = Receipt.objects.filter(payment=payment).first()
        if existing is not None:
            return IssuedReceipt(receipt=existing, created=False)

        problem = _receipt_problem(payment)
        if problem is not None:
            raise ReceiptConfigurationIncompleteError(problem)

        entry = RentEntry.objects.select_for_update().get(pk=payment.entry_id)
        tenancy = payment.entry.tenancy
        prop = tenancy.property

        # The bill as it stood right after this payment: payments are never edited, and later
        # ones get higher sequences under the bill's lock, so this never changes.
        paid_through = to_paise(
            entry.payments.filter(sequence__lte=payment.sequence)
            .aggregate(total=Sum("amount"))["total"]
            or ZERO
        )
        amounts = entry_amounts(entry, total_paid=paid_through)

        previous = RentEntry.objects.filter(
            tenancy=tenancy, billing_month=_previous_month(entry.billing_month)
        ).first()
        previous_outstanding = (
            max(entry_amounts(previous).outstanding_amount, ZERO) if previous else ZERO
        )

        receipt = Receipt.objects.create(
            payment=payment,
            reference=_next_reference(tenancy, entry),
            issued_by=actor,
            issued_at=timezone.now(),
            issued_date=business_date(),
            issuer_name=prop.name.strip(),
            issuer_address=prop.address.strip(),
            issuer_contact_number=prop.contact_number,
            received_by_name=actor.name,
            tenant_name=tenancy.name,
            flat_number=tenancy.flat_number,
            tenant_mobile_number=tenancy.mobile_number,
            deposit_amount=tenancy.deposit_amount,
            rent_due_day=tenancy.rent_due_day,
            billing_month=entry.billing_month,
            rent_amount=entry.rent_amount,
            electricity_units=entry.electricity_units,
            electricity_rate=entry.electricity_rate,
            electricity_amount=amounts.electricity_amount,
            water_amount=entry.water_amount,
            total_due=amounts.total_due,
            total_paid=amounts.total_paid,
            outstanding_amount=max(amounts.outstanding_amount, ZERO),
            previous_month_outstanding=previous_outstanding,
            payment_amount=payment.amount,
            paid_date=payment.paid_date,
            payment_notes=payment.notes,
        )
        return IssuedReceipt(receipt=receipt, created=True)
