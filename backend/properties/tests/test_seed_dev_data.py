from datetime import timedelta
from io import StringIO
from unittest import mock

from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings

from accounts.models import User
from billing.calculations import calculate_total_due
from billing.models import Payment, Receipt, RentEntry
from properties.management.commands.seed_dev_data import PARTIAL, PROPERTIES, TENANCIES
from properties.models import Property, PropertyMembership, Tenancy, business_date

EMAIL = "Seeder@Example.test"


def seed(*args):
    out = StringIO()
    call_command("seed_dev_data", "--email", EMAIL, *args, stdout=out)
    return out.getvalue()


@override_settings(DEBUG=True)
class SeedDevDataTests(TestCase):
    def test_seeds_properties_tenancies_bills_payments_and_receipts(self):
        seed()

        self.assertEqual(Property.objects.count(), len(PROPERTIES))
        self.assertEqual(Tenancy.objects.count(), len(TENANCIES))
        self.assertTrue(RentEntry.objects.exists())
        self.assertTrue(Payment.objects.exists())
        self.assertTrue(Receipt.objects.exists())
        # A mix: some tenancies have meter readings, and some bills are left unpaid.
        self.assertTrue(RentEntry.objects.filter(electricity_mode="meter").exists())
        self.assertTrue(RentEntry.objects.filter(electricity_mode="manual").exists())
        self.assertTrue(RentEntry.objects.filter(payments__isnull=True).exists())
        self.assertTrue(Tenancy.objects.filter(end_date__isnull=False).exists())

    def test_the_email_becomes_an_owner_of_every_property(self):
        seed()

        owner = User.objects.get(email="seeder@example.test")
        self.assertTrue(owner.is_staff)
        self.assertEqual(
            set(owner.property_memberships.filter(is_active=True, role="owner").values_list(
                "property__name", flat=True
            )),
            {fields["name"] for fields in PROPERTIES},
        )

    def test_running_again_adds_nothing(self):
        seed()
        counts = (
            Tenancy.objects.count(),
            RentEntry.objects.count(),
            Payment.objects.count(),
            Receipt.objects.count(),
            PropertyMembership.objects.count(),
            User.objects.count(),
        )

        output = seed()

        self.assertEqual(
            counts,
            (
                Tenancy.objects.count(),
                RentEntry.objects.count(),
                Payment.objects.count(),
                Receipt.objects.count(),
                PropertyMembership.objects.count(),
                User.objects.count(),
            ),
        )
        self.assertIn("added 0 bills, 0 payments, 0 receipts", output)

    def test_a_rerun_a_month_later_settles_the_bill_that_was_part_paid(self):
        today = business_date()
        a_month_ago = today - timedelta(days=31)
        with mock.patch(
            "properties.management.commands.seed_dev_data.business_date", return_value=a_month_ago
        ):
            seed()
        seed()

        for name in (seed_.name for seed_ in TENANCIES if seed_.outcome == PARTIAL):
            bills = list(
                RentEntry.objects.active()
                .filter(tenancy__name=name)
                .order_by("-billing_month")
            )
            with self.subTest(tenant=name):
                self.assertEqual(
                    [self.outstanding(bill) > 0 for bill in bills],
                    [True] + [False] * (len(bills) - 1),
                )

    @staticmethod
    def outstanding(bill):
        paid = sum(p.amount for p in Payment.objects.filter(entry=bill).effective())
        due = calculate_total_due(
            bill.rent_amount, bill.electricity_units, bill.electricity_rate, bill.water_amount
        )
        return due - paid

    def test_a_password_is_optional(self):
        seed("--password", "local-only-password")

        self.assertTrue(User.objects.get(email="seeder@example.test").has_usable_password())

    @override_settings(DEBUG=False)
    def test_refuses_outside_development(self):
        with self.assertRaises(CommandError):
            seed()
        self.assertFalse(Property.objects.exists())
