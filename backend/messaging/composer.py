"""What a message says. The text is the app's, never a provider's template, so changing provider
never changes what tenants read (docs/messaging.md, Providers).

Plain ASCII on purpose: one character outside the GSM 7-bit alphabet (a ₹, a curly quote) makes
every part of an SMS 70 characters instead of 160.
"""

import unicodedata
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


# Typed on phones in place of their ASCII forms.
_PUNCTUATION = str.maketrans(
    {"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2013": "-", "\u2014": "-"}
)


def _ascii_name(name: str) -> str:
    """The name in ASCII, so it never turns the whole SMS into 70-character parts: curly quotes
    and dashes made plain, accents dropped (D\u2019Souza -> D'Souza, Jos\u00e9 -> Jose), anything
    else left out, and its spacing tidied."""
    plain = unicodedata.normalize("NFKD", name.translate(_PUNCTUATION))
    return " ".join(plain.encode("ascii", "ignore").decode().split())


def _greeting(name: str) -> str:
    """'Hi <name>', or just 'Hi' for a name with nothing left in ASCII."""
    tidied = _ascii_name(name)
    return f"Hi {tidied}" if tidied else "Hi"


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
