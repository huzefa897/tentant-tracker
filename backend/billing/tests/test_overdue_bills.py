"""The overdue bills list: active bills past their due date with money still to pay, grouped by
tenancy, across the user's properties."""

from datetime import date
from unittest import mock

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from billing.models import PaymentReversal, RentEntry

from .factories import make_property, make_tenancy, make_user
from .test_payments_api import make_entry, make_payment

URL = "/api/v1/overdue-bills/"
TODAY = date(2026, 10, 15)
JULY = date(2026, 7, 1)
AUGUST = date(2026, 8, 1)
SEPTEMBER = date(2026, 9, 1)
OCTOBER = date(2026, 10, 1)


class OverdueBillsTestCase(TestCase):
    def setUp(self):
        patcher = mock.patch("billing.dashboard_views.business_date", return_value=TODAY)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = make_user()
        self.prop = make_property("Saleem Towers", member=self.user)
        # Postpaid: a month is due on the due day of the next. Zahid's on the 11th, Yusuf's on
        # the 20th (so his September, due 20 October, isn't overdue yet).
        self.zahid = make_tenancy(self.prop, name="Shaik Zahid Ali", flat_number="202")
        self.yusuf = make_tenancy(
            self.prop,
            name="Mohammed Yusuf",
            flat_number="301",
            mobile_number="+919000000102",
            rent_due_day=20,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def bill(self, tenancy, month, *paid):
        """A ₹15,750 bill with these payments."""
        entry = make_entry(tenancy, self.user, month=month)
        for amount in paid:
            make_payment(entry, self.user, amount)
        return entry

    def get(self, **params):
        response = self.client.get(URL, params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def months(self, **params):
        return [
            (tenant["name"], [bill["billingMonth"] for bill in tenant["bills"]])
            for tenant in self.get(**params)["tenants"]
        ]


class OverdueBillsTests(OverdueBillsTestCase):
    def test_lists_unpaid_months_grouped_by_tenant_with_their_amounts(self):
        august = self.bill(self.zahid, AUGUST)
        self.bill(self.zahid, SEPTEMBER, "10000.00")

        body = self.get()

        self.assertEqual(body["asOfDate"], "2026-10-15")
        self.assertEqual(body["currency"], "INR")
        self.assertEqual(body["tenantCount"], 1)
        self.assertEqual(body["billCount"], 2)
        self.assertEqual(body["totalOutstandingAmount"], "21500.00")
        [zahid] = body["tenants"]
        self.assertEqual(
            {name: value for name, value in zahid.items() if name != "bills"},
            {
                "tenancyId": str(self.zahid.id),
                "name": "Shaik Zahid Ali",
                "flatNumber": "202",
                "tenancyStatus": "current",
                "propertyId": str(self.prop.id),
                "propertyName": "Saleem Towers",
                "overdueBillCount": 2,
                "outstandingAmount": "21500.00",
                "oldestDueDate": "2026-09-11",
            },
        )
        self.assertEqual(
            zahid["bills"],
            [
                {
                    "id": str(august.id),
                    "billingMonth": "2026-08",
                    "dueDate": "2026-09-11",
                    "daysOverdue": 34,
                    "totalAmount": "15750.00",
                    "paidAmount": "0.00",
                    "outstandingAmount": "15750.00",
                },
                {
                    "id": mock.ANY,
                    "billingMonth": "2026-09",
                    "dueDate": "2026-10-11",
                    "daysOverdue": 4,
                    "totalAmount": "15750.00",
                    "paidAmount": "10000.00",
                    "outstandingAmount": "5750.00",
                },
            ],
        )

    def test_leaves_out_paid_void_and_not_yet_overdue_bills(self):
        self.bill(self.zahid, JULY, "15750.00")  # paid
        self.bill(self.zahid, AUGUST, "20000.00")  # overpaid
        void = self.bill(self.zahid, SEPTEMBER)
        RentEntry.objects.filter(pk=void.pk).update(
            status="void",
            voided_at="2026-10-12T10:00:00Z",
            voided_by=self.user,
            void_reason="Entered twice",
        )
        self.bill(self.yusuf, SEPTEMBER)  # due 20 October
        self.bill(self.zahid, OCTOBER)  # due 11 November

        body = self.get()

        self.assertEqual(body["tenants"], [])
        self.assertEqual(body["tenantCount"], 0)
        self.assertEqual(body["billCount"], 0)
        self.assertEqual(body["totalOutstandingAmount"], "0.00")

    def test_a_bill_due_today_is_not_overdue_yet(self):
        self.bill(self.zahid, SEPTEMBER)  # due 11 October

        with mock.patch("billing.dashboard_views.business_date", return_value=date(2026, 10, 11)):
            self.assertEqual(self.get()["tenants"], [])
        with mock.patch("billing.dashboard_views.business_date", return_value=date(2026, 10, 12)):
            self.assertEqual(self.months(), [("Shaik Zahid Ali", ["2026-09"])])

    def test_a_reversed_payment_owes_again(self):
        entry = self.bill(self.zahid, SEPTEMBER)
        payment = make_payment(entry, self.user, "15750.00")
        self.assertEqual(self.get()["tenants"], [])

        PaymentReversal.objects.create(payment=payment, reason="Bounced", created_by=self.user)

        [zahid] = self.get()["tenants"]
        self.assertEqual(zahid["bills"][0]["paidAmount"], "0.00")
        self.assertEqual(zahid["outstandingAmount"], "15750.00")

    def test_a_bill_prepared_late_keeps_its_months_due_date(self):
        # Prepared on 15 October for August: due 11 September all along.
        self.bill(self.zahid, AUGUST)

        [zahid] = self.get()["tenants"]

        self.assertEqual(zahid["bills"][0]["dueDate"], "2026-09-11")
        self.assertEqual(zahid["bills"][0]["daysOverdue"], 34)

    def test_tenants_with_the_oldest_overdue_bill_come_first(self):
        self.bill(self.zahid, SEPTEMBER)  # due 11 October
        self.bill(self.yusuf, JULY)  # due 20 August
        self.bill(self.yusuf, AUGUST)  # due 20 September

        self.assertEqual(
            self.months(),
            [
                ("Mohammed Yusuf", ["2026-07", "2026-08"]),
                ("Shaik Zahid Ali", ["2026-09"]),
            ],
        )

    def test_an_ended_tenancy_still_owes(self):
        self.zahid.end_date = date(2026, 9, 30)
        self.zahid.save()
        self.bill(self.zahid, SEPTEMBER)

        [zahid] = self.get()["tenants"]

        self.assertEqual(zahid["tenancyStatus"], "ended")


class AcrossPropertiesTests(OverdueBillsTestCase):
    def setUp(self):
        super().setUp()
        self.annex = make_property("Annex", member=self.user, role="owner")
        self.ali = make_tenancy(
            self.annex, name="Ali Hussain", flat_number="102", mobile_number="+919000000103"
        )
        self.bill(self.ali, AUGUST)
        self.bill(self.zahid, AUGUST)

    def test_lists_every_property_the_user_has(self):
        body = self.get()

        self.assertEqual(
            [(tenant["name"], tenant["propertyName"]) for tenant in body["tenants"]],
            [("Ali Hussain", "Annex"), ("Shaik Zahid Ali", "Saleem Towers")],
        )

    def test_filters_by_property(self):
        body = self.get(property=str(self.annex.id))

        self.assertEqual([tenant["name"] for tenant in body["tenants"]], ["Ali Hussain"])
        self.assertEqual(body["totalOutstandingAmount"], "15750.00")

    def test_never_shows_another_users_property(self):
        stranger = make_property("Elsewhere")
        other = make_tenancy(stranger, name="Someone Else", mobile_number="+919000000104")
        self.bill(other, AUGUST)
        membership = self.annex.memberships.get()
        membership.is_active = False
        membership.save()

        body = self.get()

        self.assertEqual([tenant["name"] for tenant in body["tenants"]], ["Shaik Zahid Ali"])
        for property_id in (stranger.id, self.annex.id, "not-a-uuid"):
            response = self.client.get(URL, {"property": str(property_id)})
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json(), {"property": "Choose one of your properties."})


class FilterTests(OverdueBillsTestCase):
    def setUp(self):
        super().setUp()
        self.bill(self.zahid, JULY)
        self.bill(self.zahid, AUGUST)
        self.bill(self.yusuf, AUGUST)

    def test_filters_by_billing_month(self):
        self.assertEqual(
            self.months(month="2026-08"),
            [("Shaik Zahid Ali", ["2026-08"]), ("Mohammed Yusuf", ["2026-08"])],
        )

    def test_searches_by_name_or_flat(self):
        self.assertEqual(self.months(search="yusuf"), [("Mohammed Yusuf", ["2026-08"])])
        self.assertEqual(self.months(search="202"), [("Shaik Zahid Ali", ["2026-07", "2026-08"])])
        self.assertEqual(self.months(search="  Flat 301 "), [("Mohammed Yusuf", ["2026-08"])])
        self.assertEqual(self.months(search="nobody"), [])

    def test_rejects_a_bad_month_or_a_long_search(self):
        response = self.client.get(URL, {"month": "2026-13"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("month", response.json())

        response = self.client.get(URL, {"search": "x" * 101})
        self.assertEqual(response.status_code, 400)
        self.assertIn("search", response.json())

    def test_needs_sign_in(self):
        self.client.force_authenticate(None)

        self.assertIn(self.client.get(URL).status_code, (401, 403))

    def test_queries_stay_the_same_however_many_bills(self):
        with CaptureQueriesContext(connection) as few:
            self.get()
        for month in (date(2026, 3, 1), date(2026, 4, 1), date(2026, 5, 1), date(2026, 6, 1)):
            self.bill(self.yusuf, month, "100.00")

        with CaptureQueriesContext(connection) as many:
            self.get()

        self.assertEqual(len(many), len(few))
