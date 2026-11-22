"""The runner against real rental periods, bills and payments: the spec's cases (TC-xx) and ours.

The property is postpaid with due day 11, so October's rent is due on 11 November 2026. Runs are
at 06:00 UTC, 11:30 in India, the default send time, unless a test says otherwise.
"""

from datetime import UTC, date, datetime, timedelta
from unittest import mock

from django.db.models import F
from django.test import TestCase
from django.utils import timezone

from billing.models import Payment, PaymentReversal, RentalPeriod, RentEntry
from billing.tests.factories import make_property, make_tenancy, make_user
from billing.tests.test_payments_api import make_entry, make_payment
from messaging.clock import FixedClock
from messaging.models import (
    Message,
    MessageStatus,
    MessagingRun,
    PropertyMessagingSettings,
    RentDueReminderItem,
)
from messaging.runner import UNTEXTABLE_REASON, MessageRunner
from messaging.senders import DisabledSender, FakeSender, SendOutcome, SendResult
from properties.models import Tenancy

OCTOBER = date(2026, 10, 1)
NOVEMBER = date(2026, 11, 1)
ZAHID = "+919000000101"
YUSUF = "+919000000102"


def at(day: date, hour=6, minute=0) -> FixedClock:
    return FixedClock(datetime(day.year, day.month, day.day, hour, minute, tzinfo=UTC))


def nov(day: int) -> date:
    return date(2026, 11, day)


class RunnerTestCase(TestCase):
    def setUp(self):
        self.user = make_user()
        self.prop = make_property()
        self.settings = PropertyMessagingSettings.objects.create(
            property=self.prop, enabled=True, reminders_start=NOVEMBER
        )
        self.zahid = make_tenancy(self.prop, name="Shaik Zahid Ali", start_date=date(2026, 9, 1))
        self.sender = FakeSender()

    def run_on(self, day, sender=None, clock=None, **options):
        return MessageRunner(sender or self.sender, clock or at(day), **options).run()

    def bill(self, tenancy, month, *paid):
        entry = make_entry(tenancy, self.user, month=month)  # ₹15,750
        for amount in paid:
            make_payment(entry, self.user, amount)
        return entry

    def messages(self, tenancy=None):
        messages = Message.objects.all()
        return messages.filter(tenancy=tenancy) if tenancy else messages

    def items(self):
        return list(
            RentDueReminderItem.objects.order_by("created_at").values_list(
                "rental_period__period_month", "stage"
            )
        )


