"""A Rent Due Reminder sent by hand, from a bill's page in the app (docs/messaging.md).

The same safety as a run's: checked and reserved in a transaction (the bill, then its rental
period, locked in billing's order), then sent outside it and recorded. It never counts as the
month's Due or Follow-up, which still go out by themselves; at most one a day per bill, so a
double tap or a retry after a lost answer can't text twice. A failed one can be sent again.
"""

from dataclasses import dataclass

from django.db import transaction

from billing.models import RentalPeriod, RentEntry
from . import composer
from .clock import Clock
from .models import (
    Message,
    MessageStatus,
    MessageType,
    PropertyMessagingSettings,
    RentDueReminderItem,
    ReminderStage,
)
from .runner import can_text, deliver
from .senders import MessageSender, SendResult, registry
from .senders.providers import MESSAGING_OFF as SERVER_SWITCH_OFF

# Why nothing was sent, by code: a sentence for people.
REFUSALS = {
    "messaging_off": "Messaging is off for this property.",
    "server_off": "Messaging is off on the server.",
    "provider_not_set_up": "SMS isn't set up on the server yet.",
    "entry_void": "This bill is void: it owes nothing.",
    "entry_paid": "This bill is paid: nothing is outstanding.",
    "no_rental_period": "This bill has no due date to remind about.",
    "number_untextable": "The tenant's mobile number can't be texted.",
    "already_sent_today": "A reminder for this bill was already sent today.",
}


class CannotSend(Exception):
    """Why nothing was sent: a code for the app and a sentence for people. Raised fresh each
    time, never a shared instance: a raise writes its traceback onto the exception."""

    def __init__(self, code: str):
        self.code = code
        self.detail = REFUSALS[code]
        super().__init__(self.detail)


@dataclass(frozen=True)
class Sent:
    message: Message
    result: SendResult


def send_bill_reminder(entry: RentEntry, user, clock: Clock, senders=None) -> Sent:
    tenancy = entry.tenancy
    settings = PropertyMessagingSettings.for_property(tenancy.property)
    if not settings.enabled:
        raise CannotSend("messaging_off")
    sender: MessageSender = (senders or registry.sender_for)(settings.provider)
    if not sender.can_send:
        off = sender.reason == SERVER_SWITCH_OFF
        raise CannotSend("server_off" if off else "provider_not_set_up")
    today = settings.local_date(clock)

    with transaction.atomic():
        # The bill first, then its period, as billing locks them: a payment or void being
        # recorded holds the bill, so this waits for it to commit and reads what it left.
        list(RentEntry.objects.select_for_update(no_key=True).filter(pk=entry.pk).values("pk"))
        period = (
            RentalPeriod.objects.select_for_update()
            .filter(tenancy=tenancy, period_month=entry.billing_month)
            .first()
        )
        if period is None:
            raise CannotSend("no_rental_period")
        # Read again under the locks: a payment or void just now changes the answer.
        bill = RentEntry.objects.with_amounts().get(pk=entry.pk)
        if bill.status != RentEntry.Status.ACTIVE:
            raise CannotSend("entry_void")
        if bill.outstanding_total <= 0:
            raise CannotSend("entry_paid")
        if not can_text(tenancy.mobile_number):
            raise CannotSend("number_untextable")
        already = (
            RentDueReminderItem.objects.filter(
                rental_period=period, stage=ReminderStage.MANUAL, message__local_date=today
            )
            .exclude(message__status=MessageStatus.FAILED)
            .exists()
        )
        if already:
            raise CannotSend("already_sent_today")
        message = Message.objects.create(
            tenancy=tenancy,
            sent_by=user,
            type=MessageType.RENT_DUE_REMINDER,
            status=MessageStatus.QUEUED,
            local_date=today,
            recipient=tenancy.mobile_number,
            body=composer.bill_reminder(
                tenancy.name, period.period_month, period.due_date, bill.outstanding_total, today
            ),
            provider=sender.provider,
        )
        RentDueReminderItem.objects.create(
            message=message, rental_period=period, stage=ReminderStage.MANUAL
        )

    return Sent(message, deliver(message, sender))
