import uuid
from datetime import date
from decimal import Decimal

from django.db import connection
from django.db.migrations.exceptions import IrreversibleError
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

from billing.models import Receipt, RentEntry
from billing.services import issue_payment_receipt, record_payment

from .factories import make_property, make_tenancy, make_user

BEFORE_PER_PROPERTY = [("billing", "0005_payment_sequence")]
REFERENCE = "Shaik_Zahid_Ali_202_Rent_September 2026"


class ReceiptReferencePerPropertyRollbackTests(TransactionTestCase):
    """Undoing billing.0006 makes receipt references unique across every property again."""

    def setUp(self):
        self.user = make_user()

    def tearDown(self):
        # Back to the latest migrations, whatever the test left behind.
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def issue_in_new_property(self, name):
        tenancy = make_tenancy(make_property(name=name, member=self.user))
        entry = RentEntry.objects.create(
            tenancy=tenancy,
            billing_month=date(2026, 9, 1),
            rent_amount=Decimal("15000.00"),
            electricity_units=Decimal("75.000"),
            electricity_rate=Decimal("6.00"),
            water_amount=Decimal("300.00"),
            created_by=self.user,
        )
        payment = record_payment(
            entry_id=entry.pk,
            actor=self.user,
            idempotency_key=uuid.uuid4(),
            validated_data={
                "amount": Decimal("1000.00"),
                "paid_date": date(2026, 10, 5),
                "notes": "",
            },
        ).payment
        return issue_payment_receipt(payment_id=payment.pk, actor=self.user).receipt

    def migrate_back(self):
        MigrationExecutor(connection).migrate(BEFORE_PER_PROPERTY)

    def test_rolling_back_stops_and_names_a_reference_two_properties_share(self):
        self.issue_in_new_property("Property A")
        self.issue_in_new_property("Property B")

        with self.assertRaisesMessage(IrreversibleError, REFERENCE):
            self.migrate_back()

        # Nothing was renumbered.
        self.assertEqual(
            list(Receipt.objects.values_list("reference", flat=True)), [REFERENCE, REFERENCE]
        )

    def test_rolling_back_works_while_every_reference_is_unique(self):
        self.issue_in_new_property("Property A")

        self.migrate_back()

        with connection.cursor() as cursor:
            table = connection.introspection.get_table_description(cursor, "billing_receipt")
        columns = [column.name for column in table]
        self.assertNotIn("property_id", columns)
