"""What a message says. The text is the app's, never a provider's template, so changing provider
never changes what tenants read (docs/messaging.md, Providers).

Plain ASCII on purpose: one character outside the GSM 7-bit alphabet (a ₹, a curly quote) makes
every part of an SMS 70 characters instead of 160.
"""

from datetime import date
from decimal import Decimal
from typing import Sequence

from .models import ReminderStage
from .policy import DueReminder

_LABELS = {ReminderStage.DUE: "due", ReminderStage.FOLLOW_UP: "overdue"}


def _month(reminder: DueReminder) -> str:
    return f"{reminder.period_month:%B %Y}"


def _join(parts: Sequence[str]) -> str:
    if len(parts) == 1:
        return parts[0]
    return f"{', '.join(parts[:-1])} and {parts[-1]}"


def _greeting(name: str) -> str:
    return f"Hi {' '.join(name.split())}"


def rent_due_reminder(name: str, reminders: Sequence[DueReminder]) -> str:
    """One message for all of a tenancy's months due a reminder today, oldest first."""
    if not reminders:
        raise ValueError("A Rent Due Reminder needs at least one month.")
    if len(reminders) == 1:
        (reminder,) = reminders
        if reminder.stage == ReminderStage.DUE:
            return (
                f"{_greeting(name)}, your rent for {_month(reminder)} is now due. "
                "Please arrange payment at your earliest convenience. Thank you."
            )
        return (
            f"{_greeting(name)}, this is a reminder that your {_month(reminder)} rent remains "
            "unpaid. Please arrange payment or contact us if you've already paid. Thank you."
        )
    months = _join([f"{_month(r)} ({_LABELS[ReminderStage(r.stage)]})" for r in reminders])
    return (
        f"{_greeting(name)}, your rent for {months} is unpaid. Please arrange payment or "
        "contact us if you've already paid. Thank you."
    )


def rupees(amount: Decimal) -> str:
    """Rs. 12,34,567 (Indian grouping, whole rupees unless there are paise), in ASCII."""
    whole, _, paise = f"{amount:.2f}".partition(".")
    digits = whole.lstrip("-")
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        digits = ",".join(([head] if head else []) + groups + [tail])
    sign = "-" if whole.startswith("-") else ""
    return f"Rs. {sign}{digits}" + ("" if paise == "00" else f".{paise}")


def bill_reminder(
    name: str, month: date, due_date: date | None, outstanding: Decimal, today: date
) -> str:
    """A reminder about one bill, sent by hand from its page: what's outstanding, and whether
    it's due yet, due today or overdue."""
    owed = f"{month:%B %Y} rent ({rupees(outstanding)} outstanding)"
    if due_date and today < due_date:
        return (
            f"{_greeting(name)}, a reminder that your {owed} is due on "
            f"{due_date.day} {due_date:%B}. Thank you."
        )
    if due_date and today == due_date:
        return (
            f"{_greeting(name)}, your {owed} is due today. Please arrange payment at your "
            "earliest convenience. Thank you."
        )
    state = "overdue" if due_date else "unpaid"
    return (
        f"{_greeting(name)}, your {owed} is {state}. Please arrange payment or contact us if "
        "you've already paid. Thank you."
    )
