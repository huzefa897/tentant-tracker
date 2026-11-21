"""The current time, and what it is in a given time zone.

Messaging works out "today" and "is it time to send yet" in each property's own time zone
(`PropertyMessagingSettings.time_zone`), never the server's or `settings.TIME_ZONE`. The clock is
passed in, so tests fix the time instead of patching `timezone.now`.
"""

from datetime import datetime
from functools import cache
from typing import Protocol
from zoneinfo import ZoneInfo, available_timezones

from django.core.exceptions import ValidationError
from django.utils import timezone

DEFAULT_TIME_ZONE = "Asia/Kolkata"


class Clock(Protocol):
    def now(self) -> datetime:
        """The current moment, time zone aware."""
        ...


class SystemClock:
    def now(self) -> datetime:
        return timezone.now()


class FixedClock:
    """Always the same moment: for tests and dry runs of a given time."""

    def __init__(self, moment: datetime):
        if timezone.is_naive(moment):
            raise ValueError("FixedClock needs a time zone aware datetime.")
        self._moment = moment

    def now(self) -> datetime:
        return self._moment


@cache
def time_zone_names() -> frozenset[str]:
    """Every IANA time zone name (from the `tzdata` package when the system has none)."""
    return frozenset(available_timezones())


def time_zone_choices() -> list[tuple[str, str]]:
    return [(name, name) for name in sorted(time_zone_names())]


def validate_time_zone(name: str) -> None:
    if name not in time_zone_names():
        raise ValidationError(
            "Enter a time zone name such as Asia/Kolkata.", code="invalid_time_zone"
        )


def local_now(clock: Clock, time_zone: str) -> datetime:
    """The clock's current moment in the named time zone."""
    return clock.now().astimezone(ZoneInfo(time_zone))
