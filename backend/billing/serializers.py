import re
from datetime import date
from decimal import Decimal

from rest_framework import serializers

from .calculations import entry_amounts
from .models import RentEntry

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
    "outstanding",
    "outstandingAmount",
    "paymentStatus",
    "status",
}
# Payments are separate records (BE Phase 5): a payment sent with a bill would be lost.
PAYMENT_FIELDS = {
    "totalPaid",
    "paidDate",
    "paymentAmount",
    "paymentNotes",
    "amountPaid",
    "initialPayment",
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

    def to_internal_value(self, data):
        # Refused, not ignored: silently dropping a field would lose what the user entered.
        if isinstance(data, dict):
            errors = {}
            for key in data.keys() - self.fields.keys():
                if key in PAYMENT_FIELDS:
                    errors[key] = ["Payments can't be recorded with a bill yet."]
                elif key in SERVER_ASSIGNED_FIELDS:
                    errors[key] = ["This is set by the server."]
                elif key in DERIVED_FIELDS:
                    errors[key] = ["This is calculated by the server."]
                else:
                    errors[key] = ["Unknown field."]
            if errors:
                raise serializers.ValidationError(errors)
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
