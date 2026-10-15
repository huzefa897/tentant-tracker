"""The property dashboard API: totals, pending tenancies and missing bills."""

from datetime import date
from unittest import mock

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from billing.models import PaymentReversal, RentEntry
from properties.models import PaymentTiming

from .factories import make_property, make_tenancy, make_user
from .test_payments_api import entries_url, make_entry, make_payment

TODAY = date(2026, 10, 15)


def dashboard_url(prop, name):
    return f"/api/v1/properties/{prop.id}/dashboard/{name}/"


class DashboardTestCase(TestCase):
    def setUp(self):
        patcher = mock.patch("billing.dashboard_views.business_date", return_value=TODAY)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = make_user()
        self.prop = make_property(member=self.user)
        self.zahid = make_tenancy(self.prop, name="Shaik Zahid Ali", flat_number="202")
        self.yusuf = make_tenancy(
            self.prop, name="Mohammed Yusuf", flat_number="301", mobile_number="+919000000102"
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def bill(self, tenancy, month, due, *paid):
        """A ₹15,750 bill due on `due` (None: from before due dates), with these payments."""
        entry = make_entry(tenancy, self.user, month=month)
        if due is not None:
            RentEntry.objects.filter(pk=entry.pk).update(payment_timing="postpaid", due_date=due)
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

    def get(self, name, prop=None, **params):
        return self.client.get(dashboard_url(prop or self.prop, name), params)

    def summary(self):
        response = self.get("summary")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def pending(self, **params):
        response = self.get("pending-tenancies", **params)
        self.assertEqual(response.status_code, 200)
        return response.json()


class SummaryTests(DashboardTestCase):
    def test_totals_split_outstanding_by_when_it_is_due(self):
        # Zahid: September overdue, part paid (₹5,750 left); October due today.
        self.bill(self.zahid, date(2026, 9, 1), date(2026, 10, 11), "10000.00")
        self.bill(self.zahid, date(2026, 10, 1), TODAY)
        # Yusuf: due in 5 days, and one due later than a week.
        self.bill(self.yusuf, date(2026, 9, 1), date(2026, 10, 20))
        self.bill(self.yusuf, date(2026, 10, 1), date(2026, 11, 20))

        body = self.summary()

        self.assertEqual(body["asOfDate"], "2026-10-15")
        self.assertEqual(body["currency"], "INR")
        self.assertTrue(body["generatedAt"])
        # ₹5,750 + 3 × ₹15,750.
        self.assertEqual(body["outstandingAmount"], "53000.00")
        self.assertEqual(body["overdueAmount"], "5750.00")
        self.assertEqual(body["dueTodayAmount"], "15750.00")
        self.assertEqual(body["dueNext7DaysAmount"], "15750.00")
        self.assertEqual(body["withoutDueDateAmount"], "0.00")
        self.assertEqual(body["pendingTenancyCount"], 2)
        self.assertEqual(body["overdueTenancyCount"], 1)

    def test_due_tomorrow_and_in_seven_days_are_due_soon_but_eight_days_is_not(self):
        self.bill(self.zahid, date(2026, 9, 1), date(2026, 10, 16))
        self.bill(self.zahid, date(2026, 10, 1), date(2026, 10, 22))
        self.bill(self.yusuf, date(2026, 10, 1), date(2026, 10, 23))

        self.assertEqual(self.summary()["dueNext7DaysAmount"], "31500.00")

    def test_paid_and_void_bills_and_reversed_payments(self):
        self.bill(self.zahid, date(2026, 8, 1), date(2026, 9, 11), "15750.00")
        void = self.bill(self.zahid, date(2026, 9, 1), date(2026, 10, 11))
        self.void(void)
        reversed_bill = self.bill(self.yusuf, date(2026, 9, 1), date(2026, 10, 11))
        payment = make_payment(reversed_bill, self.user, "15750.00")
        PaymentReversal.objects.create(payment=payment, reason="Bounced", created_by=self.user)

        body = self.summary()

        # Only the bill whose payment was reversed owes anything, and it's overdue.
        self.assertEqual(body["outstandingAmount"], "15750.00")
        self.assertEqual(body["overdueAmount"], "15750.00")
        self.assertEqual(body["pendingTenancyCount"], 1)

    def test_several_payments_are_never_counted_once_each(self):
        self.bill(self.zahid, date(2026, 9, 1), date(2026, 10, 11), "1000.00", "2000.00", "3000.00")
        self.bill(self.zahid, date(2026, 10, 1), date(2026, 11, 11), "750.00")

        body = self.summary()

        # ₹9,750 + ₹15,000: each payment once.
        self.assertEqual(body["outstandingAmount"], "24750.00")
        self.assertEqual(body["overdueAmount"], "9750.00")

    def test_bills_without_a_due_date_are_outstanding_but_never_overdue(self):
        self.bill(self.zahid, date(2026, 1, 1), None, "750.00")

        body = self.summary()

        self.assertEqual(body["outstandingAmount"], "15000.00")
        self.assertEqual(body["withoutDueDateAmount"], "15000.00")
        self.assertEqual(body["overdueAmount"], "0.00")

    def test_nothing_owed_is_zero_not_missing(self):
        body = self.summary()

        self.assertEqual(body["outstandingAmount"], "0.00")
        self.assertEqual(body["pendingTenancyCount"], 0)

    def test_only_the_propertys_own_bills_and_only_for_its_members(self):
        other = make_property(name="Property B")
        self.bill(make_tenancy(other), date(2026, 9, 1), date(2026, 10, 11))

        self.assertEqual(self.summary()["outstandingAmount"], "0.00")
        for name in ("summary", "pending-tenancies", "missing-bills"):
            with self.subTest(name):
                self.assertEqual(self.get(name, prop=other).status_code, 404)

    def test_needs_sign_in(self):
        self.client.force_authenticate(None)

        self.assertIn(self.get("summary").status_code, (401, 403))


class PendingTenanciesTests(DashboardTestCase):
    def test_one_row_per_tenancy_with_its_totals(self):
        self.bill(self.zahid, date(2026, 9, 1), date(2026, 10, 11), "10000.00")
        self.bill(self.zahid, date(2026, 10, 1), date(2026, 11, 11))
        self.bill(self.yusuf, date(2026, 9, 1), date(2026, 10, 20))

        body = self.pending()

        self.assertEqual(body["count"], 2)
        self.assertEqual(
            body["results"][0],
            {
                "tenancyId": str(self.zahid.id),
                "name": "Shaik Zahid Ali",
                "flatNumber": "202",
                "tenancyStatus": "current",
                "outstandingAmount": "21500.00",
                "overdueAmount": "5750.00",
                "dueTodayAmount": "0.00",
                "dueNext7DaysAmount": "0.00",
                "withoutDueDateAmount": "0.00",
                "pendingBillCount": 2,
                "oldestDueDate": "2026-10-11",
                "oldestOverdueDate": "2026-10-11",
            },
        )
        self.assertEqual(body["results"][1]["name"], "Mohammed Yusuf")
        self.assertIsNone(body["results"][1]["oldestOverdueDate"])

    def test_overdue_first_oldest_overdue_first_then_by_name(self):
        aamir = make_tenancy(
            self.prop, name="Aamir", flat_number="101", mobile_number="+919000000103"
        )
        self.bill(aamir, date(2026, 9, 1), date(2026, 10, 30))
        self.bill(self.yusuf, date(2026, 9, 1), date(2026, 10, 1))
        self.bill(self.zahid, date(2026, 9, 1), date(2026, 10, 11))
        bilal = make_tenancy(
            self.prop, name="Bilal", flat_number="102", mobile_number="+919000000104"
        )
        self.bill(bilal, date(2026, 9, 1), date(2026, 10, 30))

        names = [row["name"] for row in self.pending()["results"]]

        self.assertEqual(names, ["Mohammed Yusuf", "Shaik Zahid Ali", "Aamir", "Bilal"])

    def test_includes_ended_tenancies_and_keeps_a_flats_occupants_apart(self):
        before = make_tenancy(
            self.prop,
            name="Earlier tenant",
            flat_number="202",
            mobile_number="+919000000105",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 12, 31),
        )
        self.bill(before, date(2025, 12, 1), date(2026, 1, 11))
        self.bill(self.zahid, date(2026, 9, 1), date(2026, 10, 11))

        rows = self.pending()["results"]

        self.assertEqual([row["tenancyId"] for row in rows], [str(before.id), str(self.zahid.id)])
        self.assertEqual(rows[0]["tenancyStatus"], "ended")

    def test_filters_by_when_money_is_due(self):
        self.bill(self.zahid, date(2026, 9, 1), date(2026, 10, 11))
        self.bill(self.yusuf, date(2026, 9, 1), TODAY)
        soon = make_tenancy(
            self.prop, name="Aamir", flat_number="101", mobile_number="+919000000103"
        )
        self.bill(soon, date(2026, 9, 1), date(2026, 10, 20))

        def names(due):
            return [row["name"] for row in self.pending(due_status=due)["results"]]

        self.assertEqual(names("overdue"), ["Shaik Zahid Ali"])
        self.assertEqual(names("due_today"), ["Mohammed Yusuf"])
        self.assertEqual(names("due_next_7_days"), ["Aamir"])
        self.assertEqual(len(names("all")), 3)

    def test_searches_name_and_flat(self):
        self.bill(self.zahid, date(2026, 9, 1), date(2026, 10, 11))
        self.bill(self.yusuf, date(2026, 9, 1), date(2026, 10, 11))

        self.assertEqual(self.pending(search=" zahid ")["count"], 1)
        self.assertEqual(self.pending(search="301")["results"][0]["name"], "Mohammed Yusuf")
        self.assertEqual(self.pending(search="nobody")["count"], 0)

    def test_refuses_unknown_filters(self):
        self.assertEqual(self.get("pending-tenancies", due_status="late").status_code, 400)
        self.assertEqual(self.get("pending-tenancies", search="x" * 101).status_code, 400)

    def test_pages_twenty_rows_and_counts_all_of_them(self):
        for n in range(21):
            tenancy = make_tenancy(
                self.prop,
                name=f"Tenant {n:02}",
                flat_number=f"5{n:02}",
                mobile_number=f"+9190000002{n:02}",
            )
            self.bill(tenancy, date(2026, 9, 1), date(2026, 10, 11))

        first = self.pending()
        second = self.pending(page=2)

        self.assertEqual((first["count"], len(first["results"])), (21, 20))
        self.assertEqual(len(second["results"]), 1)

    def test_the_query_count_doesnt_grow_with_bills_or_payments(self):
        def queries():
            with CaptureQueriesContext(connection) as captured:
                self.pending()
            return len(captured)

        self.bill(self.zahid, date(2026, 9, 1), date(2026, 10, 11), "100.00")
        few = queries()
        for month in range(1, 9):
            self.bill(self.yusuf, date(2026, month, 1), date(2026, month + 1, 11), "1.00", "2.00")

        self.assertEqual(queries(), few)


