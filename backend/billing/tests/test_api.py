import uuid
from datetime import date
from decimal import Decimal
from unittest import mock

from django.db import IntegrityError
from django.test import TestCase
from rest_framework.test import APIClient

from billing.models import RentEntry
from properties.models import PropertyMembership

from .factories import make_property, make_tenancy, make_user


def list_url(property_id, tenancy_id):
    return f"/api/v1/properties/{property_id}/tenancies/{tenancy_id}/entries/"


def detail_url(property_id, tenancy_id, entry_id):
    return f"{list_url(property_id, tenancy_id)}{entry_id}/"


VALID_BILL = {
    "billingMonth": "2026-10",
    "rentAmount": "15000.00",
    "electricityUnits": "75.000",
    "waterAmount": "300.00",
    "notes": "October charges",
}


class RentEntryApiTestCase(TestCase):
    def setUp(self):
        self.user = make_user()
        self.property = make_property(member=self.user)
        self.tenancy = make_tenancy(self.property)
        self.url = list_url(self.property.id, self.tenancy.id)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def create(self, **changes):
        body = {key: value for key, value in {**VALID_BILL, **changes}.items() if value is not None}
        return self.client.post(self.url, body, format="json")

    def make_entry(self, tenancy=None, month=date(2026, 10, 1), **fields):
        defaults = {
            "rent_amount": Decimal("15000.00"),
            "electricity_units": Decimal("75.000"),
            "electricity_rate": Decimal("6.00"),
            "water_amount": Decimal("300.00"),
            "created_by": self.user,
        }
        return RentEntry.objects.create(
            tenancy=tenancy or self.tenancy, billing_month=month, **{**defaults, **fields}
        )


