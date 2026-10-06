import uuid
from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from properties.models import Property, PropertyMembership, Tenancy

TODAY = date(2026, 10, 5)


def list_url(property_id):
    return f"/api/v1/properties/{property_id}/tenancies/"


def detail_url(property_id, tenancy_id):
    return f"{list_url(property_id)}{tenancy_id}/"


def make_tenancy(prop, **fields):
    defaults = {
        "name": "Shaik Zahid Ali",
        "flat_number": "202",
        "mobile_number": "+919000000101",
        "rent_amount": Decimal("15000.00"),
        "rent_due_day": 11,
        "electricity_rate": Decimal("6.00"),
        "deposit_amount": Decimal("90000.00"),
        "start_date": date(2026, 1, 1),
    }
    return Tenancy.objects.create(property=prop, **{**defaults, **fields})


@mock.patch("properties.views.business_date", new=mock.Mock(return_value=TODAY))
class TenancyApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username="me", firebase_uid="me")
        self.property_a = Property.objects.create(name="Property A", address="1 Main Road")
        self.property_b = Property.objects.create(name="Property B", address="2 Side Road")
        PropertyMembership.objects.create(user=self.user, property=self.property_a, role="manager")

        self.zahid = make_tenancy(self.property_a)
        self.yusuf = make_tenancy(
            self.property_a, name="Mohammed Yusuf", flat_number="301", end_date=TODAY
        )
        self.ended = make_tenancy(
            self.property_a,
            name="Former Tenant",
            flat_number="102",
            start_date=date(2025, 1, 1),
            end_date=TODAY - timedelta(days=1),
        )
        self.upcoming = make_tenancy(
            self.property_a, name="Next Tenant", flat_number="102", start_date=TODAY + timedelta(1)
        )
        self.other_property = make_tenancy(self.property_b, name="Someone Else", flat_number="202")

        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def names(self, response):
        self.assertEqual(response.status_code, 200)
        return [item["name"] for item in response.json()["results"]]

    def test_lists_current_tenancies_of_my_property_by_default(self):
        # Ending today still counts as current (end dates are inclusive).
        self.assertEqual(
            self.names(self.client.get(list_url(self.property_a.id))),
            ["Shaik Zahid Ali", "Mohammed Yusuf"],
        )

    def test_filters_by_status(self):
        url = list_url(self.property_a.id)

        self.assertEqual(self.names(self.client.get(url, {"status": "ended"})), ["Former Tenant"])
        self.assertEqual(self.names(self.client.get(url, {"status": "upcoming"})), ["Next Tenant"])
        self.assertEqual(
            self.names(self.client.get(url, {"status": "all"})),
            ["Former Tenant", "Next Tenant", "Shaik Zahid Ali", "Mohammed Yusuf"],
        )

    def test_rejects_an_unknown_status(self):
        response = self.client.get(list_url(self.property_a.id), {"status": "active"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("status", response.json())

    def test_searches_name_and_flat_case_insensitively(self):
        url = list_url(self.property_a.id)

        self.assertEqual(self.names(self.client.get(url, {"search": "ZAHID"})), ["Shaik Zahid Ali"])
        self.assertEqual(self.names(self.client.get(url, {"search": " 202 "})), ["Shaik Zahid Ali"])
        # Search applies within the status filter.
        self.assertEqual(self.names(self.client.get(url, {"search": "former"})), [])
        self.assertEqual(
            self.names(self.client.get(url, {"search": "former", "status": "all"})),
            ["Former Tenant"],
        )

    def test_orders_by_flat_then_name(self):
        make_tenancy(self.property_a, name="Aaron", flat_number="G-01")
        make_tenancy(self.property_a, name="Basheer", flat_number="101")

        self.assertEqual(
            self.names(self.client.get(list_url(self.property_a.id))),
            ["Basheer", "Shaik Zahid Ali", "Mohammed Yusuf", "Aaron"],
        )

    def test_paginates_with_count_and_links(self):
        for number in range(25):
            make_tenancy(self.property_a, name=f"Bulk {number:02}", flat_number=f"9{number:02}")

        first = self.client.get(list_url(self.property_a.id)).json()
        second = self.client.get(list_url(self.property_a.id), {"page": 2}).json()

        self.assertEqual(first["count"], 27)
        self.assertEqual(len(first["results"]), 20)
        self.assertIsNone(first["previous"])
        self.assertIn("page=2", first["next"])
        self.assertEqual(len(second["results"]), 7)
        self.assertIsNone(second["next"])

    def test_returns_the_explicit_contract_with_decimal_strings(self):
        response = self.client.get(detail_url(self.property_a.id, self.zahid.id))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "id": str(self.zahid.id),
                "propertyId": str(self.property_a.id),
                "name": "Shaik Zahid Ali",
                "flatNumber": "202",
                "mobileNumber": "+919000000101",
                "rentAmount": "15000.00",
                "rentDueDay": 11,
                "electricityRate": "6.00",
                "depositAmount": "90000.00",
                "startDate": "2026-01-01",
                "endDate": None,
                "status": "current",
            },
        )

    def test_retrieves_an_ended_tenancy(self):
        response = self.client.get(detail_url(self.property_a.id, self.ended.id))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ended")

    def test_a_property_i_dont_belong_to_is_404(self):
        self.assertEqual(self.client.get(list_url(self.property_b.id)).status_code, 404)
        self.assertEqual(
            self.client.get(detail_url(self.property_b.id, self.other_property.id)).status_code,
            404,
        )

    def test_another_propertys_tenancy_under_my_property_is_404(self):
        response = self.client.get(detail_url(self.property_a.id, self.other_property.id))

        self.assertEqual(response.status_code, 404)

    def test_unknown_or_malformed_ids_are_404(self):
        self.assertEqual(self.client.get(list_url(uuid.uuid4())).status_code, 404)
        self.assertEqual(self.client.get(detail_url(self.property_a.id, uuid.uuid4())).status_code, 404)
        self.assertEqual(self.client.get("/api/v1/properties/not-a-uuid/tenancies/").status_code, 404)

    def test_ended_membership_or_inactive_property_is_404(self):
        PropertyMembership.objects.filter(user=self.user).update(is_active=False)
        self.assertEqual(self.client.get(list_url(self.property_a.id)).status_code, 404)

        PropertyMembership.objects.filter(user=self.user).update(is_active=True)
        Property.objects.filter(pk=self.property_a.pk).update(is_active=False)
        self.assertEqual(self.client.get(list_url(self.property_a.id)).status_code, 404)

    def test_read_only(self):
        url = list_url(self.property_a.id)

        self.assertEqual(self.client.post(url, {"name": "New"}).status_code, 405)
        self.assertEqual(
            self.client.delete(detail_url(self.property_a.id, self.zahid.id)).status_code, 405
        )
        self.assertEqual(
            self.client.patch(detail_url(self.property_a.id, self.zahid.id), {}).status_code, 405
        )

    def test_requires_authentication(self):
        client = APIClient()

        self.assertEqual(client.get(list_url(self.property_a.id)).status_code, 401)
        self.assertEqual(client.get(detail_url(self.property_a.id, self.zahid.id)).status_code, 401)
