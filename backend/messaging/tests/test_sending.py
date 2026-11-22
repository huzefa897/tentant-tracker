"""Sending by hand (messaging/sending.py, POST .../tenancies/{id}/messages/), through its first
kind, a bill's reminder; and whether the app offers it."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from unittest import mock

from django.db import connection
from django.test import SimpleTestCase, TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from billing.models import RentalPeriod, RentEntry
from billing.tests.factories import make_property, make_tenancy, make_user
from billing.tests.test_payments_api import make_entry, make_payment
from messaging import composer
from messaging.clock import FixedClock
from messaging.kinds import BILL_REMINDER
from messaging.sending import CannotSend, Draft, send_now
from messaging.models import (
    Message,
    MessageStatus,
    MessageType,
    PropertyMessagingSettings,
    RentDueReminderItem,
    ReminderStage,
)
from messaging.senders import DisabledSender, FakeSender, SendOutcome, SendResult, registry
from messaging.senders.providers import MESSAGING_OFF
from messaging.tests.test_runner import ZAHID
from properties.models import PropertyMembership, Tenancy

SEPTEMBER = date(2026, 9, 1)


def morning(day: date) -> FixedClock:
    return FixedClock(datetime(day.year, day.month, day.day, 6, tzinfo=UTC))


class BillReminderTestCase(TestCase):
    def setUp(self):
        self.user = make_user()
        self.property = make_property(member=self.user)
        self.settings = PropertyMessagingSettings.objects.create(
            property=self.property, enabled=True, reminders_start=date(2026, 11, 1)
        )
        self.tenancy = make_tenancy(self.property, name="Meera Iyer", start_date=date(2026, 8, 1))
        self.entry = make_entry(self.tenancy, self.user, month=SEPTEMBER)  # Rs. 15,750
        self.period = RentalPeriod.objects.get(tenancy=self.tenancy, period_month=SEPTEMBER)
        self.sender = FakeSender(provider="textbee")
        self.today = self.period.due_date + timedelta(days=3)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        for patch in (
            mock.patch.object(registry, "sender_for", side_effect=lambda name: self.sender),
            mock.patch("messaging.views.SystemClock", side_effect=lambda: morning(self.today)),
        ):
            patch.start()
            self.addCleanup(patch.stop)

    def url(self):
        return f"/api/v1/properties/{self.property.pk}/tenancies/{self.tenancy.pk}/messages/"

    def send(self, entry=None, **body):
        payload = {"kind": "bill_reminder", "entryId": str((entry or self.entry).pk), **body}
        return self.client.post(self.url(), payload, format="json")


class SendTests(BillReminderTestCase):
    def test_texts_the_tenant_what_is_outstanding(self):
        response = self.send()

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["status"], "sent")
        ((to, body),) = self.sender.sent
        self.assertEqual(to, ZAHID)
        self.assertIn("Hi Meera Iyer, your September 2026 rent (Rs. 15,750 outstanding)", body)
        self.assertIn("is overdue", body)
        message = Message.objects.get()
        self.assertEqual((message.status, message.sent_by, message.run), ("sent", self.user, None))
        item = RentDueReminderItem.objects.get()
        self.assertEqual((item.rental_period, item.stage), (self.period, ReminderStage.MANUAL))

    def test_part_paid_says_what_is_left(self):
        make_payment(self.entry, self.user, Decimal("5750.00"))

        self.send()

        self.assertIn("Rs. 10,000 outstanding", self.sender.sent[0][1])

    def test_once_a_day_then_again_the_next_day(self):
        self.send()
        again = self.send()

        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()["code"], "already_sent_today")

        self.today += timedelta(days=1)
        self.assertEqual(self.send().status_code, 201)
        self.assertEqual(len(self.sender.sent), 2)

    def test_a_failed_one_can_be_sent_again(self):
        self.sender.outcomes[ZAHID] = SendResult(SendOutcome.FAILED, reason="Refused")
        first = self.send()
        self.assertEqual((first.json()["status"], first.json()["reason"]), ("failed", "Refused"))

        self.sender.outcomes.clear()
        second = self.send()

        self.assertEqual(second.json()["status"], "sent")

    def test_an_unknown_one_is_not_sent_again_the_same_day(self):
        self.sender.outcomes[ZAHID] = SendResult(SendOutcome.UNKNOWN, reason="No answer")
        self.send()

        self.assertEqual(self.send().json()["code"], "already_sent_today")

    def test_does_not_use_up_the_automatic_reminders(self):
        self.send()

        RentDueReminderItem.objects.create(
            message=Message.objects.get(), rental_period=self.period, stage=ReminderStage.DUE
        )  # the run's Due for the same month is still allowed


class RefusedTests(BillReminderTestCase):
    def assertRefused(self, response, code):
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], code)
        self.assertEqual(getattr(self.sender, "sent", []), [])
        self.assertFalse(Message.objects.exists())

    def test_messaging_off(self):
        self.settings.enabled = False
        self.settings.save()

        self.assertRefused(self.send(), "messaging_off")

    def test_provider_not_set_up(self):
        self.sender = DisabledSender("textbee", "TextBee isn't set up.")

        self.assertRefused(self.send(), "provider_not_set_up")

    def test_off_on_the_server_says_so(self):  # not "isn't set up": its credentials may be set
        self.sender = DisabledSender("textbee", MESSAGING_OFF)

        self.assertRefused(self.send(), "server_off")

    def test_a_refusal_is_a_new_exception_each_time(self):  # a raise writes its traceback
        self.settings.enabled = False
        self.settings.save()
        errors = []
        for _ in range(2):
            try:
                send_now(self.tenancy, BILL_REMINDER, self.entry, self.user, morning(self.today))
            except CannotSend as error:
                errors.append(error)

        self.assertIsNot(*errors)
        self.assertEqual([e.code for e in errors], ["messaging_off", "messaging_off"])

    def test_waits_for_a_payment_being_recorded_on_the_bill(self):  # billing's lock order
        with CaptureQueriesContext(connection) as queries:
            self.send()

        locks = [q["sql"] for q in queries if q["sql"].rstrip().endswith("UPDATE")]
        self.assertIn("billing_rententry", locks[0])
        self.assertIn("billing_rentalperiod", locks[1])

    def test_paid(self):
        make_payment(self.entry, self.user, Decimal("15750.00"))

        self.assertRefused(self.send(), "entry_paid")

    def test_void(self):
        RentEntry.objects.filter(pk=self.entry.pk).update(
            status="void", voided_at=datetime.now(UTC), voided_by=self.user, void_reason="Wrong"
        )

        self.assertRefused(self.send(), "entry_void")

    def test_a_number_that_cannot_be_texted(self):
        Tenancy.objects.filter(pk=self.tenancy.pk).update(mobile_number="+91123")

        self.assertRefused(self.send(), "number_untextable")


class RequestTests(BillReminderTestCase):
    def test_an_unknown_kind_is_refused(self):
        for kind in ("payment_receipt", "", None, 3):
            response = self.send(kind=kind)
            self.assertEqual(response.status_code, 400, kind)
            self.assertIn("kind", response.json())
        self.assertEqual(self.sender.sent, [])

    def test_a_bill_reminder_needs_a_bill(self):
        for entry_id in (None, "", "not-a-uuid"):
            response = self.client.post(
                self.url(), {"kind": "bill_reminder", "entryId": entry_id}, format="json"
            )
            self.assertEqual(response.status_code, 400, entry_id)
            self.assertIn("entryId", response.json())

    def test_a_body_that_is_not_an_object_is_refused(self):
        response = self.client.post(self.url(), ["bill_reminder"], format="json")

        self.assertEqual(response.status_code, 400)


class AccessTests(BillReminderTestCase):
    def test_owners_and_managers_only(self):
        PropertyMembership.objects.filter(user=self.user).update(role="viewer")

        response = self.send()

        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.sender.sent, [])

    def test_another_propertys_bill_is_not_found(self):
        other = make_property(name="Other")
        other_tenancy = make_tenancy(other, start_date=date(2026, 8, 1))
        other_entry = make_entry(other_tenancy, self.user, month=SEPTEMBER)

        response = self.client.post(
            f"/api/v1/properties/{other.pk}/tenancies/{other_tenancy.pk}/messages/",
            {"kind": "bill_reminder", "entryId": str(other_entry.pk)},
            format="json",
        )

        self.assertEqual(response.status_code, 404)

    def test_another_tenancys_bill_is_not_found(self):  # the entry is looked up in the URL's
        other_tenancy = make_tenancy(
            self.property, name="Other", flat_number="305", start_date=date(2026, 8, 1)
        )
        other_entry = make_entry(other_tenancy, self.user, month=SEPTEMBER)

        self.assertEqual(self.send(other_entry).status_code, 404)
        self.assertEqual(self.sender.sent, [])

    def test_signed_out(self):
        self.client.force_authenticate(None)

        self.assertIn(self.send().status_code, (401, 403))
        self.assertEqual(self.sender.sent, [])


class StatusTests(BillReminderTestCase):
    def status(self):
        return self.client.get(f"/api/v1/properties/{self.property.pk}/messaging/").json()

    def test_on_and_set_up(self):
        self.assertEqual(self.status(), {"enabled": True, "ready": True, "canSend": True})

    def test_off(self):
        self.settings.delete()

        self.assertEqual(self.status(), {"enabled": False, "ready": False, "canSend": True})

    def test_not_set_up_on_this_server(self):
        self.sender = DisabledSender("textbee", "TextBee isn't set up.")

        self.assertEqual(self.status()["ready"], False)

    def test_never_shows_credentials_or_settings(self):
        self.assertEqual(set(self.status()), {"enabled", "ready", "canSend"})


class AnyKindTests(BillReminderTestCase):
    """send_now knows nothing of bills: any kind's text goes the same way."""

    class Hello:
        name = "hello"

        def __init__(self):
            self.recorded = []

        def parse(self, tenancy, data):
            return None

        def prepare(self, tenancy, subject, today):
            return Draft(MessageType.PAYMENT_MESSAGE, f"Hi {tenancy.name}", self.recorded.append)

    def test_sends_and_records_any_kinds_message(self):
        kind = self.Hello()

        sent = send_now(self.tenancy, kind, None, self.user, morning(self.today))

        self.assertEqual(sent.result.outcome, SendOutcome.SENT)
        self.assertEqual(self.sender.sent, [(self.tenancy.mobile_number, "Hi Meera Iyer")])
        self.assertEqual(sent.message.type, MessageType.PAYMENT_MESSAGE)
        self.assertEqual(sent.message.sent_by, self.user)
        self.assertEqual(kind.recorded, [sent.message])

    def test_the_shared_checks_hold_for_any_kind(self):
        Tenancy.objects.filter(pk=self.tenancy.pk).update(mobile_number="+91123")
        self.tenancy.refresh_from_db()

        with self.assertRaises(CannotSend) as raised:
            send_now(self.tenancy, self.Hello(), None, self.user, morning(self.today))

        self.assertEqual(raised.exception.code, "number_untextable")
        self.assertFalse(Message.objects.exists())