class DueTests(RunnerTestCase):
    def test_due_today_and_unpaid_is_sent(self):  # TC-01, TC-03 (no bill)
        result = self.run_on(nov(11))

        message = self.messages().get()
        self.assertEqual(message.status, MessageStatus.SENT)
        self.assertEqual(message.recipient, ZAHID)
        self.assertEqual(message.provider, "fake")
        self.assertEqual(message.provider_message_id, "fake-1")
        self.assertEqual(message.local_date, nov(11))
        self.assertIsNotNone(message.attempted_at)
        self.assertIn("your rent for October 2026 is now due", message.body)
        self.assertEqual(self.sender.sent, [(ZAHID, message.body)])
        self.assertEqual(self.items(), [(OCTOBER, "due")])
        run = result.run
        self.assertEqual((run.properties_checked, run.planned, run.sent), (1, 1, 1))
        self.assertIsNotNone(run.finished_at)
        self.assertEqual(run.errors, "")

    def test_fully_paid_before_the_due_date_sends_nothing(self):  # TC-02
        self.bill(self.zahid, OCTOBER, "15750.00")

        self.run_on(nov(11))

        self.assertFalse(self.messages().exists())

    def test_part_paid_on_the_due_date_is_sent(self):  # TC-04
        self.bill(self.zahid, OCTOBER, "5000.00")

        self.run_on(nov(11))

        self.assertEqual(self.items(), [(OCTOBER, "due")])

    def test_a_reversed_payment_counts_for_nothing(self):
        entry = self.bill(self.zahid, OCTOBER, "15750.00")
        PaymentReversal.objects.create(
            payment=entry.payments.get(), reason="Wrong bill", created_by=self.user
        )

        self.run_on(nov(11))

        self.assertEqual(self.items(), [(OCTOBER, "due")])

    def test_a_void_bill_leaves_the_month_owed(self):
        entry = self.bill(self.zahid, OCTOBER, "15750.00")
        entry.payments.all().delete()
        RentEntry.objects.filter(pk=entry.pk).update(
            status="void", voided_at=timezone.now(), voided_by=self.user, void_reason="Twice"
        )

        self.run_on(nov(11))

        self.assertEqual(self.items(), [(OCTOBER, "due")])

    def test_a_month_marked_not_owed_sends_nothing(self):
        self.run_on(nov(5))  # creates the period: periods are created up to a week ahead
        RentalPeriod.objects.filter(tenancy=self.zahid, period_month=OCTOBER).update(
            not_owed_at=timezone.now(), not_owed_by=self.user, not_owed_reason="Waived"
        )

        self.run_on(nov(11))

        self.assertFalse(self.messages().exists())

    def test_nothing_before_the_due_date(self):
        self.run_on(nov(10))

        self.assertFalse(self.messages().exists())

    def test_months_due_before_reminders_start_are_left_alone(self):
        # September (due 11 October) is owed too, but fell due before reminders start.
        self.run_on(nov(11))

        self.assertEqual(self.items(), [(OCTOBER, "due")])

    def test_twice_on_the_same_day_sends_once(self):  # TC-09
        self.run_on(nov(11))
        second = self.run_on(nov(11), clock=at(nov(11), hour=7))

        self.assertEqual(self.messages().count(), 1)
        self.assertEqual(len(self.sender.sent), 1)
        self.assertEqual((second.run.planned, second.run.sent), (0, 0))

    def test_two_tenants_due_the_same_day_are_both_sent(self):  # TC-14
        yusuf = make_tenancy(
            self.prop,
            name="Mohammed Yusuf",
            flat_number="301",
            mobile_number=YUSUF,
            start_date=date(2026, 9, 1),
        )

        self.run_on(nov(11))

        self.assertEqual(self.messages(self.zahid).count(), 1)
        self.assertEqual(self.messages(yusuf).count(), 1)

    def test_ended_tenancy_is_left_out(self):  # TC-15
        Tenancy.objects.filter(pk=self.zahid.pk).update(end_date=date(2026, 10, 31))

        self.run_on(nov(11))

        self.assertFalse(self.messages().exists())

    def test_future_tenancy_is_left_out(self):
        Tenancy.objects.filter(pk=self.zahid.pk).update(start_date=date(2026, 12, 1))

        self.run_on(nov(11))

        self.assertFalse(self.messages().exists())


class FollowUpTests(RunnerTestCase):
    def test_still_unpaid_a_week_later(self):  # TC-05
        self.run_on(nov(11))
        self.run_on(nov(18))

        follow_up = self.messages().get(reminder_items__stage="follow_up")
        self.assertIn("your October 2026 rent remains unpaid", follow_up.body)
        self.assertEqual(self.items(), [(OCTOBER, "due"), (OCTOBER, "follow_up")])

    def test_days_in_between_send_nothing_more(self):
        self.run_on(nov(11))
        for day in range(12, 18):
            self.run_on(nov(day))

        self.assertEqual(self.messages().count(), 1)

    def test_paid_three_days_after_sends_no_follow_up(self):  # TC-06
        self.run_on(nov(11))
        self.bill(self.zahid, OCTOBER, "15750.00")

        self.run_on(nov(18))

        self.assertEqual(self.items(), [(OCTOBER, "due")])

    def test_paid_on_day_seven_before_the_run_sends_no_follow_up(self):  # TC-07
        self.run_on(nov(11))
        self.bill(self.zahid, OCTOBER, "15750.00")

        self.run_on(nov(18), clock=at(nov(18), hour=7))

        self.assertEqual(self.messages().count(), 1)

    def test_still_part_paid_on_day_seven(self):  # TC-08
        self.run_on(nov(11))
        self.bill(self.zahid, OCTOBER, "10000.00")

        self.run_on(nov(18))

        self.assertEqual(self.items(), [(OCTOBER, "due"), (OCTOBER, "follow_up")])

    def test_sent_once(self):
        self.run_on(nov(18))
        self.run_on(nov(25))

        self.assertEqual(self.items(), [(OCTOBER, "follow_up")])

    def test_after_the_due_one_failed(self):  # TC-13
        failing = FakeSender(outcomes={ZAHID: SendResult(SendOutcome.FAILED, reason="Refused")})
        self.run_on(nov(11), sender=failing)

        self.run_on(nov(18))

        self.assertEqual(self.items(), [(OCTOBER, "due"), (OCTOBER, "follow_up")])
        self.assertEqual(self.messages().latest("created_at").status, MessageStatus.SENT)

    def test_a_missed_week_sends_only_the_follow_up(self):  # TC-17
        self.run_on(nov(20))

        message = self.messages().get()
        self.assertIn("remains unpaid", message.body)
        self.assertEqual(self.items(), [(OCTOBER, "follow_up")])

    def test_a_late_run_within_the_week_sends_the_due_one(self):  # TC-17
        self.run_on(nov(14))

        self.assertEqual(self.items(), [(OCTOBER, "due")])


