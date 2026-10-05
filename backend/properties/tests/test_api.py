import uuid
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from properties.models import Property, PropertyMembership

LIST_URL = "/api/v1/properties/"


def detail_url(property_id):
    return f"{LIST_URL}{property_id}/"


class PropertyApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username="me", firebase_uid="me")
        self.other = User.objects.create_user(username="other", firebase_uid="other")
        self.property_a = Property.objects.create(
            name="Property A", address="1 Main Road", contact_number="+910000000002"
        )
        self.property_b = Property.objects.create(name="Property B", address="2 Side Road")
        self.membership = PropertyMembership.objects.create(
            user=self.user, property=self.property_a, role="owner"
        )
        PropertyMembership.objects.create(user=self.other, property=self.property_b, role="owner")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_lists_only_my_properties(self):
        response = self.client.get(LIST_URL)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            [
                {
                    "id": str(self.property_a.id),
                    "name": "Property A",
                    "address": "1 Main Road",
                    "contactNumber": "+910000000002",
                    "role": "owner",
                }
            ],
        )

    def test_no_membership_lists_nothing(self):
        self.membership.delete()

        response = self.client.get(LIST_URL)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_retrieves_an_assigned_property(self):
        response = self.client.get(detail_url(self.property_a.id))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["name"], "Property A")

    def test_unassigned_missing_and_malformed_ids_are_404(self):
        for property_id in [self.property_b.id, uuid.uuid4(), "not-a-uuid"]:
            with self.subTest(property_id=property_id):
                self.assertEqual(self.client.get(detail_url(property_id)).status_code, 404)

    def test_inactive_membership_removes_access(self):
        self.membership.is_active = False
        self.membership.save()

        self.assertEqual(self.client.get(LIST_URL).json(), [])
        self.assertEqual(self.client.get(detail_url(self.property_a.id)).status_code, 404)

    def test_inactive_property_is_inaccessible(self):
        self.property_a.is_active = False
        self.property_a.save()

        self.assertEqual(self.client.get(LIST_URL).json(), [])
        self.assertEqual(self.client.get(detail_url(self.property_a.id)).status_code, 404)

    def test_role_is_my_own_when_a_property_has_several_members(self):
        PropertyMembership.objects.create(user=self.other, property=self.property_a, role="manager")

        self.assertEqual([p["role"] for p in self.client.get(LIST_URL).json()], ["owner"])
        self.client.force_authenticate(self.other)
        self.assertEqual(
            self.client.get(detail_url(self.property_a.id)).json()["role"], "manager"
        )

    def test_admin_users_get_no_access_without_membership(self):
        admin = get_user_model().objects.create_superuser(username="admin", password="x")
        self.client.force_authenticate(admin)

        self.assertEqual(self.client.get(LIST_URL).json(), [])

    def test_read_only(self):
        self.assertEqual(self.client.post(LIST_URL, {"name": "New"}).status_code, 405)
        self.assertEqual(self.client.delete(detail_url(self.property_a.id)).status_code, 405)

    @mock.patch("accounts.authentication.verify_firebase_token")
    def test_requires_authentication(self, verify):
        client = APIClient()

        self.assertEqual(client.get(LIST_URL).status_code, 401)
        self.assertEqual(client.get(detail_url(self.property_a.id)).status_code, 401)

        verify.return_value = {"uid": "me"}
        client.credentials(HTTP_AUTHORIZATION="Bearer token")
        self.assertEqual(len(client.get(LIST_URL).json()), 1)
