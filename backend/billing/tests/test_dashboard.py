"""The property dashboard API: rental periods due or overdue, bill or no bill, and the amounts
known from prepared bills."""

from datetime import date
from unittest import mock

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from billing.models import PaymentReversal, RentalPeriod, RentEntry
from properties.models import PropertyMembership

from .factories import make_property, make_tenancy, make_user
from .test_payments_api import entries_url, make_entry, make_payment

TODAY = date(2026, 10, 15)
AUGUST = date(2026, 8, 1)
SEPTEMBER = date(2026, 9, 1)


def dashboard_url(prop, name):
    return f"/api/v1/properties/{prop.id}/dashboard/{name}/"


def not_owed_url(prop, period):
    return f"/api/v1/properties/{prop.id}/rental-periods/{period.id}/not-owed/"


class DashboardTestCase(TestCase):
    def setUp(self):
        patcher = mock.patch("billing.dashboard_views.business_date", return_value=TODAY)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = make_user()
        self.prop = make_property(member=self.user)
        self.track_from(AUGUST)
        # Postpaid. Zahid's months are due on the 11th of the next, Yusuf's on the 20th.
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

    def track_from(self, month):
        self.prop.rent_tracking_start = month
        self.prop.save()

    def bill(self, tenancy, month, *paid):
        """A ₹15,750 bill with these payments; due when its month is."""
        entry = make_entry(tenancy, self.user, month=month)
        for amount in paid:
            make_payment(entry, self.user, amount)
        return entry

    def void(self, entry):
        RentEntry.objects.filter(pk=entry.pk).update(
            status="void",
            voided_at="2026-10-12T10:00:00Z",
            voided_by=self.user,
            void_reason="Entered twice",
        )

    def period(self, tenancy, month):
        return RentalPeriod.objects.get(tenancy=tenancy, period_month=month)

    def get(self, name, prop=None, **params):
        return self.client.get(dashboard_url(prop or self.prop, name), params)

    def summary(self):
        response = self.get("summary")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def periods(self, **params):
        response = self.get("rental-periods", **params)
        self.assertEqual(response.status_code, 200)
        return response.json()

    def months(self, **params):
        return [
            (row["name"], row["periodMonth"]) for row in self.periods(**params)["results"]
        ]


class SummaryTests(DashboardTestCase):
    def test_counts_months_without_a_bill_but_never_their_amount(self):
        # Zahid: August paid; September part paid (₹5,750 left), due 11 October.
        self.bill(self.zahid, AUGUST, "15750.00")
        self.bill(self.zahid, SEPTEMBER, "10000.00")
        # Yusuf: no bills. August was due 20 September; September is due 20 October.

        body = self.summary()

        self.assertEqual(body["asOfDate"], "2026-10-15")
        self.assertEqual(body["currency"], "INR")
        counts = {
            name: value
            for name, value in body.items()
            if name not in ("asOfDate", "generatedAt", "currency")
        }
        self.assertEqual(
            counts,
            {
                "overduePeriodCount": 2,
                "overdueTenancyCount": 2,
                "dueTodayPeriodCount": 0,
                "upcomingPeriodCount": 1,
                "awaitingBillPeriodCount": 2,
                "overdueAwaitingBillPeriodCount": 1,
                "owingTenancyCount": 2,
                "knownOutstandingAmount": "5750.00",
                "knownOverdueAmount": "5750.00",
                "knownDueTodayAmount": "0.00",
                "knownUpcomingAmount": "0.00",
            },
        )

    def test_counts_periods_and_tenancies_apart(self):
        # Yusuf owes two overdue months, Zahid one.
        self.track_from(date(2026, 7, 1))
        self.bill(self.zahid, date(2026, 7, 1), "15750.00")
        self.bill(self.zahid, AUGUST, "15750.00")

        body = self.summary()

        # Zahid September; Yusuf July and August (September isn't overdue yet).
        self.assertEqual((body["overduePeriodCount"], body["overdueTenancyCount"]), (3, 2))

    def test_a_month_due_today(self):
        tenancy = make_tenancy(
            self.prop,
            name="Ayesha",
            flat_number="401",
            mobile_number="+919000000103",
            rent_due_day=15,
            start_date=SEPTEMBER,
        )
        self.bill(tenancy, SEPTEMBER)

        body = self.summary()

        self.assertEqual(body["dueTodayPeriodCount"], 1)
        self.assertEqual(body["knownDueTodayAmount"], "15750.00")

    def test_without_a_tracking_start_only_billed_months_count(self):
        self.track_from(None)
        self.bill(self.zahid, SEPTEMBER, "10000.00")

        body = self.summary()

        self.assertEqual(body["overduePeriodCount"], 1)
        self.assertEqual(body["awaitingBillPeriodCount"], 0)
        self.assertEqual(body["knownOutstandingAmount"], "5750.00")

    def test_paid_and_void_bills_and_reversed_payments(self):
        self.bill(self.zahid, AUGUST, "15750.00")
        september = self.bill(self.zahid, SEPTEMBER)
        payment = make_payment(september, self.user, "15750.00")
        PaymentReversal.objects.create(payment=payment, reason="Bounced", created_by=self.user)
        self.void(self.bill(self.yusuf, AUGUST))
        self.bill(self.yusuf, SEPTEMBER, "15750.00")

        body = self.summary()

        # The reversal makes September owed again, overdue from 11 October; Yusuf's void August
        # is awaiting a bill again.
        self.assertEqual(body["knownOutstandingAmount"], "15750.00")
        self.assertEqual(body["knownOverdueAmount"], "15750.00")
        self.assertEqual(body["overduePeriodCount"], 2)
        self.assertEqual(body["awaitingBillPeriodCount"], 1)

    def test_several_payments_are_never_counted_once_each(self):
        self.bill(self.zahid, SEPTEMBER, "1000.00", "2000.00", "3000.00")

        self.assertEqual(self.summary()["knownOutstandingAmount"], "9750.00")

    def test_no_months_after_the_tenancy_ends(self):
        self.yusuf.end_date = date(2026, 8, 10)
        self.yusuf.save()

        self.assertEqual(
            self.months(timing="all"),
            [
                ("Shaik Zahid Ali", "2026-08"),
                ("Mohammed Yusuf", "2026-08"),
                ("Shaik Zahid Ali", "2026-09"),
            ],
        )

    def test_catches_up_on_every_month_due_since_it_last_ran(self):
        self.assertEqual(RentalPeriod.objects.count(), 0)

        self.summary()

        self.assertEqual(
            sorted(RentalPeriod.objects.values_list("tenancy__name", "period_month")),
            [
                ("Mohammed Yusuf", AUGUST),
                ("Mohammed Yusuf", SEPTEMBER),
                ("Shaik Zahid Ali", AUGUST),
                ("Shaik Zahid Ali", SEPTEMBER),
            ],
        )

    def test_only_the_propertys_own_months_and_only_for_its_members(self):
        other = make_property(name="Property B")
        other.rent_tracking_start = AUGUST
        other.save()
        self.bill(make_tenancy(other), SEPTEMBER)

        self.assertEqual(self.summary()["knownOutstandingAmount"], "0.00")
        for name in ("summary", "rental-periods"):
            with self.subTest(name):
                self.assertEqual(self.get(name, prop=other).status_code, 404)

    def test_needs_sign_in(self):
        self.client.force_authenticate(None)

        self.assertIn(self.get("summary").status_code, (401, 403))