class MissingBillsTests(DashboardTestCase):
    def missing(self, **params):
        response = self.get("missing-bills", **params)
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_lists_tenancies_occupying_the_month_without_a_bill(self):
        self.bill(self.zahid, date(2026, 9, 1), date(2026, 10, 11))

        body = self.missing(billing_month="2026-09")

        self.assertEqual(body["billingMonth"], "2026-09")
        self.assertEqual(body["count"], 1)
        self.assertEqual(
            body["tenancies"],
            [
                {
                    "tenancyId": str(self.yusuf.id),
                    "name": "Mohammed Yusuf",
                    "flatNumber": "301",
                    "tenancyStatus": "current",
                    "rentAmount": "15000.00",
                }
            ],
        )

    def test_a_void_bill_leaves_the_month_missing(self):
        void = self.bill(self.zahid, date(2026, 9, 1), date(2026, 10, 11))
        self.void(void)

        names = [t["name"] for t in self.missing(billing_month="2026-09")["tenancies"]]

        self.assertIn("Shaik Zahid Ali", names)

    def test_only_tenancies_occupying_some_day_of_the_month(self):
        make_tenancy(
            self.prop,
            name="Left in August",
            flat_number="401",
            mobile_number="+919000000106",
            end_date=date(2026, 8, 31),
        )
        make_tenancy(
            self.prop,
            name="Moved in on the 30th",
            flat_number="402",
            mobile_number="+919000000107",
            start_date=date(2026, 9, 30),
        )

        names = [t["name"] for t in self.missing(billing_month="2026-09")["tenancies"]]

        self.assertNotIn("Left in August", names)
        self.assertIn("Moved in on the 30th", names)

    def test_defaults_to_last_month_when_postpaid_and_this_month_when_prepaid(self):
        self.assertEqual(self.missing()["billingMonth"], "2026-09")

        self.prop.payment_timing = PaymentTiming.PREPAID
        self.prop.save()

        self.assertEqual(self.missing()["billingMonth"], "2026-10")

    def test_missing_bills_add_nothing_to_the_totals(self):
        self.assertEqual(self.missing()["count"], 2)
        self.assertEqual(self.summary()["outstandingAmount"], "0.00")

    def test_refuses_a_malformed_month(self):
        self.assertEqual(self.get("missing-bills", billing_month="2026-13").status_code, 400)


class OutstandingBillsFilterTests(DashboardTestCase):
    def test_lists_a_tenancys_bills_that_still_owe_money(self):
        owing = self.bill(self.zahid, date(2026, 9, 1), date(2026, 10, 11), "10000.00")
        self.bill(self.zahid, date(2026, 8, 1), date(2026, 9, 11), "15750.00")

        response = self.client.get(entries_url(self.prop, self.zahid), {"balance": "outstanding"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual([e["id"] for e in response.json()["results"]], [str(owing.id)])
        self.assertEqual(response.json()["results"][0]["outstandingAmount"], "5750.00")

    def test_refuses_another_balance(self):
        response = self.client.get(entries_url(self.prop, self.zahid), {"balance": "paid"})

        self.assertEqual(response.status_code, 400)
