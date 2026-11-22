"""Which Rent Due Reminders are due: a pure function of a tenancy's owed months and the day.

No database and no clock here: the runner reads the months still owed (billing's definition,
messaging/owed.py) and today at the property, and this decides. That keeps every rule below
testable on its own (docs/messaging.md).

- A month is reminded about only once it's due (its due date is today or earlier), and only if
  it fell due on or after the property's **reminders start**, so turning messaging on never
  texts about older arrears.
- **Due** from its due date until FOLLOW_UP_AFTER_DAYS - 1 days after it.
- **Follow-up** from FOLLOW_UP_AFTER_DAYS after its due date on, counted from the due date
  (never from when the Due message went out), and whether or not the Due one was sent.
- A month gets each stage once, ever (`already`). After a missed week only the Follow-up is
  due, never both stages of one month in one message.
"""

from dataclasses import dataclass
from datetime import date
from typing import Iterable
from uuid import UUID

from .models import ReminderStage

FOLLOW_UP_AFTER_DAYS = 7


@dataclass(frozen=True)
class OwedMonth:
    """A rental period still owed: no bill yet, or money left on it."""

    period_id: UUID
    period_month: date
    due_date: date


@dataclass(frozen=True)
class DueReminder:
    """One month at one stage, due to be included in a tenancy's message."""

    period_id: UUID
    period_month: date
    due_date: date
    stage: ReminderStage


def stage_on(due_date: date, today: date) -> ReminderStage | None:
    """The stage a month is at today, or None before it's due."""
    days = (today - due_date).days
    if days < 0:
        return None
    if days < FOLLOW_UP_AFTER_DAYS:
        return ReminderStage.DUE
    return ReminderStage.FOLLOW_UP


def reminders_due(
    owed: Iterable[OwedMonth],
    today: date,
    reminders_start: date,
    already: set[tuple[UUID, str]],
) -> list[DueReminder]:
    """The reminders due today for one tenancy's owed months, oldest month first. `already`
    holds the (period id, stage) pairs that have a reminder item, sent or not."""
    due = []
    for month in owed:
        if month.due_date < reminders_start:
            continue
        stage = stage_on(month.due_date, today)
        if stage is None or (month.period_id, stage.value) in already:
            continue
        due.append(DueReminder(month.period_id, month.period_month, month.due_date, stage))
    return sorted(due, key=lambda reminder: (reminder.period_month, reminder.period_id))
