from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import TestCase
from django.urls import reverse

from properties.models import Property, PropertyMembership


class PropertyMembershipModelTests(TestCase):
    def test_one_membership_per_user_and_property(self):
        user = get_user_model().objects.create_user(username="u")
        prop = Property.objects.create(name="P", address="A")
        PropertyMembership.objects.create(user=user, property=prop, role="owner")

        with self.assertRaises(IntegrityError):
            PropertyMembership.objects.create(user=user, property=prop, role="manager")


class PropertyAdminTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_superuser(username="admin", password="x")
        self.client.force_login(self.admin)
        self.property = Property.objects.create(name="Tower", address="A")
        PropertyMembership.objects.create(user=self.admin, property=self.property, role="owner")

    def test_property_pages_load_with_memberships_inline(self):
        self.assertContains(self.client.get(reverse("admin:properties_property_changelist")), "Tower")
        response = self.client.get(
            reverse("admin:properties_property_change", args=[self.property.pk])
        )
        self.assertContains(response, "memberships-TOTAL_FORMS")

    def test_membership_pages_load(self):
        self.assertContains(
            self.client.get(reverse("admin:properties_propertymembership_changelist")), "Tower"
        )
        self.assertEqual(
            self.client.get(reverse("admin:properties_propertymembership_add")).status_code, 200
        )
