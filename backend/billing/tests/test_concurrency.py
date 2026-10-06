import threading
from datetime import date
from decimal import Decimal
from unittest import mock

from django.db import connection
from django.test import TransactionTestCase, skipUnlessDBFeature

from billing.models import RentEntry
from billing.services import DuplicateBillingMonthError, create_rent_entry

from .factories import make_property, make_tenancy, make_user


@skipUnlessDBFeature("has_select_for_update")
class ConcurrentRentEntryTests(TransactionTestCase):
    """Real transactions on separate connections, so this needs PostgreSQL: SQLite wouldn't
    exercise the same row locking."""

    def setUp(self):
        self.user = make_user()
        self.tenancy = make_tenancy(make_property(member=self.user))

    def create_simultaneously(self, count, month=date(2026, 10, 1)):
        barrier = threading.Barrier(count)
        outcomes = []
        lock = threading.Lock()

        def create():
            try:
                barrier.wait()
                create_rent_entry(
                    tenancy=self.tenancy,
                    actor=self.user,
                    validated_data={
                        "billing_month": month,
                        "electricity_units": Decimal("75.000"),
                        "water_amount": Decimal("300.00"),
                    },
                )
                outcome = "created"
            except DuplicateBillingMonthError:
                outcome = "duplicate"
            except Exception as error:  # noqa: BLE001 - reported by the assertion below
                outcome = repr(error)
            finally:
                connection.close()
            with lock:
                outcomes.append(outcome)

        threads = [threading.Thread(target=create) for _ in range(count)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
        return outcomes

    def test_only_one_of_several_simultaneous_bills_for_a_month_is_saved(self):
        outcomes = self.create_simultaneously(5)

        self.assertEqual(sorted(outcomes), ["created"] + ["duplicate"] * 4)
        self.assertEqual(RentEntry.objects.filter(tenancy=self.tenancy).count(), 1)

    def test_the_unique_constraint_decides_when_the_check_misses_a_duplicate(self):
        # As if every request checked before any had saved: the insert itself must refuse.
        with mock.patch("billing.services.RentEntry.objects.filter") as filter_:
            filter_.return_value.exists.return_value = False
            outcomes = self.create_simultaneously(3)

        self.assertEqual(sorted(outcomes), ["created", "duplicate", "duplicate"])
        self.assertEqual(RentEntry.objects.filter(tenancy=self.tenancy).count(), 1)
