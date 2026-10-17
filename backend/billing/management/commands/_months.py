from datetime import date

from django.core.management.base import CommandError

from billing.serializers import MONTH_PATTERN


def parse_month(option: str, value: str) -> date:
    """YYYY-MM as the month's first day, or a CommandError naming the option."""
    match = MONTH_PATTERN.match(value)
    if not match or not 1 <= int(match[2]) <= 12:
        raise CommandError(f"{option} takes a month as YYYY-MM, not {value!r}.")
    return date(int(match[1]), int(match[2]), 1)