class RentalPeriodsTests(DashboardTestCase):
    def test_a_month_without_a_bill_is_due_with_no_amount(self):
        self.bill(self.zahid, SEPTEMBER, "10000.00")

        rows = self.periods()["results"]

        # Due (overdue or today), oldest due first: Zahid's August (11 Sep), Yusuf's August
        # (20 Sep), Zahid's September (11 Oct). Yusuf's September isn't due until 20 Oct.
        self.assertEqual(
            [(row["name"], row["periodMonth"]) for row in rows],
            [
                ("Shaik Zahid Ali", "2026-08"),
                ("Mohammed Yusuf", "2026-08"),
                ("Shaik Zahid Ali", "2026-09"),
            ],
        )
        unbilled = rows[1]
        self.assertEqual(
            {name: unbilled[name] for name in unbilled if name not in ("id", "tenancyId")},
            {
                "name": "Mohammed Yusuf",
                "flatNumber": "301",
                "tenancyStatus": "current",
                "periodMonth": "2026-08",
                "paymentTiming": "postpaid",
                "dueDate": "2026-09-20",
                "timing": "overdue",
                "daysOverdue": 25,
                "preparation": "not_prepared",
                "billId": None,
                "settlement": "unknown",
                "totalDue": None,
                "outstandingAmount": None,
                "actions": ["prepare_bill"],
            },
        )
        billed = rows[2]
        self.assertEqual(billed["preparation"], "prepared")
        self.assertEqual(billed["settlement"], "partially_paid")
        self.assertEqual((billed["totalDue"], billed["outstandingAmount"]), ("15750.00", "5750.00"))
        self.assertEqual(billed["daysOverdue"], 4)
        self.assertEqual(billed["actions"], ["view_bill", "record_payment"])
        self.assertEqual(billed["billId"], str(RentEntry.objects.get(billing_month=SEPTEMBER).pk))

    def test_a_bill_prepared_late_keeps_the_months_due_date(self):
        self.periods()
        self.yusuf.rent_due_day = 1
        self.yusuf.save()

        response = self.client.post(
            entries_url(self.prop, self.yusuf),
            {"billingMonth": "2026-08", "electricityUnits": "75", "waterAmount": "300"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["dueDate"], "2026-09-20")

        row = next(r for r in self.periods()["results"] if r["name"] == "Mohammed Yusuf")
        self.assertEqual((row["dueDate"], row["daysOverdue"]), ("2026-09-20", 25))
        self.assertEqual((row["preparation"], row["settlement"]), ("prepared", "unpaid"))
        self.assertEqual(RentalPeriod.objects.filter(tenancy=self.yusuf).count(), 2)

    def test_paid_months_leave_the_list(self):
        self.bill(self.zahid, AUGUST, "15750.00")

        self.assertNotIn(("Shaik Zahid Ali", "2026-08"), self.months(timing="all"))

    def test_filters_by_timing_preparation_and_month(self):
        self.bill(self.zahid, SEPTEMBER)

        self.assertEqual(self.months(timing="upcoming"), [("Mohammed Yusuf", "2026-09")])
        self.assertEqual(
            self.months(timing="overdue", preparation="prepared"),
            [("Shaik Zahid Ali", "2026-09")],
        )
        self.assertEqual(
            self.months(preparation="not_prepared"),
            [("Shaik Zahid Ali", "2026-08"), ("Mohammed Yusuf", "2026-08")],
        )
        self.assertEqual(
            self.months(timing="all", month="2026-09"),
            [("Shaik Zahid Ali", "2026-09"), ("Mohammed Yusuf", "2026-09")],
        )
        self.assertEqual(self.months(timing="due_today"), [])

    def test_refuses_unknown_filters(self):
        for params in ({"timing": "late"}, {"preparation": "maybe"}, {"month": "2026-13"}):
            with self.subTest(params):
                self.assertEqual(self.get("rental-periods", **params).status_code, 400)

    def test_pages_twenty_rows_and_counts_all_of_them(self):
        for n in range(19):
            make_tenancy(
                self.prop,
                name=f"Tenant {n:02}",
                flat_number=f"5{n:02}",
                mobile_number=f"+9190000002{n:02}",
            )

        first = self.periods()
        second = self.periods(page=2)

        # 20 tenancies due on the 11th, with August and September overdue, and Yusuf's August.
        self.assertEqual((first["count"], len(first["results"])), (41, 20))
        self.assertEqual(len(second["results"]), 20)

    def test_the_query_count_doesnt_grow_with_months_bills_or_payments(self):
        def queries():
            with CaptureQueriesContext(connection) as captured:
                self.periods(timing="all")
            return len(captured)

        self.track_from(None)
        self.bill(self.zahid, SEPTEMBER, "100.00")
        few = queries()
        for month in range(1, 9):
            self.bill(self.yusuf, date(2026, month, 1), "1.00", "2.00")

        self.assertEqual(queries(), few)


class NotOwedTests(DashboardTestCase):
    def setUp(self):
        super().setUp()
        self.owner = make_user("owner")
        PropertyMembership.objects.create(user=self.owner, property=self.prop, role="owner")
        self.periods()
        self.august = self.period(self.yusuf, AUGUST)

    def mark(self, period=None, reason="Settled in cash before the app", user=None):
        self.client.force_authenticate(user or self.owner)
        return self.client.post(
            not_owed_url(self.prop, period or self.august), {"reason": reason}, format="json"
        )

    def test_an_owner_marks_a_month_not_owed(self):
        response = self.mark()

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["notOwedReason"], "Settled in cash before the app")
        self.assertEqual(body["periodMonth"], "2026-08")
        self.assertNotIn(("Mohammed Yusuf", "2026-08"), self.months(timing="all"))
        self.assertEqual(self.summary()["awaitingBillPeriodCount"], 3)

    def test_a_retry_returns_it_and_another_reason_conflicts(self):
        self.mark()

        self.assertEqual(self.mark().status_code, 200)
        response = self.mark(reason="Waived")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "not_owed_conflict")

    def test_a_month_with_a_bill_must_have_it_voided_first(self):
        entry = self.bill(self.yusuf, AUGUST)

        response = self.mark()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "period_has_bill")

        self.void(entry)
        self.assertEqual(self.mark().status_code, 201)

    def test_a_month_not_owed_cant_have_a_bill(self):
        self.mark()

        response = self.client.post(
            entries_url(self.prop, self.yusuf),
            {"billingMonth": "2026-08", "electricityUnits": "75", "waterAmount": "300"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("billingMonth", response.json())

    def test_owners_only_with_a_reason_and_within_the_property(self):
        self.assertEqual(self.mark(user=self.user).status_code, 403)
        self.assertEqual(self.mark(reason="  ").status_code, 400)
        other = make_property(name="Property B", member=self.owner, role="owner")
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            not_owed_url(other, self.august), {"reason": "Waived"}, format="json"
        )
        self.assertEqual(response.status_code, 404)
        self.august.refresh_from_db()
        self.assertIsNone(self.august.not_owed_at)


class OutstandingBillsFilterTests(DashboardTestCase):
    def test_lists_a_tenancys_bills_that_still_owe_money(self):
        owing = self.bill(self.zahid, SEPTEMBER, "10000.00")
        self.bill(self.zahid, AUGUST, "15750.00")

        response = self.client.get(entries_url(self.prop, self.zahid), {"balance": "outstanding"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual([e["id"] for e in response.json()["results"]], [str(owing.id)])
        self.assertEqual(response.json()["results"][0]["outstandingAmount"], "5750.00")

    def test_refuses_another_balance(self):
        response = self.client.get(entries_url(self.prop, self.zahid), {"balance": "paid"})

        self.assertEqual(response.status_code, 400)
