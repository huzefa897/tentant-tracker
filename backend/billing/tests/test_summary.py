from datetime import date
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from billing.models import Payment
from billing.summary import ledger_summary

from .factories import make_property, make_tenancy, make_user
from .test_payments_api import make_entry, make_payment


def summary():
    return dict(ledger_summary())


class LedgerSummaryTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.tenancy = make_tenancy(make_property(member=self.user))
        # ₹15,750 each.
        self.september = make_entry(self.tenancy, self.user)
        self.october = make_entry(self.tenancy, self.user, month=date(2026, 10, 1))
        make_payment(self.september, self.user, "15750.00")
        make_payment(self.october, self.user, "5000.00")

    def test_counts_records_and_totals_the_money(self):
        self.assertEqual(
            {name: value for name, value in summary().items() if "digest" not in name},
            {
                "people": "1",
                "properties": "1",
                "memberships": "1",
                "tenancies": "1",
                "bills": "2",
                "payments": "2",
                "receipts": "0",
                "total billed": "31500.00",
                "total paid": "20750.00",
                "total outstanding": "10750.00",
            },
        )

    def test_the_same_records_give_the_same_summary(self):
        self.assertEqual(summary(), summary())

    def test_any_changed_payment_changes_it(self):
        before = summary()
        Payment.objects.filter(entry=self.october).update(paid_date=date(2026, 10, 2))

        after = summary()

        self.assertNotEqual(before["payments digest"], after["payments digest"])
        self.assertEqual(before["total paid"], after["total paid"])

    def test_renumbered_payments_change_it(self):
        before = summary()
        Payment.objects.filter(entry=self.october).update(sequence=2)

        self.assertNotEqual(before["payments digest"], summary()["payments digest"])

    def test_moving_money_between_bills_changes_it(self):
        # The same total paid, but split differently between the bills.
        before = summary()
        Payment.objects.filter(entry=self.september).update(amount="5000.00")
        Payment.objects.filter(entry=self.october).update(amount="15750.00")

        after = summary()

        self.assertEqual(before["total paid"], after["total paid"])
        self.assertNotEqual(before["bills digest"], after["bills digest"])

    def test_prints_one_line_per_figure(self):
        out = StringIO()
        call_command("ledger_summary", stdout=out)

        self.assertIn("bills: 2\n", out.getvalue())
        self.assertIn("total outstanding: 10750.00\n", out.getvalue())
