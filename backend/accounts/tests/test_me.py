from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from properties.models import Property, PropertyMembership

ME_URL = "/api/v1/me/"


class MeTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="u", firebase_uid="uid", phone_number="+910000000001", email="u@example.com"
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def add_property(self, name, *, role="owner", membership_active=True, property_active=True):
        prop = Property.objects.create(name=name, address="Address", is_active=property_active)
        PropertyMembership.objects.create(
            user=self.user, property=prop, role=role, is_active=membership_active
        )
        return prop

    def test_returns_only_explicit_fields(self):
        data = self.client.get(ME_URL).json()

        self.assertEqual(data, {"id": self.user.id, "phoneNumber": "+910000000001", "properties": []})

    def test_lists_active_memberships_of_active_properties_with_roles(self):
        tower = self.add_property("Tower", role="owner")
        annex = self.add_property("Annex", role="manager")
        self.add_property("Old membership", membership_active=False)
        self.add_property("Closed property", property_active=False)

        properties = self.client.get(ME_URL).json()["properties"]

        self.assertEqual(
            properties,
            [
                {"id": str(annex.id), "name": "Annex", "role": "manager"},
                {"id": str(tower.id), "name": "Tower", "role": "owner"},
            ],
        )
