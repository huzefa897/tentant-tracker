import threading
import uuid
from datetime import date
from decimal import Decimal
from unittest import mock

from django.db import connection
from django.test import TransactionTestCase, skipUnlessDBFeature

from billing.calculations import entry_amounts
from billing.models import Payment, Receipt, RentEntry
from billing.services import (
    DuplicateBillingMonthError,
    create_rent_entry,
    issue_payment_receipt,
    record_payment,
)

from properties.models import Tenancy

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
        self.assertEqual(
            sorted(self.entry.payments.values_list("sequence", flat=True)), [1, 2, 3]
        )

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


@skipUnlessDBFeature("has_select_for_update")
class ConcurrentReceiptTests(TransactionTestCase):
    """Simultaneous issuance on separate connections: the payment's row lock (and its unique
    receipt column behind it) must leave exactly one receipt."""

    def setUp(self):
        self.user = make_user()
        self.tenancy = make_tenancy(make_property(member=self.user))
        entry = make_bill(self.tenancy, self.user)
        self.payment = record_payment(
            entry_id=entry.pk, actor=self.user, idempotency_key=uuid.uuid4(), validated_data=PAYMENT
        ).payment

    def issue(self, _):
        result = issue_payment_receipt(payment_id=self.payment.pk, actor=self.user)
        return ("created" if result.created else "returned", result.receipt.reference)

    def test_simultaneous_requests_issue_one_receipt(self):
        outcomes = run_simultaneously(4, self.issue)

        self.assertEqual(sorted(o[0] for o in outcomes), ["created"] + ["returned"] * 3)
        self.assertEqual(len({o[1] for o in outcomes}), 1)
        self.assertEqual(Receipt.objects.count(), 1)

    def test_the_unique_column_decides_when_both_reach_the_insert(self):
        # As if both found no receipt before either saved: the insert itself must refuse.
        with mock.patch("billing.services.Receipt.objects.filter") as filter_:
            filter_.return_value.first.return_value = None
            outcomes = run_simultaneously(2, self.issue)

        self.assertEqual(sorted(o[0] for o in outcomes), ["created", "returned"])
        self.assertEqual(Receipt.objects.count(), 1)

    def test_a_bills_receipts_issued_at_once_get_distinct_references(self):
        payments = [self.payment] + [
            record_payment(
                entry_id=self.payment.entry_id,
                actor=self.user,
                idempotency_key=uuid.uuid4(),
                validated_data={**PAYMENT, "amount": Decimal("1000.00")},
            ).payment
            for _ in range(2)
        ]

        def issue(i):
            return issue_payment_receipt(payment_id=payments[i].pk, actor=self.user).receipt

        outcomes = run_simultaneously(3, lambda i: issue(i).reference)

        self.assertEqual(
            sorted(outcomes),
            [
                "Shaik_Zahid_Ali_202_Rent_September 2026",
                "Shaik_Zahid_Ali_202_Rent_September 2026_2",
                "Shaik_Zahid_Ali_202_Rent_September 2026_3",
            ],
        )

    def test_properties_issue_the_same_reference_at_once_without_retrying(self):
        # Five properties, each with a Shaik Zahid Ali in flat 202 paying for September.
        payments = [self.payment]
        for i in range(4):
            prop = make_property(name=f"Property {i}", member=self.user)
            entry = make_bill(make_tenancy(prop), self.user)
            payments.append(
                record_payment(
                    entry_id=entry.pk,
                    actor=self.user,
                    idempotency_key=uuid.uuid4(),
                    validated_data=PAYMENT,
                ).payment
            )

        def issue(i):
            result = issue_payment_receipt(payment_id=payments[i].pk, actor=self.user)
            return ("created" if result.created else "returned", result.receipt.reference)

        outcomes = run_simultaneously(5, issue)

        self.assertEqual(
            outcomes, [("created", "Shaik_Zahid_Ali_202_Rent_September 2026")] * 5
        )
        self.assertEqual(Receipt.objects.values("property").distinct().count(), 5)

    def test_one_propertys_bills_issued_at_once_get_distinct_references(self):
        # The same name and flat on two tenancies that both cover September, so two bills.
        prop = self.tenancy.property
        Tenancy.objects.filter(pk=self.tenancy.pk).update(end_date=date(2026, 9, 10))
        later = make_tenancy(prop, start_date=date(2026, 9, 11))
        entry = make_bill(later, self.user)
        payments = [
            self.payment,
            record_payment(
                entry_id=entry.pk,
                actor=self.user,
                idempotency_key=uuid.uuid4(),
                validated_data=PAYMENT,
            ).payment,
        ]

        outcomes = run_simultaneously(
            2,
            lambda i: issue_payment_receipt(payment_id=payments[i].pk, actor=self.user)
            .receipt.reference,
        )

        self.assertEqual(
            sorted(outcomes),
            [
                "Shaik_Zahid_Ali_202_Rent_September 2026",
                "Shaik_Zahid_Ali_202_Rent_September 2026_2",
            ],
        )