class CombinedTests(RunnerTestCase):
    def test_several_months_in_one_message(self):
        self.settings.reminders_start = date(2026, 10, 1)
        self.settings.save()

        self.run_on(date(2026, 11, 11))  # September is overdue already, October due
        message = self.messages().get()

        self.assertIn(
            "your rent for September 2026 (overdue) and October 2026 (due) is unpaid",
            message.body,
        )
        self.assertEqual(
            sorted(self.items()), [(date(2026, 9, 1), "follow_up"), (OCTOBER, "due")]
        )
        self.assertEqual(len(self.sender.sent), 1)


class SendingTests(RunnerTestCase):
    def test_a_refusal_is_recorded_and_billing_is_untouched(self):  # TC-11
        entry = self.bill(self.zahid, OCTOBER, "5000.00")
        sender = FakeSender(outcomes={ZAHID: SendResult(SendOutcome.FAILED, reason="Refused")})

        result = self.run_on(nov(11), sender=sender)

        message = self.messages().get()
        self.assertEqual((message.status, message.reason), (MessageStatus.FAILED, "Refused"))
        self.assertEqual(result.run.failed, 1)
        self.assertEqual(Payment.objects.filter(entry=entry).count(), 1)
        self.assertEqual(RentEntry.objects.get(pk=entry.pk).status, "active")

    def test_a_refusal_is_tried_again_the_next_day(self):  # nothing went, so it's still due
        failing = FakeSender(outcomes={ZAHID: SendResult(SendOutcome.FAILED, reason="Offline")})
        self.run_on(nov(11), sender=failing)

        self.run_on(nov(12))

        failed, sent = self.messages().order_by("created_at")
        self.assertEqual((failed.status, sent.status), (MessageStatus.FAILED, MessageStatus.SENT))
        self.assertIn("is now due", sent.body)
        self.assertEqual(self.items(), [(OCTOBER, "due"), (OCTOBER, "due")])
        self.assertEqual(
            [(item.message_id, item.released_at is not None) for item in
             RentDueReminderItem.objects.order_by("created_at")],
            [(failed.pk, True), (sent.pk, False)],
        )

    def test_a_refusal_is_tried_once_a_day(self):  # not hourly, and only at the send time
        failing = FakeSender(outcomes={ZAHID: SendResult(SendOutcome.FAILED, reason="Bad key")})
        self.run_on(nov(11), sender=failing)

        result = self.run_on(nov(11), clock=at(nov(11), hour=8))

        self.assertEqual(self.sender.sent, [])
        self.assertEqual(result.run.planned, 0)
        self.assertEqual(self.messages().get().status, MessageStatus.FAILED)

    def test_a_refusal_after_the_due_week_leaves_only_the_follow_up(self):
        failing = FakeSender(outcomes={ZAHID: SendResult(SendOutcome.FAILED, reason="Offline")})
        self.run_on(nov(17), sender=failing)  # day 6, the Due one's last day

        self.run_on(nov(18))

        self.assertIn("remains unpaid", self.messages().latest("created_at").body)
        self.assertEqual(self.items(), [(OCTOBER, "due"), (OCTOBER, "follow_up")])

    def test_a_timeout_is_unknown_and_never_resent(self):  # TC-12
        sender = FakeSender(outcomes={ZAHID: SendResult(SendOutcome.UNKNOWN, reason="Timed out")})

        result = self.run_on(nov(11), sender=sender)
        self.run_on(nov(11), sender=sender, clock=at(nov(11), hour=8))
        self.run_on(nov(12), sender=sender)

        self.assertEqual(self.messages().get().status, MessageStatus.UNKNOWN)
        self.assertEqual(result.run.unknown, 1)
        self.assertEqual(len(sender.sent), 1)

    def test_a_sender_that_raises_is_unknown(self):
        sender = FakeSender(raises={ZAHID: ConnectionError("reset")})

        self.run_on(nov(11), sender=sender)

        message = self.messages().get()
        self.assertEqual(message.status, MessageStatus.UNKNOWN)
        self.assertEqual(message.reason, "The sender stopped unexpectedly.")

    def test_a_month_paid_after_planning_is_not_sent(self):
        with mock.patch("messaging.runner.still_owed", return_value=set()):
            self.run_on(nov(11))

        self.assertFalse(self.messages().exists())
        self.assertEqual(self.sender.sent, [])

    def test_a_reservation_beaten_by_another_run_sends_nothing(self):
        self.run_on(nov(11))
        # As if a second run planned before the first reserved: the constraint refuses it.
        with mock.patch("messaging.runner.reminded", return_value=set()):
            self.run_on(nov(11), clock=at(nov(11), hour=7))

        self.assertEqual(self.messages().count(), 1)
        self.assertEqual(len(self.sender.sent), 1)


