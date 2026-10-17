import re
import uuid
from calendar import monthrange
from datetime import date

from django.conf import settings
from django.db import models
from django.db.models import DateField, DecimalField, Exists, F, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce, Round, TruncMonth

from properties.models import PaymentTiming, Property, Tenancy


def month_end(billing_month: date) -> date:
    return billing_month.replace(day=monthrange(billing_month.year, billing_month.month)[1])


def tenancy_covers_month(tenancy: Tenancy, billing_month: date) -> bool:
    """Whether any day of the month falls within the occupancy (end date inclusive). A
    tenancy starting on 20 September may have a September bill; its rent isn't prorated."""
    return tenancy.start_date <= month_end(billing_month) and (
        tenancy.end_date is None or tenancy.end_date >= billing_month
    )


MONEY = DecimalField(max_digits=12, decimal_places=2)


# The one definition of a bill's amounts in SQL, shared by bill lists, their filters and the
# dashboard; billing/calculations.py is the same rule in Python. Payments are summed in a
# subquery per bill, never joined, so adding up many bills never counts a bill once per payment.


def effective_paid_sql():
    """The bill's payments that weren't reversed (reversals are corrections, kept as history)."""
    paid = (
        Payment.objects.filter(entry=OuterRef("pk"), reversal__isnull=True)
        .order_by()
        .values("entry")
        .annotate(total=Sum("amount"))
        .values("total")
    )
    return Coalesce(Subquery(paid, output_field=MONEY), Value(0), output_field=MONEY)


def total_due_sql():
    """Electricity rounded to paise, then added. PostgreSQL rounds halves away from zero, which
    is half up for these non-negative amounts."""
    return models.ExpressionWrapper(
        F("rent_amount")
        + Round(F("electricity_units") * F("electricity_rate"), 2)
        + F("water_amount"),
        output_field=MONEY,
    )


def outstanding_sql():
    """What's left to pay. Callers keep to active bills: a void bill owes nothing."""
    return models.ExpressionWrapper(total_due_sql() - effective_paid_sql(), output_field=MONEY)


class RentEntryQuerySet(models.QuerySet):
    def active(self):
        """Bills that count: a void bill is kept as history but owes nothing."""
        return self.filter(status=RentEntry.Status.ACTIVE)

    def with_amounts(self):
        """Annotates each bill's effective payments sum (`paid_total`), total due (`due_total`)
        and what's left (`outstanding_total`; meaningful for active bills) in the query itself,
        so a list of bills needs no query per bill and can be filtered by them. The serializer
        still calculates the shown figures with calculations.py."""
        return self.annotate(
            paid_total=effective_paid_sql(),
            due_total=total_due_sql(),
            outstanding_total=outstanding_sql(),
        )

    def owing(self):
        """Active bills with money still to pay. Needs with_amounts()."""
        return self.active().filter(outstanding_total__gt=0)

    def with_due(self):
        """Annotates each bill's rental period's due date and payment timing (`period_due_date`,
        `period_payment_timing`): a bill is due when its month is, so it has no due date of its
        own. The serializer reads them, and queries a bill without them for its period."""
        period = RentalPeriod.objects.filter(
            tenancy=OuterRef("tenancy"), period_month=OuterRef("billing_month")
        )
        return self.annotate(
            period_due_date=Subquery(period.values("due_date")[:1]),
            period_payment_timing=Subquery(period.values("payment_timing")[:1]),
        )

    def with_payment_status(self, status: str):
        """Active bills in one payment status (calculations.PaymentStatus): a void bill has
        none. Needs with_amounts()."""
        bills = self.active()
        if status == "unpaid":
            return bills.filter(paid_total=0)
        if status == "partially_paid":
            return bills.filter(paid_total__gt=0, paid_total__lt=F("due_total"))
        if status == "paid":
            return bills.filter(paid_total__gte=F("due_total"))
        raise ValueError(f"Unknown payment status: {status}")


