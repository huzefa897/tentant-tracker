"""A reminder sent by hand from a bill's page, and whether the app offers it."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from unittest import mock

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from billing.models import RentalPeriod, RentEntry
from billing.tests.factories import make_property, make_tenancy, make_user
from billing.tests.test_payments_api import make_entry, make_payment
from messaging import composer
from messaging.clock import FixedClock
from messaging.models import (
    Message,
    MessageStatus,
    PropertyMessagingSettings,
    RentDueReminderItem,
    ReminderStage,
)
from messaging.senders import DisabledSender, FakeSender, SendOutcome, SendResult, registry
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

    def url(self, entry=None):
        entry = entry or self.entry
        return (
            f"/api/v1/properties/{self.property.pk}/tenancies/{self.tenancy.pk}"
            f"/entries/{entry.pk}/reminder/"
        )

    def send(self, entry=None):
        return self.client.post(self.url(entry))


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
            f"/api/v1/properties/{other.pk}/tenancies/{other_tenancy.pk}"
            f"/entries/{other_entry.pk}/reminder/"
        )

        self.assertEqual(response.status_code, 404)

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