class UntextableTests(RunnerTestCase):
    def setUp(self):
        super().setUp()
        Tenancy.objects.filter(pk=self.zahid.pk).update(mobile_number="+91123")

    def test_skipped_with_the_reason_once_a_day(self):  # TC-10
        first = self.run_on(nov(11))
        self.run_on(nov(11), clock=at(nov(11), hour=7))

        message = self.messages().get()
        self.assertEqual((message.status, message.reason), (MessageStatus.SKIPPED, UNTEXTABLE_REASON))
        self.assertEqual(first.run.skipped, 1)
        self.assertFalse(RentDueReminderItem.objects.exists())
        self.assertEqual(self.sender.sent, [])

    def test_sent_once_the_number_is_fixed(self):
        self.run_on(nov(11))
        Tenancy.objects.filter(pk=self.zahid.pk).update(mobile_number=ZAHID)

        self.run_on(nov(12))

        self.assertEqual(self.items(), [(OCTOBER, "due")])


class WhenAndWhereTests(RunnerTestCase):
    def test_nothing_before_the_send_time(self):
        result = self.run_on(nov(11), clock=at(nov(11), hour=5, minute=59))  # 11:29 IST

        self.assertFalse(self.messages().exists())
        self.assertEqual(result.run.properties_checked, 0)

    def test_send_time_is_in_the_propertys_own_zone(self):
        self.settings.time_zone = "Asia/Dubai"
        self.settings.save()

        self.run_on(nov(11))  # 10:00 in Dubai
        self.assertFalse(self.messages().exists())

        self.run_on(nov(11), clock=at(nov(11), hour=8))  # 12:00 in Dubai
        self.assertEqual(self.messages().count(), 1)

    def test_today_is_the_propertys_own_day(self):
        # 19:00 UTC on the 10th is already 00:30 on the 11th in India, but before 11:30.
        self.run_on(nov(10), clock=at(nov(10), hour=19))
        self.assertFalse(self.messages().exists())

    def test_messaging_off_sends_nothing(self):
        self.settings.enabled = False
        self.settings.save()

        self.run_on(nov(11))

        self.assertFalse(self.messages().exists())

    def test_a_property_without_settings_sends_nothing(self):
        self.settings.delete()

        self.run_on(nov(11))

        self.assertFalse(self.messages().exists())

    def test_an_inactive_property_sends_nothing(self):
        type(self.prop).objects.filter(pk=self.prop.pk).update(is_active=False)

        self.run_on(nov(11))

        self.assertFalse(self.messages().exists())


