import hashlib
import json
import re
from dataclasses import dataclass
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Max, Sum
from django.utils import timezone

from properties.models import Property, Tenancy, business_date
from properties.queries import properties_for_user
from properties.roles import Capability, role_can

from .calculations import ZERO, entry_amounts, to_paise
from .models import (
    Payment,
    PaymentReversal,
    Receipt,
    RentEntry,
    receipt_reference,
    tenancy_covers_month,
)

UNIQUE_MONTH_CONSTRAINT = "unique_tenancy_billing_month"
PAYMENT_KEY_CONSTRAINT = "unique_payment_idempotency_key"
CREATION_KEY_CONSTRAINT = "unique_rent_entry_creation_key"
# The unique columns behind Receipt.payment and PaymentReversal.payment (PostgreSQL's names).
RECEIPT_PAYMENT_CONSTRAINT = "billing_receipt_payment_id_key"
REVERSAL_PAYMENT_CONSTRAINT = "billing_paymentreversal_payment_id_key"


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


class PaymentReversedError(Exception):
    """The payment has been reversed, so it can't get a new receipt."""


class ReversalNotAllowedError(Exception):
    """The actor's role can't reverse payments for this property."""


class ReversalConflictError(Exception):
    """The payment was already reversed, with another reason."""


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
class ReversedPayment:
    reversal: PaymentReversal
    # False when the payment was already reversed for the same reason: a retry.
    created: bool
    # The bill, with its amounts annotated (with_amounts), as it stands after the reversal.
    entry: RentEntry


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


def _next_reference(prop, tenancy, entry) -> str:
    """The property's first receipt for this name, flat and month gets the plain reference;
    later ones _2, _3… Callers hold the property's lock, so its receipts are numbered one at a
    time and the number is always free."""
    base = receipt_reference(tenancy.name, tenancy.flat_number, entry.billing_month)
    pattern = re.compile(rf"^{re.escape(base)}(?:_(\d+))?$")
    taken = [
        pattern.match(reference)
        for reference in Receipt.objects.filter(
            property=prop, reference__startswith=base
        ).values_list("reference", flat=True)
    ]
    numbers = [int(m.group(1) or 1) for m in taken if m]
    return base if not numbers else f"{base}_{max(numbers) + 1}"


def receipt_problem(payment: Payment, tenancy: Tenancy, prop: Property) -> str | None:
    """What stops a new receipt from being issued, or None."""
    if not prop.name.strip():
        return "Configure the property name before issuing receipts."
    if not prop.address.strip():
        return "Configure the property address before issuing receipts."
    if not tenancy.name.strip() or not tenancy.flat_number.strip():
        return "The tenant needs a name and flat number before receipts can be issued."
    if payment.amount <= 0:
        return "Only a recorded payment of more than zero can have a receipt."
    return None


def receipt_snapshot(
    payment: Payment,
    entry: RentEntry,
    tenancy: Tenancy,
    prop: Property,
    actor,
    *,
    previous_outstanding,
) -> dict:
    """Everything a receipt prints, copied from the stored records: the issuer, the tenancy, the
    bill as it stood right after this payment and the payment. previous_outstanding is what the
    previous month's bill still owed when the receipt was issued. Callers hold the bill's,
    tenancy's and property's locks and pass those rows, read again under them.
    """

    # The bill as it stood right after this payment: payments are never edited, and later ones
    # get higher sequences under the bill's lock. Earlier payments reversed by the time it's
    # issued don't count (a reversed payment itself can't get a receipt).
    paid_through = to_paise(
        entry.payments.effective()
        .filter(sequence__lte=payment.sequence)
        .aggregate(total=Sum("amount"))["total"]
        or ZERO
    )
    amounts = entry_amounts(entry, total_paid=paid_through)
    return {
        "payment": payment,
        "issuer_name": prop.name.strip(),
        "issuer_address": prop.address.strip(),
        "issuer_contact_number": prop.contact_number,
        "received_by_name": actor.name,
        "tenant_name": tenancy.name,
        "flat_number": tenancy.flat_number,
        "tenant_mobile_number": tenancy.mobile_number,
        "deposit_amount": tenancy.deposit_amount,
        "rent_due_day": tenancy.rent_due_day,
        "billing_month": entry.billing_month,
        "rent_amount": entry.rent_amount,
        "electricity_units": entry.electricity_units,
        "electricity_rate": entry.electricity_rate,
        "electricity_amount": amounts.electricity_amount,
        "water_amount": entry.water_amount,
        "total_due": amounts.total_due,
        "total_paid": amounts.total_paid,
        "outstanding_amount": max(amounts.outstanding_amount, ZERO),
        "previous_month_outstanding": previous_outstanding,
        "payment_amount": payment.amount,
        "paid_date": payment.paid_date,
        "payment_notes": payment.notes,
    }


