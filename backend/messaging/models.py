import uuid
from datetime import date, datetime, time, timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from .clock import DEFAULT_TIME_ZONE, Clock, now_in_zone, validate_time_zone
from .senders.providers import DEFAULT_PROVIDER, validate_provider

DEFAULT_SEND_TIME = time(11, 30)
# Runs send between the send time and this, never later in the evening, even after an outage.
DEFAULT_SEND_UNTIL = time(20, 0)
# Runs are hourly, so a shorter window could fall between two runs and never be reached.
MIN_SEND_WINDOW = timedelta(hours=1)
# How long run records are kept; messages are kept for good.
RUN_RETENTION_DAYS = 90


class PropertyMessagingSettings(models.Model):
    """A property's messaging settings, one row per property (docs/messaging.md).

    Kept beside the property rather than on it, so messaging owns its settings and `properties`
    never depends on it. A property without a row has messaging off.
    """

    property = models.OneToOneField(
        "properties.Property",
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="messaging_settings",
    )
    enabled = models.BooleanField(
        "send messages",
        default=False,
        db_default=False,
        help_text="Off by default. Turn on to text this property's tenants.",
    )
    # A name, not a fixed offset, so daylight saving is followed. Checked against the IANA
    # database in Python (validate_time_zone); the database can't check it.
    time_zone = models.CharField(
        max_length=64,
        default=DEFAULT_TIME_ZONE,
        db_default=DEFAULT_TIME_ZONE,
        validators=[validate_time_zone],
        help_text="The property's time zone, e.g. Asia/Kolkata. Days and the send time are in it.",
    )
    send_time = models.TimeField(
        default=DEFAULT_SEND_TIME,
        db_default=DEFAULT_SEND_TIME,
        help_text="Messages go out at the first run at or after this time, in the property's time zone.",
    )
    send_until = models.TimeField(
        default=DEFAULT_SEND_UNTIL,
        db_default=DEFAULT_SEND_UNTIL,
        help_text=(
            "No message goes out at or after this time: what's left waits for tomorrow's send "
            "time. At least an hour after the send time, since runs are hourly."
        ),
    )
    # A registered provider's name (messaging/senders/providers.py), checked in Python like the
    # time zone, so adding a provider needs no migration. Its credentials are in the environment.
    provider = models.CharField(
        max_length=30,
        default=DEFAULT_PROVIDER,
        db_default=DEFAULT_PROVIDER,
        validators=[validate_provider],
        help_text="Who sends this property's messages. Its key is set on the server, not here.",
    )
    reminders_start = models.DateField(
        null=True,
        blank=True,
        help_text=(
            "Rent Due Reminders are sent only for months due on or after this date, so "
            "turning messaging on never texts tenants about older arrears. Required to send."
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "property messaging settings"
        verbose_name_plural = "property messaging settings"
        constraints = [
            models.CheckConstraint(
                condition=Q(enabled=False) | Q(reminders_start__isnull=False),
                name="messaging_settings_enabled_needs_reminders_start",
                violation_error_message="Set when reminders start before turning messaging on.",
            ),
        ]

    def __str__(self):
        return f"Messaging for {self.property}"

    @classmethod
    def for_property(cls, property) -> "PropertyMessagingSettings":
        """The property's saved settings, or unsaved defaults (messaging off) when it has none."""
        try:
            return cls.objects.get(property=property)
        except cls.DoesNotExist:
            return cls(property=property)

    def clean(self):
        super().clean()
        if self.enabled and self.reminders_start is None:
            raise ValidationError(
                {"reminders_start": "Set when reminders start before turning messaging on."}
            )
        if self.send_time is not None and self.send_until is not None:
            day = date.min
            window = datetime.combine(day, self.send_until) - datetime.combine(day, self.send_time)
            if window < MIN_SEND_WINDOW:
                raise ValidationError(
                    {
                        "send_until": "Leave at least an hour after the send time: runs are "
                        "hourly, so a shorter window might never be reached."
                    }
                )

    def local_now(self, clock: Clock) -> datetime:
        return now_in_zone(clock, self.time_zone)

    def local_date(self, clock: Clock) -> date:
        """Today at the property, in its own time zone."""
        return self.local_now(clock).date()

    def in_send_window(self, clock: Clock) -> bool:
        """Whether a run may send at the property now: from today's send time until its send
        until time, in its own zone. Outside it, what's due waits for the next window."""
        now = self.local_now(clock).time()
        return self.send_time <= now < self.send_until


class MessageType(models.TextChoices):
    RENT_DUE_REMINDER = "rent_due_reminder", "Rent Due Reminder"
    PAYMENT_MESSAGE = "payment_message", "Payment Message"


class ReminderStage(models.TextChoices):
    DUE = "due", "Due"
    FOLLOW_UP = "follow_up", "Follow-up"
    # Sent from the bill's page by an owner or manager (messaging/manual.py). Never counts as
    # the Due or Follow-up, which still go out by themselves.
    MANUAL = "manual", "Sent by hand"


# The stages runs send, each once per month ever.
AUTOMATIC_STAGES = (ReminderStage.DUE, ReminderStage.FOLLOW_UP)


class MessageStatus(models.TextChoices):
    # Reserved and committed before the sender is called, so a run can never send it twice.
    QUEUED = "queued", "Queued"
    SENT = "sent", "Sent"
    FAILED = "failed", "Failed"
    # A timeout or lost answer: it may have gone, so it's never sent again by itself.
    UNKNOWN = "unknown", "Unknown"
    SKIPPED = "skipped", "Skipped"


class Channel(models.TextChoices):
    SMS = "sms", "SMS"


class RunTrigger(models.TextChoices):
    COMMAND = "command", "Command"
    SCHEDULE = "schedule", "Schedule"


class MessagingRun(models.Model):
    """One run of the runner (messaging/runner.py): what it checked and what came of it, so a
    quiet day still shows the job ran. Kept for RUN_RETENTION_DAYS."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    trigger = models.CharField(max_length=10, choices=RunTrigger.choices)
    # Asked for a dry run: it works out what's due, reserves and sends nothing, and counts what
    # it would have sent as planned. (A property whose provider isn't set up is planned the same
    # way, on any run, with the reason in errors.)
    dry_run = models.BooleanField(default=False)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    properties_checked = models.PositiveIntegerField(default=0)
    planned = models.PositiveIntegerField(default=0)
    sent = models.PositiveIntegerField(default=0)
    failed = models.PositiveIntegerField(default=0)
    unknown = models.PositiveIntegerField(default=0)
    skipped = models.PositiveIntegerField(default=0)
    # Planned but not sent: the property's provider can't send here (messaging off on the
    # server, or its credentials not set). The months stay due; errors say why.
    held = models.PositiveIntegerField(default=0)
    # What went wrong for a property or a tenancy, one line each, by id: never a phone number.
    errors = models.TextField(blank=True)
    # Out of time (a run from the endpoint has a time budget): what's left goes at the next run.
    stopped_early = models.BooleanField(default=False)

    class Meta:
        ordering = ("-started_at",)

    def __str__(self):
        return f"Run {self.started_at:%Y-%m-%d %H:%M}"


class Message(models.Model):
    """One message sent, or attempted, to one tenant. Never edited by hand: its status moves
    from queued to sent, failed or unknown once, and skipped ones are recorded as skipped."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenancy = models.ForeignKey(
        "properties.Tenancy", on_delete=models.PROTECT, related_name="messages"
    )
    run = models.ForeignKey(
        MessagingRun, on_delete=models.SET_NULL, null=True, blank=True, related_name="messages"
    )
    # Who sent it by hand, from the app; empty for a run's.
    sent_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    type = models.CharField(max_length=20, choices=MessageType.choices)
    channel = models.CharField(max_length=10, choices=Channel.choices, default=Channel.SMS)
    status = models.CharField(max_length=10, choices=MessageStatus.choices)
    reason = models.CharField(max_length=300, blank=True)
    # The day at the property it was for, in its own time zone.
    local_date = models.DateField()
    # As sent: a later change to the tenancy's number or the wording never rewrites them.
    recipient = models.CharField(max_length=20)
    body = models.TextField()
    provider = models.CharField(max_length=30, blank=True)
    provider_message_id = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    attempted_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            # A tenancy that can't be texted is recorded once a day, not on every hourly run.
            models.UniqueConstraint(
                fields=["tenancy", "type", "local_date"],
                condition=Q(status="skipped"),
                name="message_skipped_once_a_day",
            ),
        ]
        indexes = [models.Index(fields=["status", "created_at"])]

    def __str__(self):
        return f"{self.get_type_display()} to {self.tenancy} ({self.get_status_display()})"


class RentDueReminderItem(models.Model):
    """One month at one stage, covered by a Rent Due Reminder. At most one held per month for
    each automatic stage: the database refuses a second, so a repeated or overlapping run can't
    send twice. Sent by hand ones are limited to one a day instead (messaging/manual.py).
    A message the provider refused (`failed`, so nothing went) releases its items, which keep
    the history and let a later run remind about the month again."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    message = models.ForeignKey(Message, on_delete=models.PROTECT, related_name="reminder_items")
    rental_period = models.ForeignKey(
        "billing.RentalPeriod", on_delete=models.PROTECT, related_name="reminder_items"
    )
    stage = models.CharField(max_length=10, choices=ReminderStage.choices)
    created_at = models.DateTimeField(auto_now_add=True)
    # When its message failed: the month and stage are free to be reminded about again.
    released_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("rental_period__period_month",)
        constraints = [
            models.UniqueConstraint(
                fields=["rental_period", "stage"],
                condition=Q(stage__in=["due", "follow_up"], released_at__isnull=True),
                name="one_reminder_per_period_and_stage",
            ),
        ]

    def __str__(self):
        return f"{self.rental_period} — {self.get_stage_display()}"
