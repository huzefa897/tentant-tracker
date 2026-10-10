from datetime import date
from decimal import Decimal
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from billing.models import Payment
from billing.summary import _digest, ledger_summary
from properties.models import Property, Tenancy

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
                "void bills": "0",
                "payments": "2",
                "payment reversals": "0",
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

    def test_changed_details_change_it_with_the_same_counts(self):
        changes = {
            "people digest": lambda: get_user_model()
            .objects.filter(pk=self.user.pk)
            .update(phone_number="+919000000099"),
            "properties digest": lambda: Property.objects.update(address="Another address"),
            "tenancies digest": lambda: Tenancy.objects.update(rent_amount="16000.00"),
        }
        for digest, change in changes.items():
            with self.subTest(digest=digest):
                before = summary()
                change()

                after = summary()

                self.assertNotEqual(before[digest], after[digest])
                self.assertEqual(
                    {k: v for k, v in before.items() if "digest" not in k},
                    {k: v for k, v in after.items() if "digest" not in k},
                )

    def test_signing_in_to_admin_does_not_change_it(self):
        before = summary()
        get_user_model().objects.filter(pk=self.user.pk).update(last_login=timezone.now())

        self.assertEqual(before, summary())

    def test_prints_hashes_never_details(self):
        out = StringIO()
        call_command("ledger_summary", stdout=out)

        for detail in (self.tenancy.name, self.tenancy.mobile_number, self.tenancy.property.name):
            with self.subTest(detail=detail):
                self.assertTrue(detail)
                self.assertNotIn(detail, out.getvalue())

    def test_prints_one_line_per_figure(self):
        out = StringIO()
        call_command("ledger_summary", stdout=out)

        self.assertIn("bills: 2\n", out.getvalue())
        self.assertIn("total outstanding: 10750.00\n", out.getvalue())


class DigestTests(SimpleTestCase):
    def test_tells_apart_rows_whose_text_runs_across_boundaries(self):
        different = {
            "a | in a field": ([("same-id", "A|B", "C")], [("same-id", "A", "B|C")]),
            "a line break in a field": ([("a\nb",)], [("a",), ("b",)]),
            "an empty field and the text None": ([("id", None)], [("id", "None")]),
        }
        for case, (rows, other) in different.items():
            with self.subTest(case=case):
                self.assertNotEqual(_digest(rows), _digest(other))

    def test_ignores_the_order_of_rows(self):
        rows = [("1", "A", date(2026, 9, 1)), ("2", "B", Decimal("15000.00"))]

        self.assertEqual(_digest(rows), _digest(list(reversed(rows))))

