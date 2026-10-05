from rest_framework import serializers

from .models import Property


class PropertySerializer(serializers.ModelSerializer):
    contactNumber = serializers.CharField(source="contact_number")
    # The current user's role, annotated by the scoped queryset.
    role = serializers.CharField()

    class Meta:
        model = Property
        fields = ("id", "name", "address", "contactNumber", "role")
        read_only_fields = fields
