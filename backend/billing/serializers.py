import re
from datetime import date
from decimal import Decimal

from rest_framework import serializers

from properties.models import business_date

from .calculations import due_status, entry_amounts
from .models import Payment, PaymentReversal, Receipt, RentEntry

MONTH_PATTERN = re.compile(r"^(\d{4})-(\d{2})$")

# Who did something, for people who can read the bill. A person's name is optional; the
# username is internal ("app-<hex>") and the phone number is personal, so neither stands in.
UNNAMED_PERSON = "Unnamed person"


def person_name(user) -> str:
    return user.name.strip() or UNNAMED_PERSON

# Set by the server, never by the request.
SERVER_ASSIGNED_FIELDS = {
    "id",
    "tenancy",
    "tenancyId",
    "electricityRate",
    "createdBy",
    "createdAt",
    "voidedAt",
    "voidedByName",
    "voidReason",
    "replacesEntryId",
    "replacedByEntryId",
    "paymentTiming",
    "dueDate",
}
# Derived from the charges and payments, never typed in.
DERIVED_FIELDS = {
    "electricityAmount",
    "totalDue",
    "totalPaid",
    "outstanding",
    "outstandingAmount",
    "paymentStatus",
    "status",
    "dueStatus",
}
# Payments are separate records: one received with a new bill is sent as initialPayment.
PAYMENT_FIELDS = {
    "paidDate",
    "paymentAmount",
    "paymentNotes",
    "amountPaid",
    "payment",
    "payments",
}


def format_month(value: date) -> str:
    return f"{value.year:04}-{value.month:02}"


class BillingMonthField(serializers.Field):
    """'YYYY-MM' in and out; stored as the first day of the month."""

    default_error_messages = {"invalid": "Enter the billing month as YYYY-MM, e.g. 2026-10."}

    def to_internal_value(self, data):
        match = MONTH_PATTERN.match(data) if isinstance(data, str) else None
        if not match:
            self.fail("invalid")
        year, month = int(match[1]), int(match[2])
        if not (1 <= month <= 12 and year >= 1):
            self.fail("invalid")
        return date(year, month, 1)

    def to_representation(self, value):
        return format_month(value)


def refuse_unknown_fields(serializer, data):
    """Refused, not ignored: silently dropping a field would lose what the user entered."""
    if not isinstance(data, dict):
        return
    errors = {}
    for key in data.keys() - serializer.fields.keys():
        if key in SERVER_ASSIGNED_FIELDS:
            errors[key] = ["This is set by the server."]
        elif key in DERIVED_FIELDS:
            errors[key] = ["This is calculated by the server."]
        elif key in PAYMENT_FIELDS and isinstance(serializer, RentEntryCreateSerializer):
            errors[key] = ["Send a payment received with the bill as initialPayment."]
        else:
            errors[key] = ["Unknown field."]
    if errors:
        raise serializers.ValidationError(errors)


class PaymentCreateSerializer(serializers.Serializer):
    """Money received against a bill. The bill, creator, id and timestamp are assigned on the
    server; total paid, outstanding and status are derived from the payments."""

    amount = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal("0.01"),
        error_messages={
            "min_value": "Enter an amount greater than zero.",
            "max_decimal_places": "Amount can have at most two decimal places.",
        },
    )
    paidDate = serializers.DateField(source="paid_date")
    notes = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
        error_messages={"max_length": "Notes must be 500 characters or fewer."},
    )

    def validate_paidDate(self, value):
        # The property's business date (India), never the server's or the browser's. Any
        # earlier date is fine: September rent can be paid in October.
        if value > business_date():
            raise serializers.ValidationError("The paid date can't be in the future.")
        return value

    def to_internal_value(self, data):
        refuse_unknown_fields(self, data)
        return super().to_internal_value(data)


class PaymentReversalCreateSerializer(serializers.Serializer):
    """Why a payment is being reversed. The payment comes from the URL; the person and time are
    the server's."""

    reason = serializers.CharField(
        max_length=500,
        trim_whitespace=True,
        error_messages={
            "required": "Say why this payment is being reversed.",
            "blank": "Say why this payment is being reversed.",
            "max_length": "The reason must be 500 characters or fewer.",
        },
    )

    def to_internal_value(self, data):
        refuse_unknown_fields(self, data)
        return super().to_internal_value(data)


def receipt_status(receipt: Receipt) -> str:
    return "issued" if receipt.voided_at is None else "void"


