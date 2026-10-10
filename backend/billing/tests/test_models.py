from datetime import date
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.forms.models import model_to_dict
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from billing.models import RentEntry, tenancy_covers_month
from properties.models import Tenancy, TenancyHasBillsError

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

    def void_fields(self, reason="Wrong electricity units"):
        return {
            "status": "void",
            "voided_at": timezone.now(),
            "voided_by": self.user,
            "void_reason": reason,
        }

    def test_one_active_bill_per_tenancy_and_month(self):
        self.make_entry()

        self.assert_rejected("unique_active_tenancy_billing_month")
        # Another month, or another tenancy's same month, is fine.
        self.make_entry(billing_month=date(2026, 11, 1))
        other = make_tenancy(self.tenancy.property, flat_number="301")
        self.make_entry(tenancy=other)

    def test_void_bills_stay_beside_the_months_active_one(self):
        self.make_entry(**self.void_fields())
        self.make_entry(**self.void_fields("Entered twice"))
        self.make_entry()

        self.assert_rejected("unique_active_tenancy_billing_month")
        self.assertEqual(RentEntry.objects.filter(tenancy=self.tenancy).count(), 3)
        self.assertEqual(RentEntry.objects.active().count(), 1)

    def test_a_void_bill_records_who_voided_it_when_and_why(self):
        for missing in ("voided_at", "voided_by", "void_reason"):
            with self.subTest(missing=missing):
                fields = self.void_fields()
                fields[missing] = "" if missing == "void_reason" else None
                self.assert_rejected("rent_entry_void_details_match_status", **fields)

    def test_an_active_bill_has_no_void_details(self):
        for field, value in self.void_fields().items():
            if field == "status":
                continue
            with self.subTest(field=field):
                self.assert_rejected("rent_entry_void_details_match_status", **{field: value})

    def test_a_bill_cannot_replace_itself(self):
        entry = self.make_entry(**self.void_fields())

        with self.assertRaises(IntegrityError) as raised, transaction.atomic():
            RentEntry.objects.filter(pk=entry.pk).update(replaces_entry=entry)
        self.assertIn("rent_entry_not_replacing_itself", str(raised.exception))

    def test_a_bill_is_replaced_at_most_once(self):
        original = self.make_entry(**self.void_fields())
        self.make_entry(replaces_entry=original)

        with self.assertRaises(IntegrityError), transaction.atomic():
            self.make_entry(
                replaces_entry=original, billing_month=date(2026, 11, 1)
            )

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


class TenancyPropertyWithBillsTests(TestCase):
    """Bills are scoped through their tenancy's property, so a tenancy with bills can't move."""

    def setUp(self):
        self.user = make_user()
        self.tower = make_property("Tower")
        self.annex = make_property("Annex")
        self.tenancy = make_tenancy(self.tower)

    def add_bill(self):
        RentEntry.objects.create(
            tenancy=self.tenancy,
            billing_month=date(2026, 10, 1),
            rent_amount=Decimal("15000.00"),
            electricity_units=Decimal("75.000"),
            electricity_rate=Decimal("6.00"),
            water_amount=Decimal("0.00"),
            created_by=self.user,
        )

    def test_a_tenancy_without_bills_can_move(self):
        self.tenancy.property = self.annex
        self.tenancy.full_clean()
        self.tenancy.save()

        self.tenancy.refresh_from_db()
        self.assertEqual(self.tenancy.property, self.annex)

    def test_a_tenancy_with_bills_keeps_its_property(self):
        self.add_bill()
        self.tenancy.property = self.annex

        with self.assertRaises(ValidationError) as caught:
            self.tenancy.full_clean()
        self.assertIn("property", caught.exception.message_dict)
        # Saving without validating (as when a bill arrives after validation) is refused too.
        with self.assertRaises(TenancyHasBillsError):
            self.tenancy.save()

        self.tenancy.refresh_from_db()
        self.assertEqual(self.tenancy.property, self.tower)

    def test_other_changes_to_a_tenancy_with_bills_still_save(self):
        self.add_bill()
        self.tenancy.rent_amount = Decimal("16000.00")
        self.tenancy.full_clean()
        self.tenancy.save()

        self.tenancy.refresh_from_db()
        self.assertEqual(self.tenancy.rent_amount, Decimal("16000.00"))


class TenancyAdminWithBillsTests(TestCase):
    def setUp(self):
        admin = get_user_model().objects.create_superuser(username="admin", password="pass")
        self.client.force_login(admin)
        self.tower = make_property("Tower")
        self.annex = make_property("Annex")
        self.tenancy = make_tenancy(self.tower)
        self.url = reverse("admin:properties_tenancy_change", args=[self.tenancy.pk])

    def add_bill(self):
        RentEntry.objects.create(
            tenancy=self.tenancy,
            billing_month=date(2026, 10, 1),
            rent_amount=Decimal("15000.00"),
            electricity_units=Decimal("0.000"),
            electricity_rate=Decimal("6.00"),
            water_amount=Decimal("0.00"),
            created_by=make_user(),
        )

    def post_with_property(self, prop):
        fields = model_to_dict(self.tenancy, exclude=["id"])
        data = {key: "" if value is None else str(value) for key, value in fields.items()}
        data["property"] = str(prop.pk)
        return self.client.post(self.url, data)

    def test_property_is_read_only_once_the_tenancy_has_bills(self):
        self.assertIn("property", self.client.get(self.url).context["adminform"].form.fields)

        self.add_bill()
        response = self.client.get(self.url)

        self.assertNotIn("property", response.context["adminform"].form.fields)
        self.post_with_property(self.annex)
        self.tenancy.refresh_from_db()
        self.assertEqual(self.tenancy.property, self.tower)

    def test_a_bill_added_after_the_form_loaded_blocks_the_move_without_an_error_page(self):
        self.add_bill()
        # The form was loaded while the property was still editable.
        with mock.patch(
            "properties.admin.TenancyAdmin.get_readonly_fields",
            return_value=("status", "id", "created_at", "updated_at"),
        ), mock.patch.object(Tenancy, "clean"):
            response = self.post_with_property(self.annex)

        self.assertEqual(response.status_code, 302)
        self.tenancy.refresh_from_db()
        self.assertEqual(self.tenancy.property, self.tower)
        page = self.client.get(response["Location"])
        self.assertContains(page, "Not saved: this tenancy now has bills")