class RentEntry(models.Model):
    """The charges of one tenancy's bill for one month.

    Rent and electricity rate are copied from the tenancy when the bill is created: they're
    historical values, so changing the tenancy later never changes a saved bill. Totals, paid,
    outstanding and payment status are derived (billing/calculations.py), never stored.

    A bill is never edited or deleted. One that shouldn't exist is voided (status, voided_at,
    voided_by, void_reason); one with wrong charges is voided and replaced by a new bill for
    the same month (replaces_entry). A void bill keeps its charges as history and counts
    towards nothing.
    """

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        VOID = "void", "Void"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # PROTECT: removing an occupant must never erase their billing history.
    tenancy = models.ForeignKey(
        Tenancy,
        on_delete=models.PROTECT,
        related_name="rent_entries",
    )
    billing_month = models.DateField(help_text="The first day of the billed month.")
    rent_amount = models.DecimalField(max_digits=10, decimal_places=2)
    electricity_units = models.DecimalField(max_digits=10, decimal_places=3)
    electricity_rate = models.DecimalField(max_digits=8, decimal_places=2)
    water_amount = models.DecimalField(max_digits=10, decimal_places=2)
    # A bounded column (varchar), so the database enforces the 500-character limit too.
    notes = models.CharField(max_length=500, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    status = models.CharField(max_length=6, choices=Status.choices, default=Status.ACTIVE)
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    void_reason = models.CharField(max_length=500, blank=True)
    # The void bill this one corrects. One-to-one: a bill is replaced at most once.
    replaces_entry = models.OneToOneField(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="replaced_by",
    )

    objects = RentEntryQuerySet.as_manager()

    # Retry protection for creating the bill (the Idempotency-Key header). A retry with the same
    # key returns this bill instead of creating another; the fingerprint is the original
    # request, so a retry with different details is refused. Required with an initial payment.
    creation_key = models.UUIDField(null=True, blank=True, editable=False)
    creation_fingerprint = models.CharField(max_length=64, blank=True, editable=False)

    class Meta:
        verbose_name_plural = "rent entries"
        ordering = ("-billing_month", "-created_at")
        # The API validates first for readable errors; these protect the stored data,
        # including against concurrent requests.
        constraints = [
            # One active bill per tenancy and month; void ones stay beside it as history.
            models.UniqueConstraint(
                fields=["tenancy", "billing_month"],
                condition=Q(status="active"),
                name="unique_active_tenancy_billing_month",
                violation_error_message="An entry already exists for this tenancy and month.",
            ),
            # Void exactly when it records who voided it, when and why.
            models.CheckConstraint(
                condition=(
                    Q(
                        status="active",
                        voided_at__isnull=True,
                        voided_by__isnull=True,
                        void_reason="",
                    )
                    | (
                        Q(status="void", voided_at__isnull=False, voided_by__isnull=False)
                        & ~Q(void_reason="")
                    )
                ),
                name="rent_entry_void_details_match_status",
            ),
            models.CheckConstraint(
                condition=~Q(replaces_entry=F("id")),
                name="rent_entry_not_replacing_itself",
            ),
            models.CheckConstraint(
                condition=Q(rent_amount__gt=0),
                name="rent_entry_rent_amount_positive",
            ),
            models.CheckConstraint(
                condition=Q(electricity_units__gte=0),
                name="rent_entry_electricity_units_not_negative",
            ),
            models.CheckConstraint(
                condition=Q(electricity_rate__gte=0),
                name="rent_entry_electricity_rate_not_negative",
            ),
            models.CheckConstraint(
                condition=Q(water_amount__gte=0),
                name="rent_entry_water_amount_not_negative",
            ),
            models.CheckConstraint(
                condition=Q(billing_month__day=1),
                name="rent_entry_billing_month_first_day",
            ),
            models.UniqueConstraint(
                fields=["creation_key"],
                name="unique_rent_entry_creation_key",
            ),
        ]

    def __str__(self):
        return f"{self.tenancy} — {self.billing_month:%B %Y}"


class RentalPeriodQuerySet(models.QuerySet):
    def with_bill(self):
        """Annotates each period's active bill, if it's prepared: `has_bill`, `bill_id`, and its
        `bill_total`, `bill_paid` and `outstanding` (the one SQL definition, so reversed
        payments don't count), all null without a bill. Never a zero for a missing bill."""
        bill = RentEntry.objects.active().filter(
            tenancy=OuterRef("tenancy"), billing_month=OuterRef("period_month")
        )
        amounts = bill.with_amounts()
        return self.annotate(
            has_bill=Exists(bill),
            bill_id=Subquery(bill.values("pk")[:1]),
            bill_total=Subquery(amounts.values("due_total")[:1], output_field=MONEY),
            bill_paid=Subquery(amounts.values("paid_total")[:1], output_field=MONEY),
            outstanding=Subquery(amounts.values("outstanding_total")[:1], output_field=MONEY),
        )

    def counted(self):
        """The periods that are owed, with their bill (with_bill): not marked not owed, and
        either prepared, or tracked (within the tenancy's dates and not before the property's
        tracking cut-off, when it has one). A prepared month always counts, so no bill's balance
        can drop out of the totals."""
        tracked = (
            (
                Q(tenancy__property__rent_tracking_start__isnull=True)
                | Q(period_month__gte=F("tenancy__property__rent_tracking_start"))
            )
            & Q(period_month__gte=TruncMonth("tenancy__start_date", output_field=DateField()))
            & (Q(tenancy__end_date__isnull=True) | Q(tenancy__end_date__gte=F("period_month")))
        )
        return (
            self.with_bill()
            .filter(not_owed_at__isnull=True)
            .filter(Q(has_bill=True) | tracked)
        )

    def owing(self):
        """Counted periods with money still to pay, or an amount not yet known (no bill)."""
        return self.counted().filter(Q(has_bill=False) | Q(outstanding__gt=0))


class RentalPeriod(models.Model):
    """One month of one tenancy's rent: when it's due, whether or not its bill is prepared.

    Created from the tenancy's schedule (billing/periods.py ensure_periods), from its first
    month or the property's tracking cut-off (Property.rent_tracking_start) when that's later,
    and for every month that has a bill. Its
    payment timing, due day and due date are copied from the property and tenancy when it's
    created and never worked out again, so changing either later only affects months created
    after; a bill prepared late is still due on its month's date.

    A bill belongs to the period with its tenancy and month (the same key, unique on both
    sides), so the period has no bill column and the bill no due date of its own. Whether the
    bill is prepared, its balance and whether the month is late are derived, never stored.

    A month that isn't owed (rent waived, or settled before the app) is marked with who, when
    and why (not_owed_*), never deleted.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenancy = models.ForeignKey(
        Tenancy,
        on_delete=models.PROTECT,
        related_name="rental_periods",
    )
    period_month = models.DateField(help_text="The first day of the month.")
    payment_timing = models.CharField(max_length=8, choices=PaymentTiming.choices)
    due_day = models.PositiveSmallIntegerField()
    due_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)
    not_owed_at = models.DateTimeField(null=True, blank=True)
    not_owed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    not_owed_reason = models.CharField(max_length=500, blank=True)

    objects = RentalPeriodQuerySet.as_manager()

    class Meta:
        ordering = ("-period_month", "tenancy_id")
        constraints = [
            # One per tenancy and month, so creating them twice (or at once) can't duplicate.
            models.UniqueConstraint(
                fields=["tenancy", "period_month"],
                name="unique_tenancy_rental_period",
            ),
            models.CheckConstraint(
                condition=Q(period_month__day=1),
                name="rental_period_month_first_day",
            ),
            models.CheckConstraint(
                condition=Q(payment_timing__in=PaymentTiming.values),
                name="rental_period_payment_timing_valid",
            ),
            models.CheckConstraint(
                condition=Q(due_day__gte=1, due_day__lte=31),
                name="rental_period_due_day_1_to_31",
            ),
            # Never due before the month it's for.
            models.CheckConstraint(
                condition=Q(due_date__gte=F("period_month")),
                name="rental_period_due_on_or_after_month",
            ),
            # Owed, or not owed with who said so, when and why. The isnull checks are needed:
            # a comparison with NULL isn't false, and a CHECK only refuses false.
            models.CheckConstraint(
                condition=Q(not_owed_at__isnull=True, not_owed_by__isnull=True, not_owed_reason="")
                | (
                    Q(not_owed_at__isnull=False, not_owed_by__isnull=False)
                    & ~Q(not_owed_reason="")
                ),
                name="rental_period_not_owed_details",
            ),
        ]

    def __str__(self):
        return f"{self.tenancy} — {self.period_month:%B %Y}"


class PaymentQuerySet(models.QuerySet):
    def effective(self):
        """Payments that count towards their bill: every one without a reversal."""
        return self.filter(reversal__isnull=True)


class Payment(models.Model):
    """Money received against one bill. A bill can have several; they're never allocated
    across months. The tenancy and property come through the bill (Payment → RentEntry →
    Tenancy → Property), never stored again here, so they can't contradict it.

    Created only through billing/services.py record_payment, which locks the bill so payments
    never exceed it. Never edited: a mistake is corrected by reversing the payment
    (PaymentReversal, through reverse_payment) and recording its replacement, so the original
    stays as it was recorded.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    entry = models.ForeignKey(RentEntry, on_delete=models.PROTECT, related_name="payments")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    paid_date = models.DateField(help_text="The day the money was received.")
    notes = models.CharField(max_length=500, blank=True)
    # The order payments were recorded on this bill: 1, 2, 3…, given by record_payment while it
    # holds the bill's lock. Receipts total the payments up to this one by it, never by
    # created_at, which can tie or run backwards with the clock.
    sequence = models.PositiveIntegerField(editable=False)
    # One intended payment, chosen by the app (the Idempotency-Key header): a retry with the
    # same key returns this payment instead of recording the money twice.
    idempotency_key = models.UUIDField(editable=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    objects = PaymentQuerySet.as_manager()

    class Meta:
        # Newest received first; the same day, the latest recorded first. The sequence is unique
        # per bill, so the order never changes between requests.
        ordering = ("-paid_date", "-sequence", "id")
        constraints = [
            models.UniqueConstraint(
                fields=["entry", "sequence"],
                name="unique_payment_sequence_per_entry",
            ),
            models.CheckConstraint(
                condition=Q(sequence__gte=1),
                name="payment_sequence_positive",
            ),
            models.UniqueConstraint(
                fields=["idempotency_key"],
                name="unique_payment_idempotency_key",
            ),
            models.CheckConstraint(
                condition=Q(amount__gt=0),
                name="payment_amount_positive",
            ),
        ]

    def __str__(self):
        return f"₹{self.amount} on {self.paid_date:%d %b %Y} — {self.entry}"


class PaymentReversal(models.Model):
    """Corrects a payment recorded by mistake (the wrong amount, date or bill): the payment
    stops counting towards its bill, and stays, unchanged, in its history. Its replacement is a
    new payment. An accounting correction in the app; no money is moved.

    Full reversals only: the reversed amount is always the payment's. Created only through
    billing/services.py reverse_payment, which locks the bill, then the payment, and voids the
    payment's receipt in the same transaction. Never edited or deleted.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # One reversal per payment, enforced by the database (a unique column).
    payment = models.OneToOneField(Payment, on_delete=models.PROTECT, related_name="reversal")
    reason = models.CharField(max_length=500)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "id")
        constraints = [
            models.CheckConstraint(
                condition=~Q(reason=""),
                name="payment_reversal_reason_not_empty",
            ),
        ]

    def __str__(self):
        return f"Reversal of {self.payment}"


class Receipt(models.Model):
    """Confirms one payment: a snapshot of everything printed on it, copied when it's issued.

    Later payments, or changes to the tenancy, property or bill, never change an issued receipt:
    reopening or downloading it shows exactly what was saved. The bill's figures are as they
    stood right after this payment (the payments recorded before it, plus this one). Earlier
    payments already reversed when it's issued don't count, so a receipt issued after such a
    reversal can show a different balance than one issued before it.

    Created only through billing/services.py issue_payment_receipt, which locks the bill and the
    payment so each one gets at most one receipt, and the property so its references are
    numbered one at a time. Its snapshot is never changed afterwards. Reversing the payment voids
    it (voided_at, voided_by, void_reason, set by reverse_payment): it keeps its reference and
    snapshot but no longer confirms anything.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # One receipt per payment, enforced by the database (a unique column).
    payment = models.OneToOneField(Payment, on_delete=models.PROTECT, related_name="receipt")
    # The property that issued it, which its reference is unique within. Saved, like everything
    # else here, rather than followed through the payment.
    property = models.ForeignKey(
        Property, on_delete=models.PROTECT, related_name="receipts", editable=False
    )
    # Tenant_Name_Flat_Rent_Month YYYY (receipt_reference), with _2, _3… for the property's later
    # receipts with the same name, flat and month. Set once when issued, never regenerated.
    reference = models.CharField(max_length=255, editable=False)
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
    )
    issued_at = models.DateTimeField()
    # The property's date when issued, printed on the receipt. Saved rather than worked out from
    # issued_at, which would depend on the time zone of whoever downloads it.
    issued_date = models.DateField()

    # Who issued it, from the property; who received the money (the payment's recorder); and who
    # authorized the receipt (the person issuing it). Two people when, say, an owner issues the
    # receipt for a manager's payment.
    issuer_name = models.CharField(max_length=150)
    issuer_address = models.TextField()
    issuer_contact_number = models.CharField(max_length=20, blank=True)
    received_by_name = models.CharField(max_length=150, blank=True)
    authorized_by_name = models.CharField(max_length=150, blank=True)

    # The tenancy.
    tenant_name = models.CharField(max_length=150)
    flat_number = models.CharField(max_length=20)
    tenant_mobile_number = models.CharField(max_length=20, blank=True)
    deposit_amount = models.DecimalField(max_digits=10, decimal_places=2)
    rent_due_day = models.PositiveSmallIntegerField()

    # The bill.
    billing_month = models.DateField(help_text="The first day of the billed month.")
    rent_amount = models.DecimalField(max_digits=10, decimal_places=2)
    electricity_units = models.DecimalField(max_digits=10, decimal_places=3)
    electricity_rate = models.DecimalField(max_digits=8, decimal_places=2)
    electricity_amount = models.DecimalField(max_digits=12, decimal_places=2)
    water_amount = models.DecimalField(max_digits=10, decimal_places=2)
    total_due = models.DecimalField(max_digits=12, decimal_places=2)
    total_paid = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text="Paid towards the bill up to and including this payment.",
    )
    outstanding_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text="Left on the bill after this payment.",
    )
    previous_month_outstanding = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text="What the previous month's bill still owed when this was issued (for "
        "information; never added to this bill).",
    )

    # The payment.
    payment_amount = models.DecimalField(max_digits=10, decimal_places=2)
    paid_date = models.DateField()
    payment_notes = models.CharField(max_length=500, blank=True)

    # Set together when the payment is reversed; empty while the receipt is valid.
    voided_at = models.DateTimeField(null=True, blank=True, editable=False)
    voided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
        editable=False,
    )
    void_reason = models.CharField(max_length=500, blank=True, editable=False)

    class Meta:
        ordering = ("-issued_at", "id")
        constraints = [
            # Void with when, who and why, or valid with none of them.
            models.CheckConstraint(
                condition=Q(voided_at__isnull=True, voided_by__isnull=True, void_reason="")
                | (Q(voided_at__isnull=False, voided_by__isnull=False) & ~Q(void_reason="")),
                name="receipt_void_details_together",
            ),
            # Properties number their own: another property's tenant with the same name, flat
            # and month never makes this one's _2.
            models.UniqueConstraint(
                fields=["property", "reference"],
                name="unique_receipt_reference_per_property",
            ),
            models.CheckConstraint(
                condition=Q(payment_amount__gt=0),
                name="receipt_payment_amount_positive",
            ),
            models.CheckConstraint(
                condition=Q(billing_month__day=1),
                name="receipt_billing_month_first_day",
            ),
        ]

    def __str__(self):
        return self.reference if self.voided_at is None else f"{self.reference} (void)"


