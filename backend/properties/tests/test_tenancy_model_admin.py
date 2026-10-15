from datetime import date, timedelta
from decimal import Decimal
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import CommandError, call_command
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.urls import reverse

from properties.models import Property, Tenancy

TODAY = date(2026, 10, 5)


def valid_fields(prop, **overrides):
    return {
        "property": prop,
        "name": "Shaik Zahid Ali",
        "flat_number": "202",
        "mobile_number": "+919000000101",
        "rent_amount": Decimal("15000.00"),
        "rent_due_day": 11,
        "electricity_rate": Decimal("6.00"),
        "deposit_amount": Decimal("90000.00"),
        "start_date": date(2026, 1, 1),
        **overrides,
    }


class TenancyModelTests(TestCase):
    def setUp(self):
        self.tower = Property.objects.create(name="Tower", address="A")

    def errors(self, **overrides):
        with self.assertRaises(ValidationError) as caught:
            Tenancy(**valid_fields(self.tower, **overrides)).full_clean()
        return caught.exception.message_dict

    def test_tidies_name_flat_and_mobile(self):
        tenancy = Tenancy(
            **valid_fields(
                self.tower, name="  Shaik   Zahid Ali ", flat_number=" g-01 ", mobile_number="+91 90000 00101"
            )
        )

        tenancy.full_clean()

        self.assertEqual(tenancy.name, "Shaik Zahid Ali")
        self.assertEqual(tenancy.flat_number, "G-01")
        self.assertEqual(tenancy.mobile_number, "+919000000101")

    def test_requires_name_flat_and_a_valid_mobile(self):
        self.assertIn("name", self.errors(name="   "))
        self.assertIn("flat_number", self.errors(flat_number=" "))
        self.assertIn("mobile_number", self.errors(mobile_number="12345"))

    def test_rejects_invalid_amounts_and_due_days(self):
        self.assertIn("rent_amount", self.errors(rent_amount=Decimal("0")))
        self.assertIn("rent_due_day", self.errors(rent_due_day=0))
        self.assertIn("rent_due_day", self.errors(rent_due_day=32))
        self.assertIn("electricity_rate", self.errors(electricity_rate=Decimal("-0.01")))
        self.assertIn("deposit_amount", self.errors(deposit_amount=Decimal("-1")))
        self.assertIn("rent_amount", self.errors(rent_amount=Decimal("1.005")))

    def test_allows_zero_rate_and_deposit(self):
        Tenancy(**valid_fields(self.tower, electricity_rate=0, deposit_amount=0)).full_clean()

    def test_end_date_cannot_precede_start_date(self):
        errors = self.errors(start_date=date(2026, 5, 2), end_date=date(2026, 5, 1))

        self.assertEqual(errors["end_date"], ["The end date can't be before the start date."])
        # A one-day tenancy is fine.
        Tenancy(**valid_fields(self.tower, end_date=date(2026, 1, 1))).full_clean()

    def test_database_constraints_protect_stored_data(self):
        cases = (
            {"rent_amount": Decimal("0")},
            {"rent_due_day": 32},
            {"electricity_rate": Decimal("-1")},
            {"deposit_amount": Decimal("-1")},
            {"end_date": date(2025, 12, 31)},
        )
        for overrides in cases:
            with self.subTest(overrides), self.assertRaises(IntegrityError), transaction.atomic():
                Tenancy.objects.create(**valid_fields(self.tower, **overrides))

    def test_status_comes_from_the_dates_with_inclusive_end(self):
        def status(start, end=None):
            return Tenancy(start_date=start, end_date=end).status_on(TODAY)

        self.assertEqual(status(TODAY + timedelta(1)), "upcoming")
        self.assertEqual(status(TODAY), "current")
        self.assertEqual(status(date(2026, 1, 1), TODAY), "current")
        self.assertEqual(status(date(2026, 1, 1), TODAY - timedelta(1)), "ended")

    def test_status_querysets_agree_with_status_on(self):
        Tenancy.objects.create(**valid_fields(self.tower, name="Ended", end_date=TODAY - timedelta(1)))
        Tenancy.objects.create(
            **valid_fields(self.tower, name="Current", flat_number="301", end_date=TODAY)
        )
        Tenancy.objects.create(
            **valid_fields(self.tower, name="Upcoming", flat_number="302", start_date=TODAY + timedelta(1))
        )

        for status in ("upcoming", "current", "ended"):
            matched = Tenancy.objects.with_status(status, TODAY)
            self.assertEqual([t.name.lower() for t in matched], [status])
            self.assertTrue(all(t.status_on(TODAY) == status for t in matched))
        self.assertEqual(Tenancy.objects.with_status("all", TODAY).count(), 3)

    def test_flat_numbers_repeat_across_properties_and_over_time(self):
        annex = Property.objects.create(name="Annex", address="B")
        Tenancy.objects.create(**valid_fields(self.tower, end_date=date(2026, 3, 31)))

        Tenancy(**valid_fields(annex)).full_clean()
        Tenancy(**valid_fields(self.tower, name="Next", start_date=date(2026, 4, 1))).full_clean()

    def test_occupancy_periods_of_a_flat_cannot_overlap(self):
        Tenancy.objects.create(
            **valid_fields(self.tower, start_date=date(2026, 1, 1), end_date=date(2026, 3, 31))
        )

        for start, end in (
            (date(2026, 3, 31), None),  # Starts on the last (inclusive) day.
            (date(2025, 12, 1), date(2026, 1, 1)),  # Ends on the first day.
            (date(2026, 2, 1), date(2026, 2, 2)),  # Inside.
            (date(2025, 1, 1), None),  # Open-ended, covering it.
        ):
            with self.subTest(start=start, end=end):
                errors = self.errors(name="Other", flat_number=" 202", start_date=start, end_date=end)
                # One message, naming the clash (the database constraint isn't repeated).
                self.assertEqual(len(errors["__all__"]), 1)
                self.assertIn("Flat 202 already has a tenancy", errors["__all__"][0])

    def test_the_database_refuses_overlaps_that_skip_validation(self):
        # As when two admins save at once: both pass clean(), then insert.
        Tenancy.objects.create(
            **valid_fields(self.tower, start_date=date(2026, 1, 1), end_date=date(2026, 3, 31))
        )

        for start, end in (
            (date(2026, 3, 31), None),
            (date(2025, 12, 1), date(2026, 1, 1)),
            (date(2025, 1, 1), None),
        ):
            with self.subTest(start=start, end=end), self.assertRaises(IntegrityError):
                with transaction.atomic():
                    Tenancy.objects.create(
                        **valid_fields(self.tower, name="Other", start_date=start, end_date=end)
                    )

        # The day after, another flat, or another property is fine.
        Tenancy.objects.create(**valid_fields(self.tower, name="Next", start_date=date(2026, 4, 1)))
        Tenancy.objects.create(**valid_fields(self.tower, flat_number="301"))
        annex = Property.objects.create(name="Annex", address="B")
        Tenancy.objects.create(**valid_fields(annex))
        self.assertEqual(Tenancy.objects.count(), 4)

    def test_an_open_tenancy_blocks_later_ones(self):
        Tenancy.objects.create(**valid_fields(self.tower))

        self.assertIn("__all__", self.errors(name="Other", start_date=date(2027, 1, 1)))

    def test_editing_a_tenancy_does_not_overlap_itself(self):
        tenancy = Tenancy.objects.create(**valid_fields(self.tower))
        tenancy.rent_amount = Decimal("16000.00")

        tenancy.full_clean()