class PaymentSerializer(serializers.ModelSerializer):
    """A recorded payment. The amount is a decimal string ("3000.00").

    status: "recorded", or "reversed" once corrected (it then no longer counts towards the
    bill), with reversal: {id, reason, createdAt, createdByName}, else null. receipt: {id,
    reference, status} once one is issued ("issued", or "void" after a reversal), else null.
    Lists load both in the same query (select_related("receipt", "reversal__created_by")).
    """

    entryId = serializers.UUIDField(source="entry_id")
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    paidDate = serializers.DateField(source="paid_date")
    createdAt = serializers.DateTimeField(source="created_at")
    status = serializers.SerializerMethodField()
    reversal = serializers.SerializerMethodField()
    receipt = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = (
            "id",
            "entryId",
            "amount",
            "paidDate",
            "notes",
            "createdAt",
            "status",
            "reversal",
            "receipt",
        )
        read_only_fields = fields

    def _reversal(self, payment) -> PaymentReversal | None:
        try:
            return payment.reversal
        except PaymentReversal.DoesNotExist:
            return None

    def get_status(self, payment):
        return "recorded" if self._reversal(payment) is None else "reversed"

    def get_reversal(self, payment):
        reversal = self._reversal(payment)
        if reversal is None:
            return None
        return {
            "id": str(reversal.id),
            "reason": reversal.reason,
            "createdAt": serializers.DateTimeField().to_representation(reversal.created_at),
            "createdByName": person_name(reversal.created_by),
        }

    def get_receipt(self, payment):
        try:
            receipt = payment.receipt
        except Receipt.DoesNotExist:
            return None
        return {
            "id": str(receipt.id),
            "reference": receipt.reference,
            "status": receipt_status(receipt),
        }


def money(value) -> str:
    return f"{value:.2f}"


class ReceiptSerializer(serializers.BaseSerializer):
    """An issued receipt, entirely from its saved snapshot: never today's tenancy, property,
    bill or payment details. Money is a decimal string. status: "issued", or "void" once its
    payment was reversed (voidedAt and voidReason then say when and why; null and "" before)."""

    def to_representation(self, receipt: Receipt):
        return {
            "id": str(receipt.id),
            "reference": receipt.reference,
            "paymentId": str(receipt.payment_id),
            "entryId": str(receipt.payment.entry_id),
            "issuedAt": serializers.DateTimeField().to_representation(receipt.issued_at),
            "issuedDate": receipt.issued_date.isoformat(),
            "issuer": {
                "name": receipt.issuer_name,
                "address": receipt.issuer_address,
                "contactNumber": receipt.issuer_contact_number,
                "receivedBy": receipt.received_by_name,
                "authorizedBy": receipt.authorized_by_name,
            },
            "tenant": {
                "name": receipt.tenant_name,
                "flatNumber": receipt.flat_number,
                "mobileNumber": receipt.tenant_mobile_number,
                "depositAmount": money(receipt.deposit_amount),
            },
            "billingMonth": format_month(receipt.billing_month),
            "rentDueDay": receipt.rent_due_day,
            "charges": {
                "rentAmount": money(receipt.rent_amount),
                "electricityUnits": f"{receipt.electricity_units:.3f}",
                "electricityRate": money(receipt.electricity_rate),
                "electricityAmount": money(receipt.electricity_amount),
                "waterAmount": money(receipt.water_amount),
            },
            "totalDue": money(receipt.total_due),
            "totalPaid": money(receipt.total_paid),
            "outstandingAmount": money(receipt.outstanding_amount),
            "previousMonthOutstanding": money(receipt.previous_month_outstanding),
            "paymentAmount": money(receipt.payment_amount),
            "paidDate": receipt.paid_date.isoformat(),
            "paymentNotes": receipt.payment_notes,
            "status": receipt_status(receipt),
            "voidedAt": None
            if receipt.voided_at is None
            else serializers.DateTimeField().to_representation(receipt.voided_at),
            "voidReason": receipt.void_reason,
        }


class EntryVoidSerializer(serializers.Serializer):
    """Why a bill is being voided. The bill comes from the URL; the person and time are the
    server's."""

    reason = serializers.CharField(
        max_length=500,
        trim_whitespace=True,
        error_messages={
            "required": "Say why this bill is being voided.",
            "blank": "Say why this bill is being voided.",
            "max_length": "The reason must be 500 characters or fewer.",
        },
    )

    def to_internal_value(self, data):
        refuse_unknown_fields(self, data)
        return super().to_internal_value(data)


class EntryCorrectionSerializer(EntryVoidSerializer):
    """A replacement's charges, and why the bill is corrected. Its tenancy, month and
    electricity rate are the original bill's, so they're refused here (as server-assigned or
    unknown)."""

    rentAmount = serializers.DecimalField(
        source="rent_amount",
        max_digits=10,
        decimal_places=2,
        min_value=Decimal("0.01"),
        error_messages={"min_value": "Rent must be more than zero."},
    )
    electricityUnits = serializers.DecimalField(
        source="electricity_units",
        max_digits=10,
        decimal_places=3,
        min_value=Decimal("0"),
        error_messages={"min_value": "Electricity units can't be negative."},
    )
    waterAmount = serializers.DecimalField(
        source="water_amount",
        max_digits=10,
        decimal_places=2,
        min_value=Decimal("0"),
        error_messages={"min_value": "The water amount can't be negative."},
    )
    notes = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
        error_messages={"max_length": "Notes must be 500 characters or fewer."},
    )


