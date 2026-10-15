"""Due dates: worked out when a bill is created, saved with it, and compared with today."""

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
from billing.models import PaymentReversal, RentEntry
from billing.services import correct_rent_entry, create_rent_entry
from properties.models import PaymentTiming, Tenancy

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

    def test_a_postpaid_september_bill_is_due_on_11_october(self):
        entry = self.create()

        self.assertEqual(entry.payment_timing, PaymentTiming.POSTPAID)
        self.assertEqual(entry.due_date, date(2026, 10, 11))

    def test_a_prepaid_september_bill_is_due_on_11_september(self):
        self.prop.payment_timing = PaymentTiming.PREPAID
        self.prop.save()

        entry = self.create()

        self.assertEqual(entry.payment_timing, PaymentTiming.PREPAID)
        self.assertEqual(entry.due_date, date(2026, 9, 11))

    def test_changing_the_timing_or_due_day_only_affects_new_bills(self):
        september = self.create()
        self.prop.payment_timing = PaymentTiming.PREPAID
        self.prop.save()
        self.tenancy.rent_due_day = 1
        self.tenancy.save()

        october = self.create(date(2026, 10, 1))

        september.refresh_from_db()
        self.assertEqual(
            (september.payment_timing, september.due_date), ("postpaid", date(2026, 10, 11))
        )
        self.assertEqual((october.payment_timing, october.due_date), ("prepaid", date(2026, 10, 1)))

    def test_a_correction_keeps_the_original_due_date(self):
        original = self.create()
        self.tenancy.rent_due_day = 1
        self.tenancy.save()

        replacement = correct_rent_entry(
            entry_id=original.pk,
            actor=self.user,
            reason="Wrong units",
            idempotency_key=uuid.uuid4(),
            validated_data={
                "rent_amount": original.rent_amount,
                "electricity_units": Decimal("80"),
                "water_amount": original.water_amount,
            },
        ).replacement

        self.assertEqual(replacement.payment_timing, "postpaid")
        self.assertEqual(replacement.due_date, date(2026, 10, 11))

    def test_the_database_keeps_the_timing_and_due_date_together(self):
        entry = make_entry(self.tenancy, self.user)
        cases = (
            {"payment_timing": "postpaid", "due_date": None},
            {"payment_timing": None, "due_date": date(2026, 10, 11)},
            {"payment_timing": "postpaid", "due_date": date(2026, 8, 31)},
        )
        for fields in cases:
            with self.subTest(fields), self.assertRaises(IntegrityError), transaction.atomic():
                RentEntry.objects.filter(pk=entry.pk).update(**fields)


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
        RentEntry.objects.filter(pk=entry.pk).update(payment_timing="postpaid", due_date=due_date)
        entry.refresh_from_db()
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

    def test_a_bill_from_before_due_dates_shows_none(self):
        body = self.shown(make_entry(self.tenancy, self.user))

        self.assertEqual(
            (body["paymentTiming"], body["dueDate"], body["dueStatus"]), (None, None, None)
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


class FillBillDueDatesCommandTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.prop = make_property()
        self.zahid = make_tenancy(self.prop, rent_due_day=11)
        self.yusuf = make_tenancy(
            self.prop, name="Mohammed Yusuf", flat_number="301", rent_due_day=20
        )
        self.august = make_entry(self.zahid, self.user, month=date(2026, 8, 1))
        self.september = make_entry(self.zahid, self.user, month=SEPTEMBER)
        self.yusufs = make_entry(self.yusuf, self.user, month=SEPTEMBER)

    def run_command(self, *args):
        out = StringIO()
        call_command("fill_bill_due_dates", *args, stdout=out)
        return out.getvalue()

    def due(self, entry):
        entry.refresh_from_db()
        return entry.payment_timing, entry.due_date

    def test_dry_run_lists_the_due_dates_and_saves_nothing(self):
        out = self.run_command("--dry-run")

        self.assertIn("Flat 202 · Shaik Zahid Ali · September 2026: postpaid, due day 11", out)
        self.assertIn("due 11 October 2026", out)
        self.assertIn("Would give 3 bill(s) a due date. Nothing was saved.", out)
        self.assertEqual(self.due(self.september), (None, None))

    def test_fills_each_bill_from_its_tenancy_and_property(self):
        out = self.run_command()

        self.assertIn("Gave 3 bill(s) a due date.", out)
        self.assertEqual(self.due(self.august), ("postpaid", date(2026, 9, 11)))
        self.assertEqual(self.due(self.september), ("postpaid", date(2026, 10, 11)))
        self.assertEqual(self.due(self.yusufs), ("postpaid", date(2026, 10, 20)))

    def test_never_changes_a_bill_that_has_a_due_date(self):
        RentEntry.objects.filter(pk=self.september.pk).update(
            payment_timing="prepaid", due_date=date(2026, 9, 5)
        )

        self.run_command()

        self.assertEqual(self.due(self.september), ("prepaid", date(2026, 9, 5)))
        self.assertIn("Every matching bill already has a due date.", self.run_command())

    def test_fills_one_tenancys_months_up_to_a_month(self):
        # Zahid's due day was the 5th until August: set it for the run, then back.
        Tenancy.objects.filter(pk=self.zahid.pk).update(rent_due_day=5)
        self.run_command("--tenancy", str(self.zahid.pk), "--until", "2026-08")
        Tenancy.objects.filter(pk=self.zahid.pk).update(rent_due_day=11)
        self.run_command()

        self.assertEqual(self.due(self.august), ("postpaid", date(2026, 9, 5)))
        self.assertEqual(self.due(self.september), ("postpaid", date(2026, 10, 11)))
        self.assertEqual(self.due(self.yusufs), ("postpaid", date(2026, 10, 20)))

    def test_refuses_malformed_options(self):
        for args in (("--until", "2026-13"), ("--until", "Sept"), ("--tenancy", "zahid")):
            with self.subTest(args), self.assertRaises(CommandError):
                self.run_command(*args)
