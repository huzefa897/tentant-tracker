"""A Rent Due Reminder about one bill, sent by hand (docs/messaging.md, Sent by hand).

The bill, then its rental period, locked in billing's order and read again under the locks. It
never counts as the month's Due or Follow-up, which still go out by themselves; at most one a
day per bill, so a double tap or a retry after a lost answer can't text twice. A failed one can
be sent again.
"""

import uuid

from django.shortcuts import get_object_or_404

from billing.models import RentalPeriod, RentEntry

from .. import composer
from ..models import MessageStatus, MessageType, RentDueReminderItem, ReminderStage
from ..sending import CannotSend, Draft, InvalidRequest

REFUSALS = {
    "entry_void": "This bill is void: it owes nothing.",
    "entry_paid": "This bill is paid: nothing is outstanding.",
    "no_rental_period": "This bill has no due date to remind about.",
    "already_sent_today": "A reminder for this bill was already sent today.",
}


def refused(code: str) -> CannotSend:
    return CannotSend(code, REFUSALS[code])


class BillReminder:
    name = "bill_reminder"

    def parse(self, tenancy, data) -> RentEntry:
        entry_id = data.get("entryId")
        try:
            uuid.UUID(str(entry_id))
        except ValueError:
            raise InvalidRequest("entryId", "Say which bill to remind about.") from None
        # Within this tenancy only: another tenancy's (or property's) bill is not found.
        return get_object_or_404(RentEntry.objects.filter(tenancy=tenancy), pk=entry_id)

    def prepare(self, tenancy, entry: RentEntry, today) -> Draft:
        # The bill first, then its period, as billing locks them: a payment or void being
        # recorded holds the bill, so this waits for it to commit and reads what it left.
        list(RentEntry.objects.select_for_update(no_key=True).filter(pk=entry.pk).values("pk"))
        period = (
            RentalPeriod.objects.select_for_update()
            .filter(tenancy=tenancy, period_month=entry.billing_month)
            .first()
        )
        if period is None:
            raise refused("no_rental_period")
        # Read again under the locks: a payment or void just now changes the answer.
        bill = RentEntry.objects.with_amounts().get(pk=entry.pk)
        if bill.status != RentEntry.Status.ACTIVE:
            raise refused("entry_void")
        if bill.outstanding_total <= 0:
            raise refused("entry_paid")
        already = (
            RentDueReminderItem.objects.filter(
                rental_period=period, stage=ReminderStage.MANUAL, message__local_date=today
            )
            .exclude(message__status=MessageStatus.FAILED)
            .exists()
        )
        if already:
            raise refused("already_sent_today")

        def record(message):
            RentDueReminderItem.objects.create(
                message=message, rental_period=period, stage=ReminderStage.MANUAL
            )

        return Draft(
            type=MessageType.RENT_DUE_REMINDER,
            body=composer.bill_reminder(
                tenancy.name, period.period_month, period.due_date, bill.outstanding_total, today
            ),
            record=record,
        )


BILL_REMINDER = BillReminder()
