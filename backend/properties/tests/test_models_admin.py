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

    def test_reads_as_person_property_and_role(self):
        user = get_user_model()(username="u", phone_number="+918977867546")
        membership = PropertyMembership(user=user, property=Property(name="Tower"), role="manager")

        self.assertEqual(str(membership), "+91 89778 67546 | Tower | Manager")


class PropertyAdminTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_superuser(username="admin", password="x")
        self.client.force_login(self.admin)
        self.property = Property.objects.create(name="Tower", address="A")
        self.owner = User.objects.create_user(
            username="o", firebase_uid="uid-o", phone_number="+918977867546"
        )
        self.manager = User.objects.create_user(
            username="m", firebase_uid="uid-m", phone_number="+919000000002"
        )
        PropertyMembership.objects.create(user=self.owner, property=self.property, role="owner")

    def test_property_list_shows_owners_and_member_count(self):
        PropertyMembership.objects.create(
            user=self.manager, property=self.property, role="manager", is_active=False
        )

        response = self.client.get(reverse("admin:properties_property_changelist"))

        self.assertContains(response, "+91 89778 67546")
        self.assertEqual(response.context["cl"].result_list[0].active_members, 1)

    def test_property_page_lists_members_by_number(self):
        response = self.client.get(reverse("admin:properties_property_change", args=[self.property.pk]))

        self.assertContains(response, "memberships-TOTAL_FORMS")
        self.assertContains(response, "+91 89778 67546")

    def test_membership_list_reads_as_person_property_role(self):
        response = self.client.get(reverse("admin:properties_propertymembership_changelist"))

        self.assertContains(response, "+91 89778 67546")
        self.assertContains(response, "Tower")
        self.assertContains(response, "Owner")

    def test_adding_a_membership_records_who_granted_it(self):
        response = self.client.post(
            reverse("admin:properties_propertymembership_add"),
            {
                "user": self.manager.pk,
                "property": self.property.pk,
                "role": "manager",
                "is_active": "on",
            },
        )

        self.assertEqual(response.status_code, 302)
        membership = PropertyMembership.objects.get(user=self.manager)
        self.assertEqual(membership.granted_by, self.admin)

    def test_memberships_are_ended_not_deleted(self):
        membership = PropertyMembership.objects.get(user=self.owner)

        response = self.client.get(
            reverse("admin:properties_propertymembership_delete", args=[membership.pk])
        )

        self.assertEqual(response.status_code, 403)
