"""A Rent Due Reminder about every month a tenancy still owes, sent by hand from the tenant
page (docs/messaging.md, Sent by hand).

The months are billing's own (RentalPeriod.objects.owing(), what the dashboard counts): due by
today, not marked not owed, and with money left on the bill or no bill yet. Unlike a run, it
covers older arrears too: an owner chose to send it. It never counts as a month's Due or
Follow-up. Sent at most once a day for the same months: refused when every month owed already
had a reminder sent by hand today (this or a bill's) that hasn't failed, so a double tap or a
retry can't text twice.
"""

from billing.models import RentalPeriod, RentEntry
from billing.periods import ensure_periods

from .. import composer
from ..models import MessageStatus, MessageType, RentDueReminderItem, ReminderStage
from ..sending import CannotSend, Draft, Preview

REFUSALS = {
    "nothing_owed": "Nothing is owed: there's no month to remind about.",
    "already_sent_today": "A reminder for these months was already sent today.",
}


def refused(code: str) -> CannotSend:
    return CannotSend(code, REFUSALS[code])


def owed_periods(tenancy, today):
    """The tenancy's months owed by today, oldest first, with their bill's `outstanding` (null
    without a bill). Creates any scheduled ones first, as the dashboard does."""
    ensure_periods(tenancy, today)
    return list(
        RentalPeriod.objects.filter(tenancy=tenancy, due_date__lte=today)
        .owing()
        .order_by("period_month")
    )


def reminded_today(period_ids, today) -> set:
    """The periods that already had a reminder sent by hand today that hasn't failed."""
    return set(
        RentDueReminderItem.objects.filter(
            rental_period_id__in=period_ids,
            stage=ReminderStage.MANUAL,
            message__local_date=today,
        )
        .exclude(message__status=MessageStatus.FAILED)
        .values_list("rental_period_id", flat=True)
    )


def amounts(periods) -> list:
    return [(p.period_month, p.outstanding if p.has_bill else None) for p in periods]


class DuesReminder:
    name = "dues_reminder"

    def parse(self, tenancy, data):
        return None  # about the tenancy itself: nothing more to read

    def preview(self, tenancy, subject, today) -> Preview:
        periods = owed_periods(tenancy, today)
        if not periods:
            raise refused("nothing_owed")
        billed = [p.outstanding for p in periods if p.has_bill]
        return Preview(
            body=composer.dues_reminder(tenancy.name, amounts(periods)),
            details={
                "months": [
                    {
                        "month": p.period_month.strftime("%Y-%m"),
                        "dueDate": p.due_date.isoformat(),
                        "outstanding": str(p.outstanding) if p.has_bill else None,
                    }
                    for p in periods
                ],
                "billedOutstanding": str(sum(billed)) if billed else "0.00",
            },
        )

    def prepare(self, tenancy, subject, today) -> Draft:
        ensure_periods(tenancy, today)  # before the locks: it may write
        due = list(
            RentalPeriod.objects.filter(tenancy=tenancy, due_date__lte=today)
            .owing()
            .values_list("pk", "period_month")
        )
        months = [month for _, month in due]
        # The bills first, then the periods, as billing locks them: a payment or void being
        # recorded holds its bill, so this waits for it to commit and reads what it left.
        list(
            RentEntry.objects.select_for_update(no_key=True)
            .filter(tenancy=tenancy, billing_month__in=months)
            .values("pk")
        )
        list(
            RentalPeriod.objects.select_for_update()
            .filter(pk__in=[pk for pk, _ in due])
            .values("pk")
        )
        # Read again under the locks: a payment just now may have paid a month off.
        periods = list(
            RentalPeriod.objects.filter(pk__in=[pk for pk, _ in due])
            .owing()
            .order_by("period_month")
        )
        if not periods:
            raise refused("nothing_owed")
        if reminded_today([p.pk for p in periods], today) >= {p.pk for p in periods}:
            raise refused("already_sent_today")

        def record(message):
            RentDueReminderItem.objects.bulk_create(
                [
                    RentDueReminderItem(
                        message=message, rental_period=p, stage=ReminderStage.MANUAL
                    )
                    for p in periods
                ]
            )

        return Draft(
            type=MessageType.RENT_DUE_REMINDER,
            body=composer.dues_reminder(tenancy.name, amounts(periods)),
            record=record,
        )


DUES_REMINDER = DuesReminder()
