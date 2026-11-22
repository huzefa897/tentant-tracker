from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from messaging.models import (
    Message,
    MessagingRun,
    PropertyMessagingSettings,
    ReminderStage,
    RentDueReminderItem,
)
from messaging.runner import MessageRunner
from messaging.senders import FakeSender
from messaging.tests.test_runner import ZAHID, RunnerTestCase, at, nov


@override_settings(MESSAGING_PROVIDER="")
class SendMessagesCommandTests(RunnerTestCase):
    def call(self, *args):
        out, err = StringIO(), StringIO()
        with mock.patch("messaging.management.commands.send_messages.SystemClock") as clock:
            clock.return_value = at(nov(11))
            call_command("send_messages", *args, stdout=out, stderr=err)
        return out.getvalue(), err.getvalue()

    def test_no_provider_lists_what_it_would_send(self):
        out, _ = self.call()

        self.assertIn("Nothing sent (no provider configured). Would send 1:", out)
        self.assertIn(f"Flat 202 ({self.zahid.pk}): October 2026 (Due)", out)
        self.assertFalse(Message.objects.exists())
        self.assertTrue(MessagingRun.objects.get().dry_run)

    def test_dry_run(self):
        out, _ = self.call("--dry-run")

        self.assertIn("Nothing sent (dry run).", out)

    def test_never_prints_names_or_numbers(self):
        out, err = self.call()

        for private in ("Shaik", "Zahid", ZAHID, ZAHID[-10:]):
            self.assertNotIn(private, out + err)


class HistoryAdminTests(RunnerTestCase):
    def setUp(self):
        super().setUp()
        admin = get_user_model().objects.create_superuser(username="admin", password="x")
        self.client.force_login(admin)
        MessageRunner(FakeSender(), at(nov(11))).run()
        self.message = Message.objects.get()

    def test_messages_list_shows_only_the_last_four_digits(self):
        response = self.client.get(reverse("admin:messaging_message_changelist"))

        self.assertContains(response, "…0101")
        self.assertNotContains(response, ZAHID)
        self.assertContains(response, "Shaik Zahid Ali (202)")
        self.assertContains(response, "Oct 2026 (Due)")
        self.assertContains(response, "Sent")

    def test_a_message_shows_its_number_text_and_months(self):
        response = self.client.get(
            reverse("admin:messaging_message_change", args=[self.message.pk])
        )

        self.assertContains(response, ZAHID)
        self.assertContains(response, "your rent for October 2026 is now due")
        self.assertContains(response, "October 2026")

    def test_a_message_page_reads_its_months_in_one_query(self):
        url = reverse("admin:messaging_message_change", args=[self.message.pk])
        with CaptureQueriesContext(connection) as one_month:
            self.client.get(url)
        RentDueReminderItem.objects.create(
            message=self.message,
            rental_period=self.message.reminder_items.get().rental_period,
            stage=ReminderStage.FOLLOW_UP,
        )

        with CaptureQueriesContext(connection) as two_months:
            self.client.get(url)

        self.assertEqual(len(two_months), len(one_month))

    def test_history_is_read_only(self):
        for name in ("message", "messagingrun"):
            with self.subTest(name=name):
                self.assertEqual(
                    self.client.get(reverse(f"admin:messaging_{name}_add")).status_code, 403
                )
        response = self.client.post(
            reverse("admin:messaging_message_delete", args=[self.message.pk]), {"post": "yes"}
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(Message.objects.exists())

    def test_runs_list(self):
        response = self.client.get(reverse("admin:messaging_messagingrun_changelist"))

        self.assertContains(response, "Command")
        self.assertEqual(response.context["cl"].result_count, 1)

    def test_settings_list_still_works(self):
        self.assertTrue(PropertyMessagingSettings.objects.exists())
        response = self.client.get(
            reverse("admin:messaging_propertymessagingsettings_changelist")
        )
        self.assertEqual(response.status_code, 200)