class RentEntryCreateSerializer(serializers.Serializer):
    """What the app may send for a new bill. The tenancy, electricity rate, creator, id and
    timestamps are assigned on the server (billing/services.py)."""

    billingMonth = BillingMonthField(source="billing_month")
    # Optional: defaults to the tenancy's current rent. Sent when the operator overrides it.
    rentAmount = serializers.DecimalField(
        source="rent_amount",
        max_digits=10,
        decimal_places=2,
        min_value=Decimal("0.01"),
        required=False,
        error_messages={"min_value": "Rent must be more than zero."},
    )
    electricityUnits = serializers.DecimalField(
        source="electricity_units",
        max_digits=10,
        decimal_places=3,
        min_value=Decimal("0"),
        error_messages={"min_value": "Electricity units can't be negative."},
    )
    waterAmount = serializers.DecimalField(
        source="water_amount",
        max_digits=10,
        decimal_places=2,
        min_value=Decimal("0"),
        error_messages={"min_value": "The water amount can't be negative."},
    )
    notes = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
        error_messages={"max_length": "Notes must be 500 characters or fewer."},
    )
    # Optional: money received with the bill, saved with it or not at all.
    initialPayment = PaymentCreateSerializer(source="initial_payment", required=False)

    def to_internal_value(self, data):
        refuse_unknown_fields(self, data)
        return super().to_internal_value(data)


class RentEntrySerializer(serializers.ModelSerializer):
    """A saved bill. Money is a decimal string ("15750.00"); totals come from
    billing/calculations.py, so the app displays them rather than recalculating.

    status: "active", or "void" (voidedAt, voidedByName and voidReason say when, by whom and
    why; null, null and "" before). A void bill keeps its charges and totalDue, owes nothing
    (outstandingAmount "0.00") and has no paymentStatus (null). replacesEntryId and
    replacedByEntryId link a correction's two bills (else null). Lists load the voider and
    replacement in the same query (select_related("voided_by", "replaced_by")).

    paymentTiming ("prepaid" | "postpaid") and dueDate are saved with the bill. dueStatus
    ("settled", "overdue", "due_today", "upcoming") compares them with today at the property;
    all three are null on a bill from before due dates, and dueStatus is null on a void bill.
    """

    tenancyId = serializers.UUIDField(source="tenancy_id")
    billingMonth = BillingMonthField(source="billing_month")
    rentAmount = serializers.DecimalField(source="rent_amount", max_digits=10, decimal_places=2)
    electricityUnits = serializers.DecimalField(
        source="electricity_units", max_digits=10, decimal_places=3
    )
    electricityRate = serializers.DecimalField(
        source="electricity_rate", max_digits=8, decimal_places=2
    )
    waterAmount = serializers.DecimalField(source="water_amount", max_digits=10, decimal_places=2)
    createdAt = serializers.DateTimeField(source="created_at")

    class Meta:
        model = RentEntry
        fields = (
            "id",
            "tenancyId",
            "billingMonth",
            "rentAmount",
            "electricityUnits",
            "electricityRate",
            "waterAmount",
            "notes",
            "createdAt",
        )
        read_only_fields = fields

    def to_representation(self, instance):
        data = super().to_representation(instance)
        amounts = entry_amounts(instance)
        return {
            "id": data["id"],
            "tenancyId": data["tenancyId"],
            "billingMonth": data["billingMonth"],
            "rentAmount": data["rentAmount"],
            "electricityUnits": data["electricityUnits"],
            "electricityRate": data["electricityRate"],
            "electricityAmount": str(amounts.electricity_amount),
            "waterAmount": data["waterAmount"],
            "totalDue": str(amounts.total_due),
            "totalPaid": str(amounts.total_paid),
            "outstandingAmount": str(amounts.outstanding_amount),
            "paymentStatus": amounts.payment_status,
            "paymentTiming": instance.payment_timing,
            "dueDate": None if instance.due_date is None else instance.due_date.isoformat(),
            "dueStatus": None
            if instance.status == RentEntry.Status.VOID
            else due_status(instance.due_date, amounts.outstanding_amount, business_date()),
            "notes": data["notes"],
            "createdAt": data["createdAt"],
            "status": instance.status,
            "voidedAt": None
            if instance.voided_at is None
            else serializers.DateTimeField().to_representation(instance.voided_at),
            "voidedByName": None if instance.voided_by is None else person_name(instance.voided_by),
            "voidReason": instance.void_reason,
            "replacesEntryId": None
            if instance.replaces_entry_id is None
            else str(instance.replaces_entry_id),
            "replacedByEntryId": replaced_by_id(instance),
        }


def replaced_by_id(entry: RentEntry) -> str | None:
    try:
        return str(entry.replaced_by.pk)
    except RentEntry.DoesNotExist:
        return None