class FailureTests(RunnerTestCase):
    def test_an_unusable_time_zone_skips_only_that_property(self):
        other = make_property(name="Other")
        PropertyMessagingSettings.objects.create(
            property=other, enabled=True, reminders_start=NOVEMBER
        )
        make_tenancy(other, start_date=date(2026, 9, 1), mobile_number=YUSUF)
        PropertyMessagingSettings.objects.filter(pk=self.prop.pk).update(time_zone="Nowhere/Gone")

        result = self.run_on(nov(11))

        self.assertIn(f"Property {self.prop.pk}: ZoneInfoNotFoundError", result.run.errors)
        self.assertEqual(self.messages().get().recipient, YUSUF)

    def test_one_tenancy_failing_never_stops_the_others(self):
        make_tenancy(
            self.prop, name="Mohammed Yusuf", flat_number="301", mobile_number=YUSUF,
            start_date=date(2026, 9, 1),
        )
        real = __import__("messaging.runner", fromlist=["can_text"]).can_text

        def broken_for_zahid(number):
            if number == ZAHID:
                raise RuntimeError("boom")
            return real(number)

        with mock.patch("messaging.runner.can_text", side_effect=broken_for_zahid):
            result = self.run_on(nov(11))

        self.assertIn(f"Tenancy {self.zahid.pk}: RuntimeError", result.run.errors)
        self.assertEqual(self.messages().get().recipient, YUSUF)

    def test_failures_are_logged_without_their_message(self):
        error = RuntimeError(f"Failing row contains ({ZAHID}, your rent for October)")

        with mock.patch("messaging.runner.can_text", side_effect=error):
            with self.assertLogs("messaging.runner", level="ERROR") as logs:
                self.run_on(nov(11))

        logged = "\n".join(logs.output)
        self.assertIn(f"tenancy {self.zahid.pk} failed with RuntimeError", logged)
        self.assertNotIn(ZAHID, logged)
        self.assertNotIn("your rent", logged)


class NoProviderTests(RunnerTestCase):
    def test_no_provider_sends_and_reserves_nothing(self):  # TC-16
        result = self.run_on(nov(11), sender=DisabledSender())

        self.assertTrue(result.run.dry_run)
        self.assertEqual(result.run.planned, 1)
        self.assertEqual(len(result.planned), 1)
        self.assertFalse(self.messages().exists())
        self.assertFalse(RentDueReminderItem.objects.exists())

    def test_once_a_provider_is_set_the_months_are_still_due(self):
        self.run_on(nov(11), sender=DisabledSender())

        self.run_on(nov(11), clock=at(nov(11), hour=7))

        self.assertEqual(self.items(), [(OCTOBER, "due")])

    def test_dry_run_saves_nothing_but_the_run(self):
        Tenancy.objects.filter(pk=self.zahid.pk).update(mobile_number="+91123")
        make_tenancy(
            self.prop, name="Mohammed Yusuf", flat_number="301", mobile_number=YUSUF,
            start_date=date(2026, 9, 1),
        )

        result = self.run_on(nov(11), dry_run=True)

        self.assertEqual((result.run.planned, result.run.skipped), (1, 1))
        self.assertFalse(self.messages().exists())
        self.assertEqual(self.sender.sent, [])
        self.assertIn("now due", result.planned[0].body)


class RunRecordTests(RunnerTestCase):
    def test_a_quiet_day_still_records_the_run(self):
        result = self.run_on(nov(5))

        run = MessagingRun.objects.get()
        self.assertEqual(run, result.run)
        self.assertEqual((run.properties_checked, run.planned), (1, 0))
        self.assertEqual(run.provider, "fake")

    def test_messages_link_their_run(self):
        result = self.run_on(nov(11))

        self.assertEqual(self.messages().get().run, result.run)

    def test_old_runs_are_deleted_and_their_messages_kept(self):
        old = self.run_on(nov(11)).run
        MessagingRun.objects.filter(pk=old.pk).update(
            started_at=F("started_at") - timedelta(days=91)
        )

        self.run_on(nov(12))

        self.assertFalse(MessagingRun.objects.filter(pk=old.pk).exists())
        self.assertIsNone(self.messages().get().run)