def receipt_reference(tenant_name: str, flat_number: str, billing_month: date) -> str:
    """'Shaik Zahid Ali', '202', October 2026 -> 'Shaik_Zahid_Ali_202_Rent_October 2026': the
    tenant's name and flat (spaces as underscores, characters file names can't hold left out)
    and the billed month. A bill's later receipts add _2, _3… (billing/services.py)."""

    def part(value: str) -> str:
        cleaned = re.sub(r'[\\/:*?"<>|]+', "", value)
        return "_".join(cleaned.split())

    return f"{part(tenant_name)}_{part(flat_number)}_Rent_{billing_month:%B %Y}"


class LegacyRecord(models.Model):
    """A record imported from an old ledger (billing/legacy_import.py): which source record
    became which bill, payment or receipt, and a fingerprint of what was imported. Rerunning an
    import finds these, so nothing is created twice, and a source record that has changed since
    it was imported is refused rather than imported again."""

    class Kind(models.TextChoices):
        BILL = "bill"
        PAYMENT = "payment"
        RECEIPT = "receipt"

    # The source's own id, prefixed by the source (e.g. "google-sheet:Tenant A/2026-08").
    source_id = models.CharField(max_length=255, unique=True)
    kind = models.CharField(max_length=10, choices=Kind.choices)
    object_id = models.UUIDField(help_text="The bill, payment or receipt created from it.")
    fingerprint = models.CharField(max_length=64)
    imported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
    )
    imported_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("imported_at", "source_id")
        constraints = [
            models.UniqueConstraint(fields=["kind", "object_id"], name="unique_legacy_object"),
        ]

    def __str__(self):
        return self.source_id
