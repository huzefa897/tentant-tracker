from datetime import date
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.test import TestCase

from billing.models import RentEntry, tenancy_covers_month

from .factories import make_property, make_tenancy, make_user


class RentEntryConstraintTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.tenancy = make_tenancy(make_property())

    def make_entry(self, **fields):
        defaults = {
            "tenancy": self.tenancy,
            "billing_month": date(2026, 10, 1),
            "rent_amount": Decimal("15000.00"),
            "electricity_units": Decimal("75.000"),
            "electricity_rate": Decimal("6.00"),
            "water_amount": Decimal("300.00"),
            "created_by": self.user,
        }
        return RentEntry.objects.create(**{**defaults, **fields})

    def assert_rejected(self, constraint, **fields):
        with self.assertRaises(IntegrityError) as raised, transaction.atomic():
            self.make_entry(**fields)
        self.assertIn(constraint, str(raised.exception))

    def test_one_bill_per_tenancy_and_month(self):
        self.make_entry()

        self.assert_rejected("unique_tenancy_billing_month")
        # Another month, or another tenancy's same month, is fine.
        self.make_entry(billing_month=date(2026, 11, 1))
        other = make_tenancy(self.tenancy.property, flat_number="301")
        self.make_entry(tenancy=other)

    def test_rent_must_be_positive(self):
        self.assert_rejected("rent_entry_rent_amount_positive", rent_amount=Decimal("0"))

    def test_units_rate_and_water_cannot_be_negative(self):
        self.assert_rejected(
            "rent_entry_electricity_units_not_negative", electricity_units=Decimal("-1")
        )
        self.assert_rejected(
            "rent_entry_electricity_rate_not_negative", electricity_rate=Decimal("-0.01")
        )
        self.assert_rejected("rent_entry_water_amount_not_negative", water_amount=Decimal("-1"))
        # Zero is allowed for all three.
        self.make_entry(
            electricity_units=Decimal("0"), electricity_rate=Decimal("0"), water_amount=Decimal("0")
        )

    def test_billing_month_is_the_first_of_a_month(self):
        self.assert_rejected("rent_entry_billing_month_first_day", billing_month=date(2026, 10, 2))

    def test_a_tenancy_with_bills_cannot_be_deleted(self):
        self.make_entry()

        with self.assertRaises(ProtectedError):
            self.tenancy.delete()


class TenancyCoversMonthTests(TestCase):
    def test_any_overlapping_day_counts_and_end_dates_are_inclusive(self):
        tenancy = make_tenancy(
            make_property(), start_date=date(2026, 9, 20), end_date=date(2027, 3, 1)
        )

        self.assertFalse(tenancy_covers_month(tenancy, date(2026, 8, 1)))
        self.assertTrue(tenancy_covers_month(tenancy, date(2026, 9, 1)))
        self.assertTrue(tenancy_covers_month(tenancy, date(2027, 3, 1)))
        self.assertFalse(tenancy_covers_month(tenancy, date(2027, 4, 1)))

    def test_an_open_tenancy_covers_later_months(self):
        tenancy = make_tenancy(make_property(), start_date=date(2026, 1, 31))

        self.assertTrue(tenancy_covers_month(tenancy, date(2026, 1, 1)))
        self.assertTrue(tenancy_covers_month(tenancy, date(2030, 12, 1)))
        self.assertFalse(tenancy_covers_month(tenancy, date(2025, 12, 1)))
