import uuid
from datetime import date

from django.test import SimpleTestCase

from messaging.models import ReminderStage
from messaging.policy import OwedMonth, reminders_due, stage_on

OCTOBER = OwedMonth(uuid.uuid4(), date(2026, 10, 1), date(2026, 11, 11))
NOVEMBER = OwedMonth(uuid.uuid4(), date(2026, 11, 1), date(2026, 12, 11))
START = date(2026, 11, 1)


def stages(owed, today, already=frozenset(), start=START):
    return [
        (r.period_month, r.stage) for r in reminders_due(owed, today, start, set(already))
    ]


class StageTests(SimpleTestCase):
    def test_nothing_before_the_due_date(self):
        self.assertIsNone(stage_on(date(2026, 11, 11), date(2026, 11, 10)))

    def test_due_from_the_due_date_for_six_days(self):
        for day in range(11, 18):
            with self.subTest(day=day):
                self.assertEqual(
                    stage_on(date(2026, 11, 11), date(2026, 11, day)), ReminderStage.DUE
                )

    def test_follow_up_from_seven_days_after(self):
        for today in (date(2026, 11, 18), date(2026, 12, 25)):
            with self.subTest(today=today):
                self.assertEqual(stage_on(date(2026, 11, 11), today), ReminderStage.FOLLOW_UP)


class RemindersDueTests(SimpleTestCase):
    def test_due_on_the_due_date(self):  # TC-01
        self.assertEqual(
            stages([OCTOBER], date(2026, 11, 11)), [(date(2026, 10, 1), ReminderStage.DUE)]
        )

    def test_not_yet_due(self):
        self.assertEqual(stages([OCTOBER], date(2026, 11, 10)), [])

    def test_due_once(self):  # TC-09
        self.assertEqual(stages([OCTOBER], date(2026, 11, 12), {(OCTOBER.period_id, "due")}), [])

    def test_follow_up_after_a_week(self):  # TC-05
        self.assertEqual(
            stages([OCTOBER], date(2026, 11, 18), {(OCTOBER.period_id, "due")}),
            [(date(2026, 10, 1), ReminderStage.FOLLOW_UP)],
        )

    def test_follow_up_without_the_due_one(self):  # TC-13, TC-17
        # The Due message failed, was skipped or a whole week of runs was missed: only the
        # Follow-up, never both stages of one month at once.
        self.assertEqual(
            stages([OCTOBER], date(2026, 11, 20)), [(date(2026, 10, 1), ReminderStage.FOLLOW_UP)]
        )

    def test_follow_up_once(self):
        self.assertEqual(
            stages([OCTOBER], date(2026, 12, 1), {(OCTOBER.period_id, "follow_up")}), []
        )

    def test_late_runs_catch_up_within_the_week(self):  # TC-17
        self.assertEqual(
            stages([OCTOBER], date(2026, 11, 17)), [(date(2026, 10, 1), ReminderStage.DUE)]
        )

    def test_months_due_before_reminders_start_are_left_alone(self):
        self.assertEqual(stages([OCTOBER], date(2026, 11, 20), start=date(2026, 11, 12)), [])
        self.assertEqual(
            stages([OCTOBER], date(2026, 11, 20), start=date(2026, 11, 11)),
            [(date(2026, 10, 1), ReminderStage.FOLLOW_UP)],
        )

    def test_several_months_oldest_first(self):
        self.assertEqual(
            stages([NOVEMBER, OCTOBER], date(2026, 12, 11)),
            [(date(2026, 10, 1), ReminderStage.FOLLOW_UP), (date(2026, 11, 1), ReminderStage.DUE)],
        )
