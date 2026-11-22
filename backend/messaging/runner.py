"""Runs messaging once: for each property whose send time has come, works out the Rent Due
Reminders due today and sends one message per tenancy (docs/messaging.md).

Sending safely, in this order, per tenancy:

1. Reserve: lock the months' rental periods, check again that they're owed and not reminded
   about yet, then create the reminder items and a `queued` message, and commit. The unique
   (period, stage) constraint is the last guard, so two runs at once can't both reserve one.
2. Send, outside any transaction, then record `sent`, `failed` or `unknown`. A message left
   `queued` (the process stopped) or `unknown` (a timeout) is never sent again by itself: its
   months are reserved. A `failed` one (the provider refused it, so nothing went) releases its
   months, and the next day's run tries again: at most one failed try a day per tenancy, so a
   refusal that lasts (a bad key) isn't retried hourly, and reminders stay at the send time.

One property's or tenancy's failure is recorded on the run and never stops the others.
Messaging never writes to bills or payments; it only creates rental periods that are due, as
the dashboard's reads do.
"""

import logging
import time
import traceback
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Callable

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from accounts.phone import validate_phone_number
from billing.models import RentalPeriod
from properties.models import Tenancy

from . import composer
from .clock import Clock, FixedClock
from .models import (
    RUN_RETENTION_DAYS,
    Message,
    MessageStatus,
    MessageType,
    MessagingRun,
    PropertyMessagingSettings,
    RentDueReminderItem,
    RunTrigger,
)
from .owed import owed_months, reminded, still_owed
from .policy import DueReminder, reminders_due
from .senders import MessageSender, SendOutcome, SendResult

logger = logging.getLogger(__name__)

UNTEXTABLE_REASON = "The tenancy's mobile number can't be texted."


def log_failure(what: str, pk, exc: BaseException) -> None:
    """Logs where it failed and the exception's type, never its message: a database error's
    message can quote the row it refused, with a number or a message's text in it."""
    logger.error(
        "Messaging: %s %s failed with %s\n%s",
        what,
        pk,
        type(exc).__name__,
        "".join(traceback.format_tb(exc.__traceback__)),
    )


@dataclass(frozen=True)
class PlannedMessage:
    """A message a run sends, or (dry run) would send."""

    tenancy: Tenancy
    reminders: list[DueReminder]
    body: str


@dataclass
class RunResult:
    run: MessagingRun
    planned: list[PlannedMessage] = field(default_factory=list)


def can_text(number: str) -> bool:
    try:
        validate_phone_number(number)
    except ValidationError:
        return False
    return True


