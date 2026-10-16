"""Rental periods: created from the tenancy schedule on demand, once each, and never moved by a
later change to the due day or payment timing."""

from datetime import date
from unittest import mock

from django.test import TestCase

from billing.models import RentalPeriod
from billing.periods import ensure_periods, ensure_property_periods, scheduled_months
from properties.models import PaymentTiming

from .factories import make_property, make_tenancy, make_user
from .test_payments_api import make_entry

TODAY = date(2026, 10, 16)


def months(*pairs):
    return [date(year, month, 1) for year, month in pairs]


class ScheduledMonthsTests(TestCase):
    def setUp(self):
        self.prop = make_property()
        self.prop.rent_tracking_start = date(2026, 7, 1)
        self.prop.save()

    def scheduled(self, today=TODAY, **fields):
        return scheduled_months(make_tenancy(self.prop, **fields), self.prop, today)

    def test_postpaid_months_are_owed_once_due_within_a_week(self):
        # September is due 11 October; October not until 11 November.
        self.assertEqual(
            self.scheduled(rent_due_day=11), months((2026, 7), (2026, 8), (2026, 9))
        )
        # Due 20 October, within the week: October's own month isn't yet.
        self.assertEqual(
            self.scheduled(rent_due_day=20, flat_number="301"),
            months((2026, 7), (2026, 8), (2026, 9)),
        )

    def test_prepaid_months_are_owed_in_the_month_itself(self):
        self.prop.payment_timing = PaymentTiming.PREPAID
        # 1 November is within a week of 28 October.
        self.assertEqual(
            self.scheduled(today=date(2026, 10, 28), rent_due_day=1),
            months((2026, 7), (2026, 8), (2026, 9), (2026, 10), (2026, 11)),
        )

    def test_starts_at_the_later_of_the_tracking_start_and_the_tenancys_first_month(self):
        self.assertEqual(
            self.scheduled(start_date=date(2026, 8, 20), rent_due_day=20),
            months((2026, 8), (2026, 9)),
        )

    def test_nothing_after_the_tenancy_ends(self):
        self.assertEqual(
            self.scheduled(end_date=date(2026, 8, 5)), months((2026, 7), (2026, 8))
        )

    def test_nothing_while_the_property_doesnt_track_rent(self):
        self.prop.rent_tracking_start = None
        self.assertEqual(self.scheduled(), [])


class EnsurePeriodsTests(TestCase):
    def setUp(self):
        self.prop = make_property()
        self.prop.rent_tracking_start = date(2026, 9, 1)
        self.prop.save()

    def periods(self, tenancy):
        return list(
            RentalPeriod.objects.filter(tenancy=tenancy)
            .order_by("period_month")
            .values_list("period_month", "payment_timing", "due_day", "due_date")
        )

    def test_creates_each_month_once_whenever_it_runs(self):
        tenancy = make_tenancy(self.prop, rent_due_day=31)

        today = date(2026, 10, 25)
        ensure_periods(tenancy, today)
        ensure_periods(tenancy, today)
        ensure_property_periods(self.prop, today)

        # A due day of 31 falls on 31 October for September (October has 31 days).
        self.assertEqual(
            self.periods(tenancy), [(date(2026, 9, 1), "postpaid", 31, date(2026, 10, 31))]
        )

    def test_a_short_month_moves_the_due_date_to_its_last_day(self):
        tenancy = make_tenancy(self.prop, rent_due_day=31)

        ensure_periods(tenancy, date(2026, 11, 30))

        self.assertEqual(
            self.periods(tenancy)[1], (date(2026, 10, 1), "postpaid", 31, date(2026, 11, 30))
        )

    def test_catches_up_after_downtime(self):
        tenancy = make_tenancy(self.prop, rent_due_day=11)

        # Nothing read the dashboard from September until January.
        ensure_property_periods(self.prop, date(2027, 1, 12))

        self.assertEqual(
            [period[0] for period in self.periods(tenancy)],
            months((2026, 9), (2026, 10), (2026, 11), (2026, 12)),
        )

    def test_covers_every_tenancy_of_the_property_and_no_other(self):
        zahid = make_tenancy(self.prop, rent_due_day=11)
        yusuf = make_tenancy(self.prop, name="Mohammed Yusuf", flat_number="301")
        elsewhere = make_tenancy(make_property(name="Property B"), flat_number="101")

        ensure_property_periods(self.prop, TODAY)

        self.assertEqual(len(self.periods(zahid)), 1)
        self.assertEqual(len(self.periods(yusuf)), 1)
        self.assertEqual(self.periods(elsewhere), [])

    def test_leaves_an_existing_period_as_it_is(self):
        tenancy = make_tenancy(self.prop, rent_due_day=11)
        make_entry(tenancy, make_user(), month=date(2026, 9, 1))
        RentalPeriod.objects.filter(tenancy=tenancy).update(due_date=date(2026, 10, 5))

        ensure_periods(tenancy, TODAY)

        self.assertEqual(self.periods(tenancy)[0][3], date(2026, 10, 5))


@mock.patch("billing.periods.business_date", return_value=TODAY)
class FreezeBeforeChangeTests(TestCase):
    def setUp(self):
        self.prop = make_property()
        self.prop.rent_tracking_start = date(2026, 8, 1)
        self.prop.save()
        self.tenancy = make_tenancy(self.prop, rent_due_day=15)

    def due_dates(self):
        return dict(
            RentalPeriod.objects.filter(tenancy=self.tenancy).values_list(
                "period_month", "due_date"
            )
        )

    def test_a_due_day_change_keeps_the_months_already_due(self, _today):
        # No dashboard has run yet: August and September (due 15 Sep, 15 Oct) are due on the
        # 15th whatever happens next.
        self.tenancy.rent_due_day = 1
        self.tenancy.save()

        ensure_periods(self.tenancy, date(2026, 10, 28))

        self.assertEqual(
            self.due_dates(),
            {
                date(2026, 8, 1): date(2026, 9, 15),
                date(2026, 9, 1): date(2026, 10, 15),
                # October was created after the change: due 1 November.
                date(2026, 10, 1): date(2026, 11, 1),
            },
        )

    def test_a_payment_timing_change_keeps_the_months_already_due(self, _today):
        self.prop.payment_timing = PaymentTiming.PREPAID
        self.prop.save()

        self.assertEqual(
            self.due_dates(),
            {date(2026, 8, 1): date(2026, 9, 15), date(2026, 9, 1): date(2026, 10, 15)},
        )

    def test_other_changes_create_nothing(self, _today):
        self.tenancy.name = "Shaik Zahid"
        self.tenancy.save()
        self.prop.name = "Saleem Towers"
        self.prop.save()

        self.assertEqual(self.due_dates(), {})