def issue_payment_receipt(*, payment_id, actor) -> IssuedReceipt:
    """Issues the payment's receipt, or returns the one it already has.

    Everything printed on the receipt is copied from the stored records now, so later payments
    or changed details never change it. The bill and then the payment are locked, so
    simultaneous requests issue one receipt and a reversal can't slip in between; the unique
    column is the last guard. A reversed payment gets no new receipt (PaymentReversedError),
    but one it already had is returned, void. The tenancy and property are locked and read
    again before anything is copied, so an edit that commits first is always on the receipt;
    the property's lock also numbers references one at a time, so they never collide and
    nothing needs retrying.
    """
    try:
        return _issue_payment_receipt(payment_id=payment_id, actor=actor)
    except IntegrityError as error:
        # The payment's lock makes this unlikely; the failed transaction has been rolled back,
        # so the receipt is looked up outside it.
        if _violated_constraint(error) != RECEIPT_PAYMENT_CONSTRAINT:
            raise
        existing = Receipt.objects.select_related("payment__entry__tenancy").get(
            payment_id=payment_id
        )
        _check_can_issue_receipts(actor, existing.payment.entry.tenancy.property_id)
        return IssuedReceipt(receipt=existing, created=False)


def _lock_bill_and_payment(payment_id) -> tuple[RentEntry, Payment]:
    """Locks the payment's bill, then the payment: the order receipt issuance and reversal both
    take, so they're carried out one at a time and never deadlock. The bill's lock is also the
    one record_payment takes, so balances never change under either. A payment's bill never
    changes, so it's safe to read before locking."""
    entry_id = Payment.objects.filter(pk=payment_id).values_list("entry_id", flat=True).first()
    if entry_id is None:
        raise PaymentNotFoundError()
    entry = RentEntry.objects.select_for_update().get(pk=entry_id)
    payment = Payment.objects.select_for_update().get(pk=payment_id)
    return entry, payment


def _issue_payment_receipt(*, payment_id, actor) -> IssuedReceipt:
    with transaction.atomic():
        entry, payment = _lock_bill_and_payment(payment_id)

        # Checked again inside the lock: the view's lookup happened before it.
        _check_can_issue_receipts(actor, entry.tenancy.property_id)

        # Before validating today's details: an issued receipt reopens even if, say, the
        # property's address has since been cleared, and a void one is returned as it is.
        existing = Receipt.objects.filter(payment=payment).first()
        if existing is not None:
            return IssuedReceipt(receipt=existing, created=False)

        # Under the same locks as reverse_payment, so a reversal either committed first (and
        # this refuses) or waits until this receipt exists (and voids it).
        if PaymentReversal.objects.filter(payment=payment).exists():
            raise PaymentReversedError()

        # Then tenancy, then property, each read again under its lock: the copies loaded before
        # may predate an edit this request waited for, and the receipt must print the details
        # as they are when it's issued. NO KEY, so new bills and tenancies (which reference
        # these rows) aren't held up; the property's lock also numbers its receipts one at a
        # time.
        tenancy = Tenancy.objects.select_for_update(no_key=True).get(pk=entry.tenancy_id)
        prop = Property.objects.select_for_update(no_key=True).get(pk=tenancy.property_id)

        problem = receipt_problem(payment, tenancy, prop)
        if problem is not None:
            raise ReceiptConfigurationIncompleteError(problem)

        previous = RentEntry.objects.filter(
            tenancy=tenancy, billing_month=_previous_month(entry.billing_month)
        ).first()
        previous_outstanding = (
            max(entry_amounts(previous).outstanding_amount, ZERO) if previous else ZERO
        )

        receipt = Receipt.objects.create(
            property=prop,
            reference=_next_reference(prop, tenancy, entry),
            issued_by=actor,
            issued_at=timezone.now(),
            issued_date=business_date(),
            **receipt_snapshot(
                payment, entry, tenancy, prop, actor, previous_outstanding=previous_outstanding
            ),
        )
        return IssuedReceipt(receipt=receipt, created=True)