class MessageRunner:
    def __init__(
        self,
        sender: MessageSender,
        clock: Clock,
        *,
        trigger: RunTrigger = RunTrigger.COMMAND,
        dry_run: bool = False,
        time_budget: float | None = None,
        monotonic: Callable[[], float] = time.monotonic,
    ):
        self.sender = sender
        self.clock = clock
        self.trigger = trigger
        # Seconds after which no new tenancy is started (None: no limit). A request has to
        # finish before Gunicorn's timeout; what's left was never reserved, so the next run
        # sends it.
        self.time_budget = time_budget
        self.monotonic = monotonic
        # Without a provider nothing can be sent, so nothing is reserved either: the months
        # stay due for when one is set.
        self.dry_run = dry_run or not sender.can_send

    def run(self) -> RunResult:
        # One moment for the whole run, so every property is judged at the same time.
        clock = FixedClock(self.clock.now())
        started = self.monotonic()
        result = RunResult(
            MessagingRun.objects.create(
                trigger=self.trigger, dry_run=self.dry_run, provider=self.sender.provider
            )
        )
        errors: list[str] = []
        enabled = PropertyMessagingSettings.objects.filter(
            enabled=True, property__is_active=True
        ).select_related("property")
        for settings in enabled:
            if self._out_of_time(started):  # before the property's own reads and writes
                result.run.stopped_early = True
                break
            try:
                if not settings.send_time_reached(clock):
                    continue
                today = settings.local_date(clock)
                result.run.properties_checked += 1
                owed = owed_months(settings.property, today, settings.reminders_start)
            except Exception as exc:  # one property never stops the others
                log_failure("property", settings.pk, exc)
                errors.append(f"Property {settings.pk}: {type(exc).__name__}")
                continue
            for tenancy, months in owed.items():
                if self._out_of_time(started):
                    result.run.stopped_early = True
                    break
                try:
                    self._tenancy(result, tenancy, months, settings.reminders_start, today)
                except Exception as exc:  # nor one tenancy
                    log_failure("tenancy", tenancy.pk, exc)
                    errors.append(f"Tenancy {tenancy.pk}: {type(exc).__name__}")

        run = result.run
        run.errors = "\n".join(errors)
        run.finished_at = timezone.now()
        run.save()
        MessagingRun.objects.filter(
            started_at__lt=run.finished_at - timedelta(days=RUN_RETENTION_DAYS)
        ).delete()
        logger.info(
            "Messaging run %s: %s properties, %s planned, %s sent, %s failed, %s unknown, "
            "%s skipped, %s errors%s",
            run.pk,
            run.properties_checked,
            run.planned,
            run.sent,
            run.failed,
            run.unknown,
            run.skipped,
            len(errors),
            ", stopped early" if run.stopped_early else "",
        )
        return result

    def _out_of_time(self, started: float) -> bool:
        return self.time_budget is not None and self.monotonic() - started >= self.time_budget

    def _tenancy(self, result, tenancy, months, reminders_start, today):
        due = reminders_due(months, today, reminders_start, reminded([m.period_id for m in months]))
        if not due or self._failed_today(tenancy, today):
            return
        if not can_text(tenancy.mobile_number):
            self._skip(result.run, tenancy, today)
            return
        if self.dry_run:
            result.run.planned += 1
            result.planned.append(
                PlannedMessage(tenancy, due, composer.rent_due_reminder(tenancy.name, due))
            )
            return
        reserved = self._reserve(result.run, tenancy, due, today)
        if reserved is None:
            return
        message, reminders = reserved
        result.run.planned += 1
        result.planned.append(PlannedMessage(tenancy, reminders, message.body))
        self._send(result.run, message)

    @staticmethod
    def _failed_today(tenancy, today) -> bool:
        """Whether a run's reminder to this tenancy was refused today: it's tried again tomorrow."""
        return Message.objects.filter(
            tenancy=tenancy,
            type=MessageType.RENT_DUE_REMINDER,
            status=MessageStatus.FAILED,
            local_date=today,
            run__isnull=False,
        ).exists()

    def _skip(self, run, tenancy, today):
        """Recorded once a day (message_skipped_once_a_day) and nothing reserved, so the months
        are reminded about once the number is fixed."""
        if self.dry_run:
            run.skipped += 1
            return
        try:
            with transaction.atomic():
                Message.objects.create(
                    tenancy=tenancy,
                    run=run,
                    type=MessageType.RENT_DUE_REMINDER,
                    status=MessageStatus.SKIPPED,
                    reason=UNTEXTABLE_REASON,
                    local_date=today,
                    recipient=tenancy.mobile_number[:20],
                    body="",
                    provider=self.sender.provider,
                )
        except IntegrityError:
            return  # already recorded today
        run.skipped += 1

    def _reserve(self, run, tenancy, due, today):
        ids = [reminder.period_id for reminder in due]
        try:
            with transaction.atomic():
                # Locked, so a run at the same time waits here, then finds them reminded.
                list(RentalPeriod.objects.select_for_update().filter(pk__in=ids).values("pk"))
                owed, done = still_owed(ids), reminded(ids)
                reminders = [
                    reminder
                    for reminder in due
                    if reminder.period_id in owed
                    and (reminder.period_id, reminder.stage.value) not in done
                ]
                if not reminders:
                    return None
                message = Message.objects.create(
                    tenancy=tenancy,
                    run=run,
                    type=MessageType.RENT_DUE_REMINDER,
                    status=MessageStatus.QUEUED,
                    local_date=today,
                    recipient=tenancy.mobile_number,
                    body=composer.rent_due_reminder(tenancy.name, reminders),
                    provider=self.sender.provider,
                )
                RentDueReminderItem.objects.bulk_create(
                    [
                        RentDueReminderItem(
                            message=message, rental_period_id=r.period_id, stage=r.stage
                        )
                        for r in reminders
                    ]
                )
        except IntegrityError:
            return None  # another run reserved one of them first
        return message, reminders

    def _send(self, run, message):
        try:
            outcome = self.sender.send(message.recipient, message.body)
        except Exception as exc:
            # A sender shouldn't raise, but one that does may have sent it: never retry blindly.
            log_failure("sending message", message.pk, exc)
            outcome = SendResult(SendOutcome.UNKNOWN, reason="The sender stopped unexpectedly.")
        now = timezone.now()
        with transaction.atomic():
            recorded = Message.objects.filter(pk=message.pk, status=MessageStatus.QUEUED).update(
                status=MessageStatus(outcome.outcome.value),
                provider_message_id=outcome.provider_message_id[:100],
                reason=outcome.reason[:300],
                attempted_at=now,
                updated_at=now,
            )
            if recorded and outcome.outcome == SendOutcome.FAILED:
                # Nothing went, so its months are free to be reminded about again.
                RentDueReminderItem.objects.filter(message=message).update(released_at=now)
        setattr(run, outcome.outcome.value, getattr(run, outcome.outcome.value) + 1)
