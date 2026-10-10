import uuid
from datetime import date
from decimal import Decimal

from django.db import connection
from django.db.migrations.exceptions import IrreversibleError
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

from billing.models import Receipt, RentEntry
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

        self.assertEqual(RentEntry.objects.get(pk=self.entry.pk).status, "void")

    def test_rolling_back_works_without_void_bills(self):
        self.migrate_back()

        with connection.cursor() as cursor:
            table = connection.introspection.get_table_description(cursor, "billing_rententry")
        self.assertNotIn("status", [column.name for column in table])
