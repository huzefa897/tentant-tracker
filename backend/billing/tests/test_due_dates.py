"""Due dates: a bill is due when its rental period is, and compared with today."""

import uuid
from datetime import date
from decimal import Decimal
from io import StringIO
from unittest import mock

from django.core.management import CommandError, call_command
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from billing.calculations import DueStatus, due_date_for, due_status
from billing.models import PaymentReversal, RentalPeriod, RentEntry
from billing.periods import ensure_periods
from billing.services import PeriodNotOwedError, correct_rent_entry, create_rent_entry
from properties.models import PaymentTiming, Property, Tenancy

from .factories import make_property, make_tenancy, make_user
from .test_payments_api import entries_url, make_entry, make_payment

SEPTEMBER = date(2026, 9, 1)


class DueDateForTests(TestCase):
    def test_postpaid_is_due_in_the_following_month(self):
        self.assertEqual(due_date_for(SEPTEMBER, 11, "postpaid"), date(2026, 10, 11))

    def test_prepaid_is_due_in_the_billing_month(self):
        self.assertEqual(due_date_for(SEPTEMBER, 11, "prepaid"), date(2026, 9, 11))

    def test_postpaid_december_is_due_in_january(self):
        self.assertEqual(due_date_for(date(2026, 12, 1), 5, "postpaid"), date(2027, 1, 5))

    def test_a_late_due_day_falls_on_a_short_months_last_day(self):
        self.assertEqual(due_date_for(date(2027, 1, 1), 31, "postpaid"), date(2027, 2, 28))
        self.assertEqual(due_date_for(date(2028, 1, 1), 30, "postpaid"), date(2028, 2, 29))
        self.assertEqual(due_date_for(date(2026, 4, 1), 31, "prepaid"), date(2026, 4, 30))
        self.assertEqual(due_date_for(date(2026, 5, 1), 31, "prepaid"), date(2026, 5, 31))

    def test_refuses_an_unknown_timing(self):
        with self.assertRaises(ValueError):
            due_date_for(SEPTEMBER, 11, "whenever")


class DueStatusTests(TestCase):
    TODAY = date(2026, 10, 15)

    def status(self, due, outstanding="5750.00"):
        return due_status(due, Decimal(outstanding), self.TODAY)

    def test_compares_the_due_date_with_today_while_money_is_owed(self):
        self.assertEqual(self.status(date(2026, 10, 14)), DueStatus.OVERDUE)
        self.assertEqual(self.status(date(2026, 10, 15)), DueStatus.DUE_TODAY)
        self.assertEqual(self.status(date(2026, 10, 16)), DueStatus.UPCOMING)

    def test_a_bill_with_nothing_owed_is_settled_whenever_it_was_due(self):
        self.assertEqual(self.status(date(2026, 10, 1), "0.00"), DueStatus.SETTLED)
        self.assertEqual(self.status(date(2026, 11, 1), "0.00"), DueStatus.SETTLED)

    def test_no_due_date_has_no_status(self):
        self.assertIsNone(self.status(None))


class TenancyDueDayTests(TestCase):
    def setUp(self):
        self.prop = make_property()

    def test_defaults_to_the_start_dates_day(self):
        saved = make_tenancy(self.prop, rent_due_day=None, start_date=date(2026, 9, 15))
        self.assertEqual(saved.rent_due_day, 15)

        cleaned = Tenancy(
            property=self.prop,
            name="Mohammed Yusuf",
            flat_number="301",
            mobile_number="+919000000102",
            rent_amount=Decimal("18000.00"),
            electricity_rate=Decimal("6.00"),
            deposit_amount=Decimal("0"),
            start_date=date(2026, 10, 1),
        )
        cleaned.full_clean()
        self.assertEqual(cleaned.rent_due_day, 1)

    def test_a_given_day_wins_and_can_be_late_in_the_month(self):
        tenancy = make_tenancy(self.prop, rent_due_day=31, start_date=date(2026, 9, 15))
        tenancy.full_clean()
        self.assertEqual(tenancy.rent_due_day, 31)


class BillDueDateTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.prop = make_property(member=self.user, role="owner")
        self.tenancy = make_tenancy(self.prop, rent_due_day=11)

    def create(self, month=SEPTEMBER, tenancy=None):
        return create_rent_entry(
            tenancy=tenancy or self.tenancy,
            actor=self.user,
            validated_data={
                "billing_month": month,
                "electricity_units": Decimal("75"),
                "water_amount": Decimal("300"),
            },
        ).entry

    def period(self, month=SEPTEMBER):
        return RentalPeriod.objects.get(tenancy=self.tenancy, period_month=month)

    def due(self, month=SEPTEMBER):
        period = self.period(month)
        return period.payment_timing, period.due_day, period.due_date

    def test_a_postpaid_september_bill_is_due_on_11_october(self):
        self.create()

        self.assertEqual(self.due(), (PaymentTiming.POSTPAID, 11, date(2026, 10, 11)))

    def test_a_prepaid_september_bill_is_due_on_11_september(self):
        self.prop.payment_timing = PaymentTiming.PREPAID
        self.prop.save()

        self.create()

        self.assertEqual(self.due(), (PaymentTiming.PREPAID, 11, date(2026, 9, 11)))

    def test_a_bill_prepared_late_keeps_its_months_due_date(self):
        # September became due (and got its period) on the 11th; the tenant then moved to the
        # 1st, and the bill was prepared after.
        self.prop.rent_tracking_start = SEPTEMBER
        self.prop.save()
        ensure_periods(self.tenancy, date(2026, 10, 12))
        self.tenancy.rent_due_day = 1
        self.tenancy.save()

        self.create()

        self.assertEqual(self.due(), ("postpaid", 11, date(2026, 10, 11)))
        self.assertEqual(RentalPeriod.objects.filter(tenancy=self.tenancy).count(), 1)

    def test_changing_the_timing_or_due_day_only_affects_months_without_a_period(self):
        self.create()
        self.prop.payment_timing = PaymentTiming.PREPAID
        self.prop.save()
        self.tenancy.rent_due_day = 1
        self.tenancy.save()

        self.create(date(2026, 10, 1))

        self.assertEqual(self.due(), ("postpaid", 11, date(2026, 10, 11)))
        self.assertEqual(self.due(date(2026, 10, 1)), ("prepaid", 1, date(2026, 10, 1)))

    def test_a_correction_belongs_to_the_same_period(self):
        original = self.create()
        self.tenancy.rent_due_day = 1
        self.tenancy.save()

        correct_rent_entry(
            entry_id=original.pk,
            actor=self.user,
            reason="Wrong units",
            idempotency_key=uuid.uuid4(),
            validated_data={
                "rent_amount": original.rent_amount,
                "electricity_units": Decimal("80"),
                "water_amount": original.water_amount,
            },
        )

        self.assertEqual(self.due(), ("postpaid", 11, date(2026, 10, 11)))
        self.assertEqual(RentalPeriod.objects.filter(tenancy=self.tenancy).count(), 1)

    def test_a_month_marked_not_owed_cant_have_a_bill(self):
        self.create()
        period = self.period()
        RentEntry.objects.filter(tenancy=self.tenancy).update(
            status="void",
            voided_at="2026-10-02T10:00:00Z",
            voided_by=self.user,
            void_reason="Rent waived",
        )
        RentalPeriod.objects.filter(pk=period.pk).update(
            not_owed_at="2026-10-02T10:01:00Z", not_owed_by=self.user, not_owed_reason="Waived"
        )

        with self.assertRaises(PeriodNotOwedError):
            self.create()


class RentalPeriodConstraintTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.tenancy = make_tenancy(make_property())
        self.period = RentalPeriod.objects.create(
            tenancy=self.tenancy,
            period_month=SEPTEMBER,
            payment_timing="postpaid",
            due_day=11,
            due_date=date(2026, 10, 11),
        )

    def test_the_database_refuses_inconsistent_periods(self):
        cases = (
            {"period_month": date(2026, 9, 2)},
            {"payment_timing": "whenever"},
            {"due_day": 0},
            {"due_day": 32},
            {"due_date": date(2026, 8, 31)},
            {"not_owed_reason": "Waived"},
            {"not_owed_at": "2026-10-02T10:00:00Z", "not_owed_by": self.user},
        )
        for fields in cases:
            with self.subTest(fields), self.assertRaises(IntegrityError), transaction.atomic():
                RentalPeriod.objects.filter(pk=self.period.pk).update(**fields)

    def test_one_period_per_tenancy_and_month(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            RentalPeriod.objects.create(
                tenancy=self.tenancy,
                period_month=SEPTEMBER,
                payment_timing="prepaid",
                due_day=1,
                due_date=SEPTEMBER,
            )


class DueStatusApiTests(TestCase):
    TODAY = date(2026, 10, 15)

    def setUp(self):
        patcher = mock.patch("billing.serializers.business_date", return_value=self.TODAY)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = make_user()
        self.prop = make_property(member=self.user)
        self.tenancy = make_tenancy(self.prop)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def bill(self, due_date, month=SEPTEMBER):
        entry = make_entry(self.tenancy, self.user, month=month)
        RentalPeriod.objects.filter(tenancy=self.tenancy, period_month=month).update(
            due_date=due_date
        )
        return entry

    def shown(self, entry):
        response = self.client.get(f"{entries_url(self.prop, self.tenancy)}{entry.pk}/")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_a_partly_paid_bill_past_its_due_date_is_overdue(self):
        entry = self.bill(date(2026, 10, 14))
        make_payment(entry, self.user, "10000.00")

        body = self.shown(entry)

        self.assertEqual(body["paymentStatus"], "partially_paid")
        self.assertEqual(body["outstandingAmount"], "5750.00")
        self.assertEqual(body["dueStatus"], "overdue")
        self.assertEqual(body["dueDate"], "2026-10-14")
        self.assertEqual(body["paymentTiming"], "postpaid")

    def test_a_bill_due_today_is_due_today_not_overdue(self):
        self.assertEqual(self.shown(self.bill(self.TODAY))["dueStatus"], "due_today")

    def test_a_paid_bill_is_settled_even_when_its_due_date_has_passed(self):
        entry = self.bill(date(2026, 10, 1))
        make_payment(entry, self.user, "15750.00")

        self.assertEqual(self.shown(entry)["dueStatus"], "settled")

    def test_a_reversed_payment_no_longer_settles_the_bill(self):
        entry = self.bill(date(2026, 10, 1))
        payment = make_payment(entry, self.user, "15750.00")
        PaymentReversal.objects.create(payment=payment, reason="Bounced", created_by=self.user)

        self.assertEqual(self.shown(entry)["dueStatus"], "overdue")

    def test_a_void_bill_has_no_due_status(self):
        entry = self.bill(date(2026, 10, 1))
        RentEntry.objects.filter(pk=entry.pk).update(
            status="void",
            voided_at="2026-10-02T10:00:00Z",
            voided_by=self.user,
            void_reason="Entered twice",
        )

        body = self.shown(entry)

        self.assertEqual(body["dueDate"], "2026-10-01")
        self.assertIsNone(body["dueStatus"])

    def test_lists_show_each_bills_period(self):
        self.bill(date(2026, 9, 11), month=date(2026, 8, 1))
        self.bill(date(2026, 10, 11))

        response = self.client.get(entries_url(self.prop, self.tenancy))

        self.assertEqual(
            [row["dueDate"] for row in response.json()["results"]], ["2026-10-11", "2026-09-11"]
        )

    def test_the_due_date_cant_be_sent(self):
        response = self.client.post(
            entries_url(self.prop, self.tenancy),
            {
                "billingMonth": "2026-11",
                "electricityUnits": "75",
                "waterAmount": "300",
                "dueDate": "2026-11-01",
                "paymentTiming": "prepaid",
                "dueStatus": "settled",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.json()), {"dueDate", "paymentTiming", "dueStatus"})


class SetRentalPeriodDueDayCommandTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.prop = make_property()
        self.zahid = make_tenancy(self.prop, rent_due_day=11)
        self.yusuf = make_tenancy(
            self.prop, name="Mohammed Yusuf", flat_number="301", rent_due_day=20
        )
        make_entry(self.zahid, self.user, month=date(2026, 7, 1))
        make_entry(self.zahid, self.user, month=date(2026, 8, 1))
        make_entry(self.zahid, self.user, month=SEPTEMBER)
        make_entry(self.yusuf, self.user, month=SEPTEMBER)

    def run_command(self, *args):
        out = StringIO()
        call_command("set_rental_period_due_day", *args, stdout=out)
        return out.getvalue()

    def due(self, tenancy, month):
        return RentalPeriod.objects.get(tenancy=tenancy, period_month=month).due_date

    def test_dry_run_lists_the_changes_and_saves_nothing(self):
        out = self.run_command("--tenancy", str(self.zahid.pk), "--due-day", "5", "--dry-run")

        self.assertIn("Flat 202 · Shaik Zahid Ali · August 2026: due 11 September 2026 → 05", out)
        self.assertIn("Would change 3 period(s). Nothing was saved.", out)
        self.assertEqual(self.due(self.zahid, SEPTEMBER), date(2026, 10, 11))

    def test_changes_one_tenancys_months_in_the_range(self):
        # Zahid's due day was the 5th until August.
        out = self.run_command(
            "--tenancy", str(self.zahid.pk), "--due-day", "5", "--from", "2026-08", "--until",
            "2026-08",
        )

        self.assertIn("Changed 1 period(s).", out)
        self.assertEqual(self.due(self.zahid, date(2026, 7, 1)), date(2026, 8, 11))
        self.assertEqual(self.due(self.zahid, date(2026, 8, 1)), date(2026, 9, 5))
        self.assertEqual(self.due(self.zahid, SEPTEMBER), date(2026, 10, 11))
        self.assertEqual(self.due(self.yusuf, SEPTEMBER), date(2026, 10, 20))
        self.zahid.refresh_from_db()
        self.assertEqual(self.zahid.rent_due_day, 11)

    def test_reports_when_nothing_changes(self):
        out = self.run_command("--tenancy", str(self.zahid.pk), "--due-day", "11")

        self.assertIn("Every matching period is already due on that day.", out)

    def test_refuses_malformed_options(self):
        cases = (
            ("--tenancy", "zahid", "--due-day", "5"),
            ("--tenancy", str(self.zahid.pk), "--due-day", "32"),
            ("--tenancy", str(self.zahid.pk), "--due-day", "5", "--until", "2026-13"),
        )
        for args in cases:
            with self.subTest(args), self.assertRaises(CommandError):
                self.run_command(*args)


class PreviewRentTrackingCommandTests(TestCase):
    TODAY = date(2026, 10, 16)

    def setUp(self):
        patcher = mock.patch(
            "billing.management.commands.preview_rent_tracking.business_date",
            return_value=self.TODAY,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = make_user()
        self.prop = make_property()
        self.zahid = make_tenancy(self.prop, rent_due_day=11, start_date=date(2026, 8, 20))
        make_entry(self.zahid, self.user, month=date(2026, 8, 1))

    def run_command(self, start, prop=None):
        out = StringIO()
        call_command(
            "preview_rent_tracking", "--property", str((prop or self.prop).pk), "--start", start,
            stdout=out,
        )
        return out.getvalue()

    def test_lists_the_months_with_no_bill_and_saves_nothing(self):
        out = self.run_command("2026-07")

        # August has a bill; September is due 11 Oct; October isn't due until 11 Nov.
        self.assertIn("Flat 202 · Shaik Zahid Ali · September 2026: no bill", out)
        self.assertNotIn("August", out)
        self.assertNotIn("July", out)
        self.assertNotIn("October", out)
        self.assertIn("1 month(s) would show as due or overdue, awaiting a bill.", out)
        self.assertIsNone(Property.objects.get(pk=self.prop.pk).rent_tracking_start)
        self.assertEqual(RentalPeriod.objects.count(), 1)

    def test_says_so_when_every_month_has_a_bill(self):
        self.assertIn("Every month from then has a bill.", self.run_command("2026-10"))

    def test_refuses_an_unknown_property_or_a_malformed_month(self):
        for args in (("2026-13",), ("Sept",)):
            with self.subTest(args), self.assertRaises(CommandError):
                self.run_command(*args)
        with self.assertRaises(CommandError):
            call_command(
                "preview_rent_tracking", "--property", str(uuid.uuid4()), "--start", "2026-09"
            )