class BillReminderTextTests(SimpleTestCase):
    def text(self, today, due=date(2026, 9, 3), outstanding=Decimal("10854.00")):
        return composer.bill_reminder("Meera  Iyer", SEPTEMBER, due, outstanding, today)

    def test_before_on_and_after_the_due_date(self):
        self.assertEqual(
            self.text(date(2026, 9, 1)),
            "Hi Meera Iyer, a reminder that your September 2026 rent (Rs. 10,854 outstanding) "
            "is due on 3 September. Thank you.",
        )
        self.assertIn("is due today", self.text(date(2026, 9, 3)))
        self.assertIn("is overdue", self.text(date(2026, 9, 4)))
        self.assertIn("is unpaid", self.text(date(2026, 9, 4), due=None))

    def test_plain_ascii(self):
        self.assertTrue(self.text(date(2026, 9, 4)).isascii())

    def test_rupees_in_indian_grouping(self):
        for amount, text in [
            ("0.00", "Rs. 0"),
            ("999.00", "Rs. 999"),
            ("10854.00", "Rs. 10,854"),
            ("1234567.00", "Rs. 12,34,567"),
            ("123456789.50", "Rs. 12,34,56,789.50"),
        ]:
            with self.subTest(amount=amount):
                self.assertEqual(composer.rupees(Decimal(amount)), text)


