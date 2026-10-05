from rest_framework import serializers

from properties.queries import properties_for_user

from .models import User


class PropertyAccessSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    role = serializers.CharField()


class MeSerializer(serializers.ModelSerializer):
    phoneNumber = serializers.CharField(source="phone_number")
    properties = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "phoneNumber", "properties")
        read_only_fields = fields

    def get_properties(self, user):
        return PropertyAccessSerializer(properties_for_user(user), many=True).data
