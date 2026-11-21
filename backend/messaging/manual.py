"""A Rent Due Reminder sent by hand, from a bill's page in the app (docs/messaging.md).

The same safety as a run's: checked and reserved in a transaction (the bill's rental period
locked), then sent outside it and recorded. It never counts as the month's Due or Follow-up,
which still go out by themselves; at most one a day per bill, so a double tap or a retry
after a lost answer can't text twice. A failed one can be sent again.
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


class CannotSend(Exception):
    """Why nothing was sent: a code for the app and a sentence for people."""

    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


MESSAGING_OFF = CannotSend("messaging_off", "Messaging is off for this property.")
NOT_SET_UP = CannotSend("provider_not_set_up", "SMS isn't set up on the server yet.")
BILL_VOID = CannotSend("entry_void", "This bill is void: it owes nothing.")
BILL_PAID = CannotSend("entry_paid", "This bill is paid: nothing is outstanding.")
NO_PERIOD = CannotSend("no_rental_period", "This bill has no due date to remind about.")
UNTEXTABLE = CannotSend("number_untextable", "The tenant's mobile number can't be texted.")
ALREADY_TODAY = CannotSend(
    "already_sent_today", "A reminder for this bill was already sent today."
)


@dataclass(frozen=True)
class Sent:
    message: Message
    result: SendResult


def send_bill_reminder(entry: RentEntry, user, clock: Clock, senders=None) -> Sent:
    tenancy = entry.tenancy
    settings = PropertyMessagingSettings.for_property(tenancy.property)
    if not settings.enabled:
        raise MESSAGING_OFF
    sender: MessageSender = (senders or registry.sender_for)(settings.provider)
    if not sender.can_send:
        raise NOT_SET_UP
    today = settings.local_date(clock)

    with transaction.atomic():
        period = (
            RentalPeriod.objects.select_for_update()
            .filter(tenancy=tenancy, period_month=entry.billing_month)
            .first()
        )
        if period is None:
            raise NO_PERIOD
        # Read again under the lock: a payment or void just now changes the answer.
        bill = RentEntry.objects.with_amounts().get(pk=entry.pk)
        if bill.status != RentEntry.Status.ACTIVE:
            raise BILL_VOID
        if bill.outstanding_total <= 0:
            raise BILL_PAID
        if not can_text(tenancy.mobile_number):
            raise UNTEXTABLE
        already = (
            RentDueReminderItem.objects.filter(
                rental_period=period, stage=ReminderStage.MANUAL, message__local_date=today
            )
            .exclude(message__status=MessageStatus.FAILED)
            .exists()
        )
        if already:
            raise ALREADY_TODAY
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
