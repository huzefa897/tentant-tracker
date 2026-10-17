import uuid
from datetime import date
from decimal import Decimal
from unittest import mock

from django.db import connection
from django.db.migrations.exceptions import IrreversibleError
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

from billing.models import Receipt, RentalPeriod, RentEntry
from properties.models import Property
from billing.services import (
    issue_payment_receipt,
    record_payment,
    reverse_payment,
    void_rent_entry,
)

from .factories import make_property, make_tenancy, make_user

BEFORE_PER_PROPERTY = [("billing", "0005_payment_sequence")]
REFERENCE = "Shaik_Zahid_Ali_202_Rent_September 2026"


def issue_in_new_property(user, name, role="manager"):
    tenancy = make_tenancy(make_property(name=name, member=user, role=role))
    entry = RentEntry.objects.create(
        tenancy=tenancy,
        billing_month=date(2026, 9, 1),
        rent_amount=Decimal("15000.00"),
        electricity_units=Decimal("75.000"),
        electricity_rate=Decimal("6.00"),
        water_amount=Decimal("300.00"),
        created_by=user,
    )
    payment = record_payment(
        entry_id=entry.pk,
        actor=user,
        idempotency_key=uuid.uuid4(),
        validated_data={
            "amount": Decimal("1000.00"),
            "paid_date": date(2026, 10, 5),
            "notes": "",
        },
    ).payment
    return issue_payment_receipt(payment_id=payment.pk, actor=user).receipt


class ReceiptReferencePerPropertyRollbackTests(TransactionTestCase):
    """Undoing billing.0006 makes receipt references unique across every property again."""

    def setUp(self):
        self.user = make_user()

    def tearDown(self):
        # Back to the latest migrations, whatever the test left behind.
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def migrate_back(self):
        MigrationExecutor(connection).migrate(BEFORE_PER_PROPERTY)

    def test_rolling_back_stops_and_names_a_reference_two_properties_share(self):
        issue_in_new_property(self.user, "Property A")
        issue_in_new_property(self.user, "Property B")

        with self.assertRaisesMessage(IrreversibleError, REFERENCE):
            self.migrate_back()

        # Nothing was renumbered.
        self.assertEqual(
            list(Receipt.objects.values_list("reference", flat=True)), [REFERENCE, REFERENCE]
        )

    def test_rolling_back_works_while_every_reference_is_unique(self):
        issue_in_new_property(self.user, "Property A")

        self.migrate_back()

        with connection.cursor() as cursor:
            table = connection.introspection.get_table_description(cursor, "billing_receipt")
        columns = [column.name for column in table]
        self.assertNotIn("property_id", columns)


class PaymentReversalRollbackTests(TransactionTestCase):
    """Undoing billing.0008 would drop reversals and void details, so reversed payments would
    count again."""

    def setUp(self):
        self.user = make_user()
        self.receipt = issue_in_new_property(self.user, "Property A", role="owner")

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def migrate_back(self):
        MigrationExecutor(connection).migrate([("billing", "0007_legacy_records")])

    def test_rolling_back_stops_while_a_payment_is_reversed(self):
        reverse_payment(payment_id=self.receipt.payment_id, actor=self.user, reason="Mistake")

        with self.assertRaisesMessage(IrreversibleError, "1 payment reversal(s) and 1 void"):
            self.migrate_back()

        self.assertTrue(Receipt.objects.filter(voided_at__isnull=False).exists())

    def test_rolling_back_works_without_corrections(self):
        self.migrate_back()

        with connection.cursor() as cursor:
            tables = connection.introspection.table_names(cursor)
        self.assertNotIn("billing_paymentreversal", tables)