class TenancyAdminTests(TestCase):
    def setUp(self):
        admin = get_user_model().objects.create_superuser(username="admin", password="pass")
        self.client.force_login(admin)
        self.tower = Property.objects.create(name="Tower", address="A")

    def post(self, **overrides):
        data = valid_fields(self.tower, **overrides)
        data["property"] = self.tower.pk
        data = {key: "" if value is None else str(value) for key, value in data.items()}
        return self.client.post(reverse("admin:properties_tenancy_add"), data)

    def test_adds_a_tenancy(self):
        response = self.post(flat_number="g-01")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(Tenancy.objects.get().flat_number, "G-01")

    def test_invalid_amounts_and_dates_block_the_record(self):
        for overrides in (
            {"rent_amount": "0"},
            {"rent_due_day": "32"},
            {"electricity_rate": "-1"},
            {"deposit_amount": "-5"},
            {"start_date": "2026-05-02", "end_date": "2026-05-01"},
        ):
            with self.subTest(overrides):
                response = self.post(**overrides)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.context["adminform"].form.errors)
        self.assertFalse(Tenancy.objects.exists())

    def test_overlapping_occupancy_is_blocked(self):
        self.post()
        response = self.post(name="Someone Else", start_date="2026-06-01")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Flat 202 already has a tenancy")
        self.assertEqual(Tenancy.objects.count(), 1)

    def test_an_overlap_saved_at_the_same_time_is_refused_without_an_error_page(self):
        self.post()
        # The other admin's tenancy wasn't there when this one was validated.
        with mock.patch.object(Tenancy, "_check_no_overlap"):
            response = self.post(name="Someone Else", start_date="2026-06-01")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(Tenancy.objects.count(), 1)
        page = self.client.get(response["Location"])
        self.assertContains(page, "Not saved: this flat already has a tenancy in this period")

    def test_list_search_and_filters(self):
        Tenancy.objects.create(**valid_fields(self.tower))
        url = reverse("admin:properties_tenancy_changelist")

        self.assertContains(self.client.get(url), "Shaik Zahid Ali")
        self.assertContains(self.client.get(url, {"q": "zahid"}), "Shaik Zahid Ali")
        self.assertNotContains(self.client.get(url, {"status": "ended"}), "Shaik Zahid Ali")
        self.assertContains(self.client.get(url, {"property__id__exact": self.tower.pk}), "Current")


@override_settings(DEBUG=True)
class CreateDevTenanciesCommandTests(TestCase):
    def setUp(self):
        self.tower = Property.objects.create(name="Tower", address="A")

    def run_command(self, *args):
        out = StringIO()
        call_command("create_dev_tenancies", *args, stdout=out)
        return out.getvalue()

    def test_adds_three_tenancies_once(self):
        self.run_command("Tower")
        output = self.run_command(str(self.tower.pk))

        self.assertEqual(self.tower.tenancies.count(), 3)
        self.assertIn("Skipped Flat 202", output)

    def test_unknown_property(self):
        with self.assertRaises(CommandError):
            self.run_command("Nowhere")

    @override_settings(DEBUG=False)
    def test_refuses_outside_development(self):
        with self.assertRaises(CommandError):
            self.run_command("Tower")
        self.assertFalse(Tenancy.objects.exists())
