"""A reminder about every month a tenancy owes, sent by hand from the tenant page, and its
preview (messaging/kinds/dues_reminder.py)."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from django.test import SimpleTestCase

from billing.models import RentalPeriod
from billing.periods import ensure_periods
from billing.tests.test_payments_api import make_entry, make_payment
from messaging import composer
from messaging.models import Message, RentDueReminderItem, ReminderStage
from messaging.senders import SendOutcome, SendResult
from messaging.tests.test_sending import SEPTEMBER, BillReminderTestCase
from properties.models import PropertyMembership

AUGUST = date(2026, 8, 1)


class DuesReminderTestCase(BillReminderTestCase):
    """August has no bill; September's bill (Rs. 15,750) is unpaid; today is after both."""

    def mark_august_not_owed(self):
        ensure_periods(self.tenancy, self.today)
        marked = RentalPeriod.objects.filter(tenancy=self.tenancy, period_month=AUGUST).update(
            not_owed_at=datetime.now(UTC), not_owed_by=self.user, not_owed_reason="Moved in late"
        )
        self.assertEqual(marked, 1)

    def dues(self):
        return self.client.post(self.url(), {"kind": "dues_reminder"}, format="json")

    def preview(self, **params):
        return self.client.get(f"{self.url()}preview/", {"kind": "dues_reminder", **params})


class SendDuesTests(DuesReminderTestCase):
    def test_texts_every_month_owed_with_what_is_outstanding(self):
        response = self.dues()

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["status"], "sent")
        ((to, body),) = self.sender.sent
        self.assertEqual(to, self.tenancy.mobile_number)
        self.assertIn("August 2026 (no bill yet) and September 2026 (Rs. 15,750)", body)
        message = Message.objects.get()
        self.assertEqual(message.sent_by, self.user)
        self.assertEqual(
            sorted(
                RentDueReminderItem.objects.filter(message=message).values_list(
                    "rental_period__period_month", "stage"
                )
            ),
            [(AUGUST, ReminderStage.MANUAL), (SEPTEMBER, ReminderStage.MANUAL)],
        )

    def test_leaves_out_a_month_paid_off(self):
        make_payment(self.entry, self.user, Decimal("15750.00"))

        self.dues()

        ((_, body),) = self.sender.sent
        self.assertIn("August 2026 (no bill yet) rent is unpaid", body)
        self.assertNotIn("September", body)

    def test_once_a_day_for_the_same_months(self):
        self.assertEqual(self.dues().status_code, 201)

        again = self.dues()

        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()["code"], "already_sent_today")
        self.assertEqual(len(self.sender.sent), 1)

    def test_a_failed_one_can_be_sent_again(self):
        number = self.tenancy.mobile_number
        self.sender.outcomes[number] = SendResult(SendOutcome.FAILED, reason="Refused.")
        self.assertEqual(self.dues().json()["status"], "failed")
        del self.sender.outcomes[number]

        self.assertEqual(self.dues().status_code, 201)
        self.assertEqual(len(self.sender.sent), 2)

    def test_a_bills_reminder_today_does_not_stop_the_other_months(self):
        self.send()  # September's, from its bill

        self.assertEqual(self.dues().status_code, 201)
        self.assertEqual(len(self.sender.sent), 2)

    def test_nothing_owed(self):
        make_payment(self.entry, self.user, Decimal("15750.00"))
        self.mark_august_not_owed()

        response = self.dues()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "nothing_owed")
        self.assertEqual(self.sender.sent, [])

    def test_a_month_not_yet_due_is_left_out(self):
        self.today = self.period.due_date - timedelta(days=1)

        self.dues()

        ((_, body),) = self.sender.sent
        self.assertIn("August 2026", body)
        self.assertNotIn("September", body)


class PreviewTests(DuesReminderTestCase):
    def test_says_which_months_and_what_it_would_send(self):
        response = self.preview()

        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(
            data["months"],
            [
                {"month": "2026-08", "dueDate": data["months"][0]["dueDate"], "outstanding": None},
                {
                    "month": "2026-09",
                    "dueDate": self.period.due_date.isoformat(),
                    "outstanding": "15750.00",
                },
            ],
        )
        self.assertEqual(data["billedOutstanding"], "15750.00")
        self.assertIn("August 2026 (no bill yet)", data["body"])
        self.assertEqual(self.sender.sent, [])
        self.assertFalse(Message.objects.exists())

    def test_nothing_owed(self):
        make_payment(self.entry, self.user, Decimal("15750.00"))
        self.mark_august_not_owed()

        response = self.preview()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "nothing_owed")

    def test_a_kind_without_a_preview(self):
        response = self.preview(kind="bill_reminder", entryId=str(self.entry.pk))

        self.assertEqual(response.status_code, 400)

    def test_owners_and_managers_only(self):
        PropertyMembership.objects.filter(user=self.user).update(role="viewer")

        self.assertEqual(self.preview().status_code, 403)


class DuesReminderTextTests(SimpleTestCase):
    def test_one_month(self):
        self.assertEqual(
            composer.dues_reminder("Meera", [(SEPTEMBER, Decimal("4712.50"))]),
            "Hi Meera, your September 2026 (Rs. 4,712.50) rent is unpaid. Please arrange "
            "payment or contact us if you've already paid. Thank you.",
        )

    def test_several_months_with_the_total_billed(self):
        body = composer.dues_reminder(
            "Meera",
            [
                (AUGUST, Decimal("1000.00")),
                (SEPTEMBER, Decimal("4712.50")),
                (date(2026, 10, 1), None),
            ],
        )

        self.assertIn(
            "rent for August 2026 (Rs. 1,000), September 2026 (Rs. 4,712.50) and "
            "October 2026 (no bill yet) is unpaid. Total outstanding: Rs. 5,712.50.",
            body,
        )
        self.assertTrue(body.isascii())

    def test_needs_a_month(self):
        with self.assertRaises(ValueError):
            composer.dues_reminder("Meera", [])