class BillVoidRollbackTests(TransactionTestCase):
    """Undoing billing.0009 would drop the bills' status, so void bills would count again."""

    def setUp(self):
        self.user = make_user()
        self.receipt = issue_in_new_property(self.user, "Property A", role="owner")
        self.entry = self.receipt.payment.entry

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def migrate_back(self):
        MigrationExecutor(connection).migrate(
            [("billing", "0008_payment_reversal_and_receipt_void")]
        )

    def test_rolling_back_stops_while_a_bill_is_void(self):
        reverse_payment(payment_id=self.receipt.payment_id, actor=self.user, reason="Mistake")
        void_rent_entry(entry_id=self.entry.pk, actor=self.user, reason="Entered twice")

        with self.assertRaisesMessage(IrreversibleError, "1 void bill(s)"):
            self.migrate_back()

        # Only the status: the rollback undid the later migrations' columns before it stopped.
        status = RentEntry.objects.filter(pk=self.entry.pk).values_list("status", flat=True)
        self.assertEqual(status.get(), "void")

    def test_rolling_back_works_without_void_bills(self):
        self.migrate_back()

        with connection.cursor() as cursor:
            table = connection.introspection.get_table_description(cursor, "billing_rententry")
        self.assertNotIn("status", [column.name for column in table])


class ReceiptAuthorizedByBackfillTests(TransactionTestCase):
    """billing.0010 copies each existing receipt's received-by name, until then the issuing
    person's, as its authorized-by name, so receipts already issued print as they did."""

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_existing_receipts_keep_their_issuer_as_authorized_by(self):
        receipt = issue_in_new_property(make_user(name="Imran Khan"), "Property A", role="owner")
        Receipt.objects.filter(pk=receipt.pk).update(received_by_name="Issued By Then")

        MigrationExecutor(connection).migrate([("billing", "0009_bill_void_and_replacement")])
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

        receipt.refresh_from_db()
        self.assertEqual(receipt.authorized_by_name, "Issued By Then")
        self.assertEqual(receipt.received_by_name, "Issued By Then")


class RentalPeriodBackfillTests(TransactionTestCase):
    """billing.0012 gives every month that has a bill, void or not, its rental period, from the
    property's timing and the tenancy's due day as they are when it runs."""

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def bill(self, tenancy, user, month, **fields):
        return RentEntry.objects.create(
            tenancy=tenancy,
            billing_month=month,
            rent_amount=Decimal("15000.00"),
            electricity_units=Decimal("75.000"),
            electricity_rate=Decimal("6.00"),
            water_amount=Decimal("300.00"),
            created_by=user,
            **fields,
        )

    def test_each_billed_month_gets_one_period(self):
        user = make_user()
        prop = make_property()
        tenancy = make_tenancy(prop, rent_due_day=31)
        self.bill(
            tenancy,
            user,
            date(2027, 1, 1),
            status="void",
            voided_at="2027-02-01T10:00:00Z",
            voided_by=user,
            void_reason="Entered twice",
        )
        self.bill(tenancy, user, date(2027, 1, 1))
        self.bill(tenancy, user, date(2027, 2, 1))

        MigrationExecutor(connection).migrate([("billing", "0010_receipt_authorized_by")])
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

        self.assertEqual(
            list(
                RentalPeriod.objects.order_by("period_month").values_list(
                    "tenancy_id", "period_month", "payment_timing", "due_day", "due_date"
                )
            ),
            [
                (tenancy.pk, date(2027, 1, 1), "postpaid", 31, date(2027, 2, 28)),
                (tenancy.pk, date(2027, 2, 1), "postpaid", 31, date(2027, 3, 31)),
            ],
        )


class RentTrackingCutOffBackfillTests(TransactionTestCase):
    """properties.0006 makes an empty cut-off mean every tenancy's months are owed, so the
    properties that exist when it runs get this month as their cut-off: months before it still
    count only with a bill. One that already has a cut-off keeps it."""

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_existing_properties_are_cut_off_at_this_month(self):
        make_property(name="Property A")
        tracked = make_property(name="Property B")
        Property.objects.filter(pk=tracked.pk).update(rent_tracking_start=date(2026, 3, 1))

        MigrationExecutor(connection).migrate([("properties", "0005_due_dates")])
        executor = MigrationExecutor(connection)
        with mock.patch("django.utils.timezone.localdate", return_value=date(2026, 10, 17)):
            executor.migrate(executor.loader.graph.leaf_nodes())

        self.assertEqual(
            dict(Property.objects.values_list("name", "rent_tracking_start")),
            {"Property A": date(2026, 10, 1), "Property B": date(2026, 3, 1)},
        )