class CreateRentEntryTests(RentEntryApiTestCase):
    def test_creates_a_bill_and_returns_the_calculated_contract(self):
        response = self.create()

        self.assertEqual(response.status_code, 201)
        entry = RentEntry.objects.get()
        body = response.json()
        self.assertEqual(
            {key: value for key, value in body.items() if key != "createdAt"},
            {
                "id": str(entry.id),
                "tenancyId": str(self.tenancy.id),
                "billingMonth": "2026-10",
                "rentAmount": "15000.00",
                "electricityUnits": "75.000",
                "electricityRate": "6.00",
                "electricityAmount": "450.00",
                "waterAmount": "300.00",
                "totalDue": "15750.00",
                "totalPaid": "0.00",
                "outstandingAmount": "15750.00",
                "paymentStatus": "unpaid",
                "notes": "October charges",
            },
        )
        self.assertTrue(body["createdAt"])
        self.assertEqual(entry.billing_month, date(2026, 10, 1))
        self.assertEqual(entry.created_by, self.user)

    def test_rounds_electricity_to_paise(self):
        response = self.create(electricityUnits="1.125", waterAmount="0")

        self.assertEqual(response.json()["electricityAmount"], "6.75")
        self.assertEqual(response.json()["totalDue"], "15006.75")

    def test_rent_defaults_from_the_tenancy_and_can_be_overridden(self):
        defaulted = self.create(rentAmount=None)
        overridden = self.create(billingMonth="2026-09", rentAmount="7500.50")

        self.assertEqual(defaulted.json()["rentAmount"], "15000.00")
        self.assertEqual(overridden.json()["rentAmount"], "7500.50")

    def test_rate_tenancy_creator_and_id_come_from_the_server(self):
        other_user = make_user("other")
        other_tenancy = make_tenancy(make_property("Property B"), flat_number="301")

        for field, value in [
            ("electricityRate", "1.00"),
            ("tenancyId", str(other_tenancy.id)),
            ("tenancy", str(other_tenancy.id)),
            ("createdBy", other_user.id),
            ("id", str(uuid.uuid4())),
            ("createdAt", "2020-01-01T00:00:00Z"),
        ]:
            with self.subTest(field=field):
                response = self.create(**{field: value})

                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json(), {field: ["This is set by the server."]})
        self.assertFalse(RentEntry.objects.exists())

    def test_rejects_payment_and_derived_fields_rather_than_ignoring_them(self):
        for field, value, message in [
            ("totalPaid", "500.00", "Payments can't be recorded with a bill yet."),
            ("paidDate", "2026-10-05", "Payments can't be recorded with a bill yet."),
            ("initialPayment", {"amount": "500.00"}, "Payments can't be recorded with a bill yet."),
            ("totalDue", "1.00", "This is calculated by the server."),
            ("paymentStatus", "paid", "This is calculated by the server."),
            ("surprise", "x", "Unknown field."),
        ]:
            with self.subTest(field=field):
                response = self.create(**{field: value})

                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json(), {field: [message]})
        self.assertFalse(RentEntry.objects.exists())

    def test_uses_the_tenancys_current_rate(self):
        self.tenancy.electricity_rate = Decimal("7.50")
        self.tenancy.save()

        response = self.create()

        self.assertEqual(response.json()["electricityRate"], "7.50")
        self.assertEqual(response.json()["electricityAmount"], "562.50")

    def test_saved_bills_keep_their_charges_when_the_tenancy_changes(self):
        entry_id = self.create().json()["id"]

        self.tenancy.rent_amount = Decimal("20000.00")
        self.tenancy.electricity_rate = Decimal("9.00")
        self.tenancy.save()
        response = self.client.get(detail_url(self.property.id, self.tenancy.id, entry_id))

        self.assertEqual(response.json()["rentAmount"], "15000.00")
        self.assertEqual(response.json()["electricityRate"], "6.00")
        self.assertEqual(response.json()["totalDue"], "15750.00")

    def test_validates_the_billing_month(self):
        for value in ["2026-13", "2026-00", "2026-1", "October", "2026-10-01", "", 202610]:
            with self.subTest(value=value):
                response = self.create(billingMonth=value)

                self.assertEqual(response.status_code, 400)
                self.assertIn("billingMonth", response.json())

        self.assertIn("billingMonth", self.create(billingMonth=None).json())

    def test_validates_amounts(self):
        cases = [
            ("rentAmount", "0"),
            ("rentAmount", "-1"),
            ("rentAmount", "100.001"),
            ("rentAmount", "abc"),
            ("electricityUnits", "-0.001"),
            ("electricityUnits", "1.0001"),
            ("electricityUnits", None),
            ("waterAmount", "-1"),
            ("waterAmount", "1.234"),
            ("waterAmount", None),
            ("waterAmount", "NaN"),
            ("waterAmount", "Infinity"),
        ]
        for field, value in cases:
            with self.subTest(field=field, value=value):
                response = self.create(**{field: value})

                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json())
        self.assertFalse(RentEntry.objects.exists())

    def test_allows_zero_units_and_water(self):
        response = self.create(electricityUnits="0", waterAmount="0")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["totalDue"], "15000.00")

    def test_notes_are_optional_trimmed_and_limited(self):
        self.assertEqual(self.create(notes=None).json()["notes"], "")
        self.assertEqual(self.create(billingMonth="2026-09", notes="  hi  ").json()["notes"], "hi")
        self.assertEqual(self.create(billingMonth="2026-08", notes="x" * 500).status_code, 201)

        response = self.create(billingMonth="2026-07", notes="x" * 501)
        self.assertEqual(response.status_code, 400)
        self.assertIn("notes", response.json())

    def test_rejects_a_month_outside_the_occupancy(self):
        self.tenancy.start_date = date(2026, 9, 20)
        self.tenancy.end_date = date(2026, 12, 31)
        self.tenancy.save()

        self.assertEqual(self.create(billingMonth="2026-08").status_code, 400)
        self.assertEqual(
            self.create(billingMonth="2027-01").json(),
            {"billingMonth": ["This month is outside the tenancy's occupancy period."]},
        )
        # A part month at either end is allowed; rent isn't prorated.
        self.assertEqual(self.create(billingMonth="2026-09").json()["rentAmount"], "15000.00")
        self.assertEqual(self.create(billingMonth="2026-12").status_code, 201)

    def test_allows_historical_bills_for_an_ended_tenancy(self):
        self.tenancy.end_date = date(2026, 3, 15)
        self.tenancy.save()

        self.assertEqual(self.create(billingMonth="2026-03").status_code, 201)
        self.assertEqual(self.create(billingMonth="2026-04").status_code, 400)

    def test_a_second_bill_for_the_month_is_a_409(self):
        self.assertEqual(self.create().status_code, 201)

        response = self.create(rentAmount="1.00")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json(),
            {
                "code": "duplicate_billing_month",
                "detail": "An entry already exists for this tenancy and billing month.",
            },
        )
        self.assertEqual(RentEntry.objects.count(), 1)

    def test_a_unique_constraint_race_is_also_a_409(self):
        # Another request saved the month between our check and our insert.
        with mock.patch("billing.services.RentEntry.objects.filter") as filter_:
            filter_.return_value.exists.return_value = False
            self.make_entry()
            response = self.create()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "duplicate_billing_month")
        self.assertEqual(RentEntry.objects.count(), 1)

    def test_other_integrity_errors_are_not_reported_as_duplicates(self):
        with (
            mock.patch(
                "billing.services.RentEntry.objects.create",
                side_effect=IntegrityError("some other constraint"),
            ),
            self.assertRaises(IntegrityError),
        ):
            self.create()