class OldReminderRouteTests(BillReminderTestCase):
    """POST .../entries/{id}/reminder/, kept for app builds still open in people's tabs."""

    def old_url(self, entry=None):
        return (
            f"/api/v1/properties/{self.property.pk}/tenancies/{self.tenancy.pk}"
            f"/entries/{(entry or self.entry).pk}/reminder/"
        )

    def test_sends_the_bills_reminder_as_the_new_route_does(self):
        response = self.client.post(self.old_url())

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["status"], "sent")
        self.assertEqual(len(self.sender.sent), 1)
        self.assertEqual(RentDueReminderItem.objects.get().stage, ReminderStage.MANUAL)

    def test_shares_the_one_a_day_guard_with_the_new_route(self):
        self.assertEqual(self.send().status_code, 201)

        response = self.client.post(self.old_url())

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "already_sent_today")
        self.assertEqual(len(self.sender.sent), 1)

    def test_same_access(self):
        other_tenancy = make_tenancy(
            self.property, name="Other", flat_number="306", start_date=date(2026, 8, 1)
        )
        other_entry = make_entry(other_tenancy, self.user, month=SEPTEMBER)
        self.assertEqual(self.client.post(self.old_url(other_entry)).status_code, 404)

        PropertyMembership.objects.filter(user=self.user).update(role="viewer")
        self.assertEqual(self.client.post(self.old_url()).status_code, 403)
        self.assertEqual(self.sender.sent, [])

