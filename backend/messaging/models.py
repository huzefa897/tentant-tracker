from datetime import date, datetime, time

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from .clock import DEFAULT_TIME_ZONE, Clock, local_now, validate_time_zone

DEFAULT_SEND_TIME = time(11, 30)


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
        help_text="Off by default. Nothing is sent while MESSAGING_ENABLED is off either.",
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

    def local_now(self, clock: Clock) -> datetime:
        return local_now(clock, self.time_zone)

    def local_date(self, clock: Clock) -> date:
        """Today at the property, in its own time zone."""
        return self.local_now(clock).date()

    def send_time_reached(self, clock: Clock) -> bool:
        """Whether today's send time has come at the property, so a run may send."""
        return self.local_now(clock).time() >= self.send_time
