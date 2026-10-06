import re
from datetime import date
from decimal import Decimal

from rest_framework import serializers

from properties.models import business_date

from .calculations import entry_amounts
from .models import Payment, RentEntry

MONTH_PATTERN = re.compile(r"^(\d{4})-(\d{2})$")

# Set by the server, never by the request.
SERVER_ASSIGNED_FIELDS = {
    "id",
    "tenancy",
    "tenancyId",
    "electricityRate",
    "createdBy",
    "createdAt",
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


class PaymentSerializer(serializers.ModelSerializer):
    """A recorded payment. The amount is a decimal string ("3000.00")."""

    entryId = serializers.UUIDField(source="entry_id")
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    paidDate = serializers.DateField(source="paid_date")
    createdAt = serializers.DateTimeField(source="created_at")

    class Meta:
        model = Payment
        fields = ("id", "entryId", "amount", "paidDate", "notes", "createdAt")
        read_only_fields = fields


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
    billing/calculations.py, so the app displays them rather than recalculating."""

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
            "notes": data["notes"],
            "createdAt": data["createdAt"],
        }
