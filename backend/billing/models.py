import re
import uuid
from calendar import monthrange
from datetime import date

from django.conf import settings
from django.db import models
from django.db.models import DecimalField, F, Q, Sum, Value
from django.db.models.functions import Coalesce, Round

from properties.models import Tenancy


def month_end(billing_month: date) -> date:
    return billing_month.replace(day=monthrange(billing_month.year, billing_month.month)[1])


def tenancy_covers_month(tenancy: Tenancy, billing_month: date) -> bool:
    """Whether any day of the month falls within the occupancy (end date inclusive). A
    tenancy starting on 20 September may have a September bill; its rent isn't prorated."""
    return tenancy.start_date <= month_end(billing_month) and (
        tenancy.end_date is None or tenancy.end_date >= billing_month
    )


MONEY = DecimalField(max_digits=12, decimal_places=2)


class RentEntryQuerySet(models.QuerySet):
    def with_amounts(self):
        """Annotates each bill's payments sum (`paid_total`) and total due (`due_total`) in the
        query itself, so a list of bills needs no query per bill and can be filtered by status.

        due_total follows billing/calculations.py: electricity rounded to paise, then added.
        PostgreSQL rounds halves away from zero, which is half up for these non-negative
        amounts. The serializer still calculates the shown figures with calculations.py.
        """
        return self.annotate(
            paid_total=Coalesce(Sum("payments__amount"), Value(0), output_field=MONEY),
            due_total=models.ExpressionWrapper(
                F("rent_amount")
                + Round(F("electricity_units") * F("electricity_rate"), 2)
                + F("water_amount"),
                output_field=MONEY,
            ),
        )

    def with_payment_status(self, status: str):
        """Bills in one payment status (calculations.PaymentStatus). Needs with_amounts()."""
        if status == "unpaid":
            return self.filter(paid_total=0)
        if status == "partially_paid":
            return self.filter(paid_total__gt=0, paid_total__lt=F("due_total"))
        if status == "paid":
            return self.filter(paid_total__gte=F("due_total"))
        raise ValueError(f"Unknown payment status: {status}")


class RentEntry(models.Model):
    """The charges of one tenancy's bill for one month.

    Rent and electricity rate are copied from the tenancy when the bill is created: they're
    historical values, so changing the tenancy later never changes a saved bill. Totals, paid,
    outstanding and status are derived (billing/calculations.py), never stored.
    """

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
            models.UniqueConstraint(
                fields=["tenancy", "billing_month"],
                name="unique_tenancy_billing_month",
                violation_error_message="An entry already exists for this tenancy and month.",
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


class Payment(models.Model):
    """Money received against one bill. A bill can have several; they're never allocated
    across months. The tenancy and property come through the bill (Payment → RentEntry →
    Tenancy → Property), never stored again here, so they can't contradict it.

    Created only through billing/services.py record_payment, which locks the bill so payments
    never exceed it. Read-only afterwards: editing or reversing payments needs its own rules.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    entry = models.ForeignKey(RentEntry, on_delete=models.PROTECT, related_name="payments")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    paid_date = models.DateField(help_text="The day the money was received.")
    notes = models.CharField(max_length=500, blank=True)
    # One intended payment, chosen by the app (the Idempotency-Key header): a retry with the
    # same key returns this payment instead of recording the money twice.
    idempotency_key = models.UUIDField(editable=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Newest received first; the same day by when it was recorded; then the id, so the
        # order never changes between requests.
        ordering = ("-paid_date", "-created_at", "id")
        constraints = [
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


class Receipt(models.Model):
    """Confirms one payment: a snapshot of everything printed on it, copied when it's issued.

    Later payments, or changes to the tenancy, property or bill, never change an issued receipt:
    reopening or downloading it shows exactly what was saved. The bill's figures are as they
    stood right after this payment (the payments recorded before it, plus this one), so they're
    the same whenever the receipt is issued.

    Created only through billing/services.py issue_payment_receipt, which locks the payment so
    each one gets at most one receipt. Read-only afterwards: corrections and voiding need their
    own workflow.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # One receipt per payment, enforced by the database (a unique column).
    payment = models.OneToOneField(Payment, on_delete=models.PROTECT, related_name="receipt")
    # Tenant_Name_Flat_Rent_Month YYYY (receipt_reference), with _2, _3… for a bill's later
    # receipts. Set once when issued, never regenerated.
    reference = models.CharField(max_length=255, unique=True, editable=False)
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
    )
    issued_at = models.DateTimeField()
    # The property's date when issued, printed on the receipt. Saved rather than worked out from
    # issued_at, which would depend on the time zone of whoever downloads it.
    issued_date = models.DateField()

    # Who issued it, from the property and the issuing person.
    issuer_name = models.CharField(max_length=150)
    issuer_address = models.TextField()
    issuer_contact_number = models.CharField(max_length=20, blank=True)
    received_by_name = models.CharField(max_length=150, blank=True)

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

    class Meta:
        ordering = ("-issued_at", "id")
        constraints = [
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
        return self.reference


def receipt_reference(tenant_name: str, flat_number: str, billing_month: date) -> str:
    """'Shaik Zahid Ali', '202', October 2026 -> 'Shaik_Zahid_Ali_202_Rent_October 2026': the
    tenant's name and flat (spaces as underscores, characters file names can't hold left out)
    and the billed month. A bill's later receipts add _2, _3… (billing/services.py)."""

    def part(value: str) -> str:
        cleaned = re.sub(r'[\\/:*?"<>|]+', "", value)
        return "_".join(cleaned.split())

    return f"{part(tenant_name)}_{part(flat_number)}_Rent_{billing_month:%B %Y}"