class RentEntryAccessTests(RentEntryApiTestCase):
    def setUp(self):
        super().setUp()
        self.entry = self.make_entry()
        self.other_property = make_property("Property B")
        self.other_tenancy = make_tenancy(self.other_property, flat_number="301")
        self.other_entry = self.make_entry(tenancy=self.other_tenancy)

    def assert_no_access(self, property_id, tenancy_id, entry_id):
        self.assertEqual(self.client.get(list_url(property_id, tenancy_id)).status_code, 404)
        self.assertEqual(
            self.client.get(detail_url(property_id, tenancy_id, entry_id)).status_code, 404
        )
        response = self.client.post(
            list_url(property_id, tenancy_id), {**VALID_BILL, "billingMonth": "2026-05"}
        )
        self.assertEqual(response.status_code, 404)

    def test_another_propertys_bills_are_not_found(self):
        self.assert_no_access(self.other_property.id, self.other_tenancy.id, self.other_entry.id)
        # Nor through my property's URL.
        self.assert_no_access(self.property.id, self.other_tenancy.id, self.other_entry.id)
        self.assertEqual(RentEntry.objects.count(), 2)

    def test_another_tenancys_bill_is_not_found_under_mine(self):
        sibling = make_tenancy(self.property, flat_number="102")
        sibling_entry = self.make_entry(tenancy=sibling)

        response = self.client.get(detail_url(self.property.id, self.tenancy.id, sibling_entry.id))

        self.assertEqual(response.status_code, 404)

    def test_an_ended_membership_or_inactive_property_removes_access(self):
        PropertyMembership.objects.filter(user=self.user).update(is_active=False)
        self.assert_no_access(self.property.id, self.tenancy.id, self.entry.id)

        PropertyMembership.objects.filter(user=self.user).update(is_active=True)
        self.property.is_active = False
        self.property.save()
        self.assert_no_access(self.property.id, self.tenancy.id, self.entry.id)

    def test_unknown_ids_are_not_found(self):
        self.assert_no_access(uuid.uuid4(), self.tenancy.id, self.entry.id)
        self.assert_no_access(self.property.id, uuid.uuid4(), self.entry.id)
        response = self.client.get(detail_url(self.property.id, self.tenancy.id, uuid.uuid4()))
        self.assertEqual(response.status_code, 404)

    def test_requires_authentication(self):
        client = APIClient()

        self.assertEqual(client.get(self.url).status_code, 401)
        self.assertEqual(client.post(self.url, VALID_BILL, format="json").status_code, 401)

    def test_both_roles_can_add_bills(self):
        for role, month in [("owner", "2026-05"), ("manager", "2026-06")]:
            with self.subTest(role=role):
                PropertyMembership.objects.filter(user=self.user).update(role=role)
                self.assertEqual(self.create(billingMonth=month).status_code, 201)

    def test_an_unknown_role_cannot_add_bills(self):
        PropertyMembership.objects.filter(user=self.user).update(role="viewer")

        self.assertEqual(self.create(billingMonth="2026-05").status_code, 403)
        # Reading is what any active membership allows.
        self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_no_update_or_delete(self):
        url = detail_url(self.property.id, self.tenancy.id, self.entry.id)

        for method in ("put", "patch", "delete"):
            with self.subTest(method=method):
                self.assertEqual(getattr(self.client, method)(url).status_code, 405)


class ListRentEntryTests(RentEntryApiTestCase):
    def months(self, response):
        self.assertEqual(response.status_code, 200)
        return [item["billingMonth"] for item in response.json()["results"]]

    def test_lists_newest_month_first(self):
        for month in [date(2026, 3, 1), date(2025, 12, 1), date(2026, 10, 1)]:
            self.make_entry(month=month)
        self.make_entry(tenancy=make_tenancy(self.property, flat_number="301"))

        self.assertEqual(self.months(self.client.get(self.url)), ["2026-10", "2026-03", "2025-12"])

    def test_paginates_twelve_per_page(self):
        for month in range(1, 13):
            self.make_entry(month=date(2025, month, 1))
        self.make_entry(month=date(2026, 1, 1))

        first = self.client.get(self.url).json()
        second = self.client.get(self.url, {"page": 2}).json()

        self.assertEqual(first["count"], 13)
        self.assertEqual(len(first["results"]), 12)
        self.assertIn("page=2", first["next"])
        self.assertEqual([item["billingMonth"] for item in second["results"]], ["2025-01"])
        self.assertIsNone(second["next"])

    def test_filters_by_year(self):
        for month in [date(2025, 12, 1), date(2026, 1, 1), date(2026, 10, 1)]:
            self.make_entry(month=month)

        self.assertEqual(
            self.months(self.client.get(self.url, {"year": "2026"})), ["2026-10", "2026-01"]
        )
        self.assertEqual(self.months(self.client.get(self.url, {"year": "2024"})), [])

    def test_filters_by_billing_month(self):
        self.make_entry(month=date(2026, 9, 1))
        self.make_entry(month=date(2026, 10, 1))

        self.assertEqual(
            self.months(self.client.get(self.url, {"billing_month": "2026-10"})), ["2026-10"]
        )

    def test_rejects_malformed_filters(self):
        for params in [{"year": "26"}, {"year": "abcd"}, {"billing_month": "2026-13"}]:
            with self.subTest(params=params):
                response = self.client.get(self.url, params)

                self.assertEqual(response.status_code, 400)
                self.assertIn(next(iter(params)), response.json())

    def test_detail_returns_the_bill(self):
        entry = self.make_entry(notes="Meter read on the 1st")

        response = self.client.get(detail_url(self.property.id, self.tenancy.id, entry.id))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], str(entry.id))
        self.assertEqual(response.json()["totalDue"], "15750.00")
        self.assertEqual(response.json()["notes"], "Meter read on the 1st")
