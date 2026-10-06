from rest_framework import serializers

from .models import Property, Tenancy


class PropertySerializer(serializers.ModelSerializer):
    contactNumber = serializers.CharField(source="contact_number")
    # The current user's role, annotated by the scoped queryset.
    role = serializers.CharField()

    class Meta:
        model = Property
        fields = ("id", "name", "address", "contactNumber", "role")
        read_only_fields = fields


class TenancySerializer(serializers.ModelSerializer):
    """Money stays a decimal string ("15000.00"): Django is authoritative for amounts, and
    the app converts deliberately at its boundary."""

    propertyId = serializers.UUIDField(source="property_id")
    flatNumber = serializers.CharField(source="flat_number")
    mobileNumber = serializers.CharField(source="mobile_number")
    rentAmount = serializers.DecimalField(source="rent_amount", max_digits=10, decimal_places=2)
    rentDueDay = serializers.IntegerField(source="rent_due_day")
    electricityRate = serializers.DecimalField(
        source="electricity_rate", max_digits=8, decimal_places=2
    )
    depositAmount = serializers.DecimalField(
        source="deposit_amount", max_digits=10, decimal_places=2
    )
    startDate = serializers.DateField(source="start_date")
    endDate = serializers.DateField(source="end_date", allow_null=True)
    status = serializers.SerializerMethodField()

    class Meta:
        model = Tenancy
        fields = (
            "id",
            "propertyId",
            "name",
            "flatNumber",
            "mobileNumber",
            "rentAmount",
            "rentDueDay",
            "electricityRate",
            "depositAmount",
            "startDate",
            "endDate",
            "status",
        )
        read_only_fields = fields

    def get_status(self, tenancy) -> str:
        # One date per request (from the view), so a list never mixes two days.
        return tenancy.status_on(self.context["today"])
