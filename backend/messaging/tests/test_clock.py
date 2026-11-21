from datetime import UTC, datetime

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase

from messaging.clock import (
    FixedClock,
    SystemClock,
    local_now,
    time_zone_choices,
    validate_time_zone,
)


class FixedClockTests(SimpleTestCase):
    def test_returns_its_moment(self):
        moment = datetime(2026, 11, 21, 6, 0, tzinfo=UTC)

        self.assertEqual(FixedClock(moment).now(), moment)

    def test_refuses_a_naive_moment(self):
        with self.assertRaises(ValueError):
            FixedClock(datetime(2026, 11, 21, 6, 0))


class SystemClockTests(SimpleTestCase):
    def test_now_is_time_zone_aware(self):
        self.assertIsNotNone(SystemClock().now().tzinfo)


class LocalNowTests(SimpleTestCase):
    def test_converts_to_the_named_zone(self):
        clock = FixedClock(datetime(2026, 11, 21, 6, 0, tzinfo=UTC))

        self.assertEqual(
            local_now(clock, "Asia/Kolkata").replace(tzinfo=None), datetime(2026, 11, 21, 11, 30)
        )
        self.assertEqual(
            local_now(clock, "America/New_York").replace(tzinfo=None), datetime(2026, 11, 21, 1, 0)
        )

    def test_follows_daylight_saving(self):
        summer = FixedClock(datetime(2026, 7, 1, 12, 0, tzinfo=UTC))
        winter = FixedClock(datetime(2026, 1, 1, 12, 0, tzinfo=UTC))

        self.assertEqual(local_now(summer, "Europe/London").hour, 13)
        self.assertEqual(local_now(winter, "Europe/London").hour, 12)


class TimeZoneValidationTests(SimpleTestCase):
    def test_accepts_iana_names(self):
        for name in ("Asia/Kolkata", "Asia/Dubai", "Europe/London", "UTC"):
            with self.subTest(name=name):
                validate_time_zone(name)

    def test_refuses_anything_else(self):
        for name in ("", "India", "asia/kolkata", "+05:30", "IST ", "../etc/passwd"):
            with self.subTest(name=name), self.assertRaises(ValidationError):
                validate_time_zone(name)

    def test_choices_are_sorted_names(self):
        choices = time_zone_choices()

        self.assertIn(("Asia/Kolkata", "Asia/Kolkata"), choices)
        self.assertEqual(choices, sorted(choices))
