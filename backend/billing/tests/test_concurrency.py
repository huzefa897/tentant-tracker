import threading
import uuid
from datetime import date
from decimal import Decimal
from unittest import mock

from django.db import connection
from django.test import TransactionTestCase, skipUnlessDBFeature

from billing.calculations import entry_amounts
from billing.models import Payment, RentEntry
from billing.services import DuplicateBillingMonthError, create_rent_entry, record_payment

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


def run_simultaneously(count, action):
    """Runs action(index) on `count` threads released together, each on its own database
    connection, and returns their outcomes (a value, or the exception's class name)."""
    barrier = threading.Barrier(count)
    outcomes = [None] * count

    def run(index):
        try:
            barrier.wait()
            outcomes[index] = action(index)
        except Exception as error:  # noqa: BLE001 - reported by the assertions
            outcomes[index] = type(error).__name__
        finally:
            connection.close()

    threads = [threading.Thread(target=run, args=(i,)) for i in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    return outcomes


def make_bill(tenancy, user, month=date(2026, 9, 1)):
    # ₹15,750.
    return RentEntry.objects.create(
        tenancy=tenancy,
        billing_month=month,
        rent_amount=Decimal("15000.00"),
        electricity_units=Decimal("75.000"),
        electricity_rate=Decimal("6.00"),
        water_amount=Decimal("300.00"),
        created_by=user,
    )


PAYMENT = {"amount": Decimal("10000.00"), "paid_date": date(2026, 10, 5), "notes": ""}


@skipUnlessDBFeature("has_select_for_update")
class ConcurrentPaymentTests(TransactionTestCase):
    """Payments on separate connections at the same moment: only PostgreSQL's row lock keeps
    them from overpaying the bill, so this can't be verified with mocks or SQLite."""

    def setUp(self):
        self.user = make_user()
        self.tenancy = make_tenancy(make_property(member=self.user))
        self.entry = make_bill(self.tenancy, self.user)

    def pay(self, key, entry=None, **changes):
        recorded = record_payment(
            entry_id=(entry or self.entry).pk,
            actor=self.user,
            idempotency_key=key,
            validated_data={**PAYMENT, **changes},
        )
        return "created" if recorded.created else "replayed"

    def test_simultaneous_payments_never_together_exceed_the_bill(self):
        # Each affordable alone; any two together are more than ₹15,750.
        outcomes = run_simultaneously(4, lambda _: self.pay(uuid.uuid4()))

        self.assertEqual(
            sorted(outcomes), ["PaymentExceedsOutstandingError"] * 3 + ["created"]
        )
        self.assertEqual(Payment.objects.get().amount, Decimal("10000.00"))

    def test_simultaneous_affordable_payments_all_succeed(self):
        outcomes = run_simultaneously(3, lambda _: self.pay(uuid.uuid4(), amount=Decimal("5250")))

        self.assertEqual(outcomes, ["created"] * 3)
        self.assertEqual(entry_amounts(self.entry).payment_status, "paid")

    def test_simultaneous_retries_record_the_money_once(self):
        key = uuid.uuid4()

        outcomes = run_simultaneously(4, lambda _: self.pay(key))

        self.assertEqual(sorted(outcomes), ["created"] + ["replayed"] * 3)
        self.assertEqual(Payment.objects.count(), 1)

    def test_the_key_constraint_decides_between_bills_locked_separately(self):
        october = make_bill(self.tenancy, self.user, month=date(2026, 10, 1))
        key = uuid.uuid4()
        bills = [self.entry, october]

        # As if both checked for the key before either saved: the insert itself must refuse.
        with mock.patch("billing.services.Payment.objects.filter") as filter_:
            filter_.return_value.exists.return_value = False
            outcomes = run_simultaneously(2, lambda i: self.pay(key, entry=bills[i]))

        self.assertEqual(sorted(outcomes), ["IdempotencyConflictError", "created"])
        self.assertEqual(Payment.objects.count(), 1)

    def test_the_key_constraint_returns_a_matching_payment_as_a_retry(self):
        key = uuid.uuid4()

        # Affordable twice over, so the second reaches the insert rather than the balance check.
        with mock.patch("billing.services.Payment.objects.filter") as filter_:
            filter_.return_value.exists.return_value = False
            outcomes = run_simultaneously(2, lambda _: self.pay(key, amount=Decimal("1000.00")))

        self.assertEqual(sorted(outcomes), ["created", "replayed"])
        self.assertEqual(Payment.objects.count(), 1)

    def test_simultaneous_creation_retries_make_one_bill_and_one_payment(self):
        key = uuid.uuid4()

        def create(_):
            result = create_rent_entry(
                tenancy=self.tenancy,
                actor=self.user,
                validated_data={
                    "billing_month": date(2026, 11, 1),
                    "electricity_units": Decimal("75.000"),
                    "water_amount": Decimal("300.00"),
                },
                creation_key=key,
                initial_payment=PAYMENT,
            )
            return "created" if result.created else "replayed"

        outcomes = run_simultaneously(3, create)

        self.assertEqual(sorted(outcomes), ["created", "replayed", "replayed"])
        self.assertEqual(RentEntry.objects.filter(billing_month=date(2026, 11, 1)).count(), 1)
        self.assertEqual(Payment.objects.count(), 1)
