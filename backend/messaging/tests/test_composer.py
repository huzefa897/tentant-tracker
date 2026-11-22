import uuid
from datetime import date

from django.test import SimpleTestCase

from messaging.composer import rent_due_reminder
from messaging.models import ReminderStage
from messaging.policy import DueReminder


def reminder(month, stage):
    return DueReminder(uuid.uuid4(), month, month, stage)


OCTOBER = date(2026, 10, 1)
NOVEMBER = date(2026, 11, 1)
DECEMBER = date(2026, 12, 1)


class RentDueReminderTextTests(SimpleTestCase):
    def test_due(self):
        self.assertEqual(
            rent_due_reminder("Ali", [reminder(NOVEMBER, ReminderStage.DUE)]),
            "Hi Ali, your rent for November 2026 is now due. Please arrange payment at your "
            "earliest convenience. Thank you.",
        )

    def test_follow_up(self):
        self.assertEqual(
            rent_due_reminder("Ali", [reminder(NOVEMBER, ReminderStage.FOLLOW_UP)]),
            "Hi Ali, this is a reminder that your November 2026 rent remains unpaid. Please "
            "arrange payment or contact us if you've already paid. Thank you.",
        )

    def test_several_months_in_one_message(self):
        self.assertEqual(
            rent_due_reminder(
                "Ali",
                [reminder(OCTOBER, ReminderStage.FOLLOW_UP), reminder(NOVEMBER, ReminderStage.DUE)],
            ),
            "Hi Ali, your rent for October 2026 (overdue) and November 2026 (due) is unpaid. "
            "Please arrange payment or contact us if you've already paid. Thank you.",
        )

    def test_three_months(self):
        text = rent_due_reminder(
            "Ali",
            [
                reminder(OCTOBER, ReminderStage.FOLLOW_UP),
                reminder(NOVEMBER, ReminderStage.FOLLOW_UP),
                reminder(DECEMBER, ReminderStage.DUE),
            ],
        )

        self.assertIn(
            "October 2026 (overdue), November 2026 (overdue) and December 2026 (due)", text
        )

    def test_name_spacing_is_tidied(self):
        self.assertTrue(
            rent_due_reminder(" Shaik  Zahid Ali ", [reminder(NOVEMBER, ReminderStage.DUE)])
            .startswith("Hi Shaik Zahid Ali, ")
        )

    def test_a_blank_name_is_left_out(self):
        self.assertTrue(
            rent_due_reminder("   ", [reminder(NOVEMBER, ReminderStage.DUE)]).startswith(
                "Hi, your rent for November 2026"
            )
        )

    def test_a_name_is_made_plain_ascii(self):
        for name, greeting in (
            ("D\u2019Souza", "Hi D'Souza, "),
            ("Jos\u00e9 Fern\u00e1ndez", "Hi Jose Fernandez, "),
            ("\u0c38\u0c32\u0c40\u0c02", "Hi, "),  # nothing left in ASCII
        ):
            with self.subTest(name=name):
                text = rent_due_reminder(name, [reminder(NOVEMBER, ReminderStage.DUE)])
                self.assertTrue(text.startswith(greeting))
                self.assertTrue(text.isascii())

    def test_plain_ascii_so_each_sms_part_holds_160_characters(self):
        text = rent_due_reminder(
            "Ali", [reminder(OCTOBER, ReminderStage.FOLLOW_UP), reminder(NOVEMBER, ReminderStage.DUE)]
        )

        self.assertTrue(text.isascii())

    def test_needs_a_month(self):
        with self.assertRaises(ValueError):
            rent_due_reminder("Ali", [])