def _check_can_reverse_payments(actor, property_id) -> None:
    """As _check_can_record_payments: no access is "not found"."""
    role = (
        properties_for_user(actor).filter(pk=property_id).values_list("role", flat=True).first()
    )
    if role is None:
        raise PaymentNotFoundError()
    if not role_can(role, Capability.REVERSE_PAYMENTS):
        raise ReversalNotAllowedError()


def _replay_reversal(existing: PaymentReversal, *, reason: str, entry_id) -> ReversedPayment:
    """The payment's reversal, when a retry gives the same reason; otherwise it was already
    reversed for another one."""
    if existing.reason != reason:
        raise ReversalConflictError()
    return ReversedPayment(
        reversal=existing,
        created=False,
        entry=RentEntry.objects.with_amounts().get(pk=entry_id),
    )


def reverse_payment(*, payment_id, actor, reason: str) -> ReversedPayment:
    """Reverses a payment recorded by mistake: it stops counting towards its bill, and its
    receipt, if it has one, is voided. Neither is otherwise changed. Full reversals only;
    the replacement is a new payment (record_payment).

    reason: why (trimmed, 1–500 characters). The payment identifies its only possible reversal,
    so a retry with the same reason returns it; another reason is ReversalConflictError.

    One transaction: the bill, then the payment, are locked (as receipt issuance does), access
    is checked again, then the reversal is created and the receipt voided together, or neither.
    """
    reason = reason.strip()
    if not reason or len(reason) > 500:
        raise ValueError("A reversal needs a reason of 1–500 characters.")

    try:
        with transaction.atomic():
            entry, payment = _lock_bill_and_payment(payment_id)

            # Checked again inside the lock: the view's lookup happened before it.
            _check_can_reverse_payments(actor, entry.tenancy.property_id)

            existing = PaymentReversal.objects.filter(payment=payment).first()
            if existing is not None:
                return _replay_reversal(existing, reason=reason, entry_id=entry.pk)

            reversal = PaymentReversal.objects.create(
                payment=payment, reason=reason, created_by=actor
            )
            # Its receipt no longer confirms anything: void, with its reference and snapshot
            # kept as issued.
            Receipt.objects.filter(payment=payment, voided_at__isnull=True).update(
                voided_at=reversal.created_at, voided_by=actor, void_reason=reason
            )
            return ReversedPayment(
                reversal=reversal,
                created=True,
                entry=RentEntry.objects.with_amounts().get(pk=entry.pk),
            )
    except IntegrityError as error:
        # The bill's lock makes this unlikely; the failed transaction has been rolled back, so
        # the reversal is looked up outside it.
        if _violated_constraint(error) != REVERSAL_PAYMENT_CONSTRAINT:
            raise
        existing = PaymentReversal.objects.select_related("payment__entry__tenancy").get(
            payment_id=payment_id
        )
        _check_can_reverse_payments(actor, existing.payment.entry.tenancy.property_id)
        return _replay_reversal(existing, reason=reason, entry_id=existing.payment.entry_id)
