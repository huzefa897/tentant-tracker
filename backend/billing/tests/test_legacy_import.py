import copy
import json
import uuid
import tempfile
from datetime import date
from decimal import Decimal
from io import StringIO
from pathlib import Path

from django.core.management import CommandError, call_command
from django.test import TestCase

from billing.legacy_import import import_ledger
from billing.legacy_ledger import LedgerError, parse_ledger, parse_mapping
from billing.models import LegacyRecord, Payment, Receipt, RentEntry
from billing.services import record_payment

from .factories import make_property, make_tenancy, make_user
from .test_payments_api import TODAY, make_entry, make_payment


def payment(source_id, amount, paid_date, reference=None, issued=None):
    data = {"sourceId": source_id, "amount": amount, "paidDate": paid_date, "notes": ""}
    if reference:
        data["receipt"] = {"reference": reference, "issuedDate": issued or paid_date}
    return data


def bill(source_id, month, payments=(), rent="15000.00", units="75", water="300.00"):
    # ₹15,000 + 75 × ₹6 + ₹300 = ₹15,750 with the defaults.
    return {
        "sourceId": source_id,
        "billingMonth": month,
        "rentAmount": rent,
        "electricityUnits": units,
        "electricityRate": "6.00",
        "waterAmount": water,
        "notes": "",
        "payments": list(payments),
    }


def ledger_data():
    return {
        "format": "rent-tracker-ledger",
        "version": 1,
        "source": "google-sheet",
        "tenants": [
            {
                "sourceId": "Tenant A",
                "name": "Tenant A",
                "bills": [
                    bill(
                        "Tenant A/2026-08",
                        "2026-08",
                        [
                            payment(
                                "Tenant A/2026-08/payment",
                                "15750.00",
                                "2026-08-16",
                                "RCP-202-202608",
                            )
                        ],
                    ),
                    # Part paid, after September's receipt was issued.
                    bill(
                        "Tenant A/2026-09",
                        "2026-09",
                        [
                            payment(
                                "Tenant A/2026-09/payment",
                                "5000.00",
                                "2026-09-20",
                                "RCP-202-202609",
                            )
                        ],
                        rent="16000.00",
                    ),
                ],
            }
        ],
    }


def parse(data):
    return parse_ledger(data, today=TODAY)


class ParseLedgerTests(TestCase):
    def test_reads_bills_payments_and_receipts(self):
        ledger = parse(ledger_data())

        august = ledger.tenants[0].bills[0]
        self.assertEqual(august.billing_month, date(2026, 8, 1))
        self.assertEqual(august.electricity_units, Decimal("75.000"))
        self.assertEqual(august.total_due, Decimal("15750.00"))
        self.assertEqual(august.payments[0].receipt.reference, "RCP-202-202608")

    def test_reports_every_problem_at_once(self):
        data = ledger_data()
        august, september = data["tenants"][0]["bills"]
        august["rentAmount"] = 15000  # a JSON number, not a string
        august["waterAmount"] = "-1.00"
        august["electricityUnits"] = "1.0001"
        september["billingMonth"] = "2026-08"
        september["payments"][0]["paidDate"] = "2026-10-08"  # after TODAY

        with self.assertRaises(LedgerError) as raised:
            parse(data)

        problems = "\n".join(raised.exception.problems)
        self.assertIn('rentAmount must be a decimal in quotes', problems)
        self.assertIn("waterAmount can't be negative", problems)
        self.assertIn("electricityUnits 1.0001 has more than 3 decimal places", problems)
        self.assertIn("2026-08 appears twice for this tenant", problems)
        self.assertIn("paidDate 2026-10-08 is in the future", problems)

    def test_refuses_payments_adding_up_to_more_than_the_bill(self):
        data = ledger_data()
        data["tenants"][0]["bills"][0]["payments"].append(
            payment("Tenant A/2026-08/extra", "1.00", "2026-08-20")
        )

        with self.assertRaises(LedgerError) as raised:
            parse(data)

        self.assertIn(
            "payments total 15751.00 but the bill is 15750.00", raised.exception.problems[0]
        )

    def test_refuses_reused_source_ids_and_receipt_references(self):
        data = ledger_data()
        september = data["tenants"][0]["bills"][1]
        september["sourceId"] = "Tenant A/2026-08"
        september["payments"][0]["receipt"]["reference"] = "RCP-202-202608"

        with self.assertRaises(LedgerError) as raised:
            parse(data)

        problems = "\n".join(raised.exception.problems)
        self.assertIn("sourceId 'Tenant A/2026-08' is used more than once", problems)
        self.assertIn("receipt 'RCP-202-202608' is used more than once", problems)

    def test_refuses_a_receipt_issued_before_its_payment(self):
        data = ledger_data()
        data["tenants"][0]["bills"][0]["payments"][0]["receipt"]["issuedDate"] = "2026-08-15"

        with self.assertRaises(LedgerError) as raised:
            parse(data)

        self.assertIn("the receipt was issued before the payment", raised.exception.problems[0])

    def test_refuses_other_files(self):
        with self.assertRaises(LedgerError):
            parse({"tenants": []})

    def test_mapping_needs_tenancy_ids(self):
        with self.assertRaises(LedgerError) as raised:
            parse_mapping({"Tenant A": "flat 202"})

        self.assertIn("isn't a tenancy id", raised.exception.problems[0])


class ImportLedgerTests(TestCase):
    def setUp(self):
        self.user = make_user(name="Imran Khan")
        self.property = make_property(name="Saleem Towers", member=self.user)
        self.tenancy = make_tenancy(self.property)
        self.mapping = {"Tenant A": self.tenancy.pk}

    def run_import(self, data=None, *, dry_run=False, mapping=None):
        return import_ledger(
            parse(data or ledger_data()),
            mapping or self.mapping,
            imported_by=self.user,
            dry_run=dry_run,
        )

    def test_imports_bills_payments_and_receipts_with_their_history(self):
        report = self.run_import()

        self.assertTrue(report.saved)
        self.assertEqual(report.created, {"bill": 2, "payment": 2, "receipt": 2})
        september = RentEntry.objects.get(billing_month=date(2026, 9, 1))
        # Historical rent, not the tenancy's current ₹15,000.
        self.assertEqual(september.rent_amount, Decimal("16000.00"))
        self.assertEqual(september.payments.get().paid_date, date(2026, 9, 20))

    def test_keeps_receipt_references_and_snapshots_them_as_issued(self):
        self.run_import()

        receipt = Receipt.objects.get(reference="RCP-202-202609")
        self.assertEqual(receipt.issued_date, date(2026, 9, 20))
        self.assertEqual(receipt.total_due, Decimal("16750.00"))
        self.assertEqual(receipt.outstanding_amount, Decimal("11750.00"))
        # August was paid in full on 16 August, before this receipt.
        self.assertEqual(receipt.previous_month_outstanding, Decimal("0.00"))
        self.assertEqual(receipt.issuer_name, "Saleem Towers")
        self.assertEqual(receipt.property, self.property)

    def part_paid_august(self):
        data = ledger_data()
        data["tenants"][0]["bills"][0]["payments"][0]["amount"] = "10000.00"
        return data

    def test_snapshots_what_last_month_still_owed(self):
        self.run_import(self.part_paid_august())

        receipt = Receipt.objects.get(reference="RCP-202-202609")
        # ₹15,750 billed for August, ₹10,000 paid by 20 September.
        self.assertEqual(receipt.previous_month_outstanding, Decimal("5750.00"))

    def test_snapshots_last_month_whatever_order_the_file_lists_the_bills_in(self):
        data = self.part_paid_august()
        data["tenants"][0]["bills"].reverse()

        self.run_import(data)

        receipt = Receipt.objects.get(reference="RCP-202-202609")
        self.assertEqual(receipt.previous_month_outstanding, Decimal("5750.00"))

    def test_reconciles_the_source_with_the_database(self):
        report = self.run_import()

        self.assertTrue(report.reconciled)
        self.assertIn(("total billed", "32500.00", "32500.00"), report.reconciliation)
        self.assertIn(("total paid", "20750.00", "20750.00"), report.reconciliation)

    def test_a_dry_run_checks_everything_and_saves_nothing(self):
        report = self.run_import(dry_run=True)

        self.assertEqual(report.created["bill"], 2)
        self.assertTrue(report.reconciled)
        self.assertFalse(report.saved)
        self.assertFalse(RentEntry.objects.exists())
        self.assertFalse(LegacyRecord.objects.exists())

    def test_rerunning_creates_nothing_twice(self):
        self.run_import()

        report = self.run_import()

        self.assertEqual(sum(report.created.values()), 0)
        self.assertEqual(report.already, {"bill": 2, "payment": 2, "receipt": 2})
        self.assertEqual(RentEntry.objects.count(), 2)
        self.assertEqual(Payment.objects.count(), 2)
        self.assertEqual(Receipt.objects.count(), 2)

    def test_a_rerun_adds_only_new_records(self):
        self.run_import()
        data = ledger_data()
        data["tenants"][0]["bills"][1]["payments"].append(
            payment("Tenant A/2026-09/payment-2", "1000.00", "2026-09-25")
        )

        report = self.run_import(data)

        self.assertEqual(report.created, {"payment": 1})
        self.assertEqual(Payment.objects.count(), 3)

    def test_numbers_payments_in_paid_order_after_any_already_recorded(self):
        data = ledger_data()
        # Listed out of order in the file.
        data["tenants"][0]["bills"][1]["payments"].insert(
            0, payment("Tenant A/2026-09/payment-late", "1000.00", "2026-09-25")
        )

        self.run_import(data)

        september = RentEntry.objects.get(billing_month=date(2026, 9, 1))
        self.assertEqual(
            list(september.payments.order_by("sequence").values_list("paid_date", "sequence")),
            [(date(2026, 9, 20), 1), (date(2026, 9, 25), 2)],
        )
        # A payment recorded in the app afterwards comes next.
        recorded = record_payment(
            entry_id=september.pk,
            actor=self.user,
            idempotency_key=uuid.uuid4(),
            validated_data={"amount": Decimal("100.00"), "paid_date": date(2026, 9, 30)},
        )
        self.assertEqual(recorded.payment.sequence, 3)

    def test_refuses_a_record_changed_since_it_was_imported(self):
        self.run_import()
        data = ledger_data()
        data["tenants"][0]["bills"][0]["payments"][0]["amount"] = "15000.00"

        report = self.run_import(data)

        self.assertFalse(report.saved)
        self.assertIn("changed since it was imported", report.rejected[0])
        self.assertEqual(Payment.objects.get(entry__billing_month=date(2026, 8, 1)).amount, 15750)

    def test_refuses_a_month_with_a_bill_made_in_the_app_and_imports_nothing(self):
        make_entry(self.tenancy, self.user, month=date(2026, 9, 1))

        report = self.run_import()

        self.assertFalse(report.saved)
        self.assertIn("already has a September 2026 bill", report.rejected[0])
        # All or nothing: August wasn't imported either.
        self.assertEqual(RentEntry.objects.count(), 1)
        self.assertFalse(LegacyRecord.objects.exists())

    def test_refuses_unmapped_tenants_and_missing_tenancies(self):
        data = ledger_data()
        data["tenants"].append({"sourceId": "Tenant B", "name": "", "bills": []})
        missing = make_tenancy(make_property(name="Other"), start_date=date(2026, 1, 1))
        missing_id = missing.pk
        missing.delete()

        report = self.run_import(data, mapping={"Tenant A": missing_id})

        self.assertEqual(len(report.rejected), 2)
        self.assertIn("'Tenant B': not in the mapping file", report.rejected[0])
        self.assertIn("doesn't exist", report.rejected[1])

    def test_refuses_months_outside_the_tenancy(self):
        self.tenancy.start_date = date(2026, 9, 1)
        self.tenancy.save()

        report = self.run_import()

        self.assertIn("2026-08 is outside the tenancy's dates", report.rejected[0])
        self.assertFalse(RentEntry.objects.exists())

    def test_counts_payments_recorded_in_the_app_since_an_earlier_import(self):
        self.run_import()
        september = RentEntry.objects.get(billing_month=date(2026, 9, 1))
        make_payment(september, self.user, "11000.00", paid_date=date(2026, 9, 30))
        data = ledger_data()
        data["tenants"][0]["bills"][1]["payments"].append(
            payment("Tenant A/2026-09/payment-2", "1000.00", "2026-10-01")
        )

        report = self.run_import(data)

        self.assertIn("more than the bill's outstanding 750.00", report.rejected[0])

    def test_does_not_reconcile_a_bill_with_payments_recorded_in_the_app(self):
        self.run_import()
        september = RentEntry.objects.get(billing_month=date(2026, 9, 1))
        make_payment(september, self.user, "500.00", paid_date=date(2026, 9, 30))
        data = ledger_data()
        # Fits what's left (₹11,250), but may be the same money as the app's payment.
        data["tenants"][0]["bills"][1]["payments"].append(
            payment("Tenant A/2026-09/payment-2", "200.00", "2026-10-01")
        )

        report = self.run_import(data)

        self.assertEqual(report.rejected, [])
        self.assertFalse(report.reconciled)
        self.assertFalse(report.saved)
        self.assertIn(
            ("bills with payments not from this source", "0", "1 (Tenant A/2026-09)"),
            report.reconciliation,
        )
        # The ledger says ₹5,200 paid; the database has ₹5,500 without the new payment.
        self.assertIn(("total paid", "20950.00", "21450.00"), report.reconciliation)
        self.assertEqual(september.payments.count(), 2)

    def test_refuses_a_receipt_reference_already_in_use(self):
        self.run_import()
        data = ledger_data()
        data["tenants"][0]["sourceId"] = "Tenant A again"
        for b in data["tenants"][0]["bills"]:
            b["sourceId"] += " again"
            b["billingMonth"] = b["billingMonth"].replace("2026", "2025")
            for p in b["payments"]:
                p["sourceId"] += " again"
                p["paidDate"] = p["paidDate"].replace("2026", "2025")
                p["receipt"]["issuedDate"] = p["paidDate"]
        self.tenancy.start_date = date(2025, 1, 1)
        self.tenancy.save()

        report = self.run_import(data, mapping={"Tenant A again": self.tenancy.pk})

        self.assertIn(
            "another receipt of this property already has this reference", report.rejected[0]
        )

    def test_references_only_need_to_be_free_within_the_property(self):
        self.run_import()
        other = make_tenancy(make_property(name="Property B", member=self.user))
        data = ledger_data()
        data["tenants"][0]["sourceId"] = "Tenant B"
        for b in data["tenants"][0]["bills"]:
            b["sourceId"] = b["sourceId"].replace("Tenant A", "Tenant B")
            for p in b["payments"]:
                p["sourceId"] = p["sourceId"].replace("Tenant A", "Tenant B")

        report = self.run_import(data, mapping={"Tenant B": other.pk})

        self.assertTrue(report.saved)
        receipts = Receipt.objects.filter(reference="RCP-202-202609")
        self.assertEqual(
            sorted(receipts.values_list("property__name", flat=True)),
            ["Property B", "Saleem Towers"],
        )

    def test_refuses_receipts_until_the_property_is_configured(self):
        self.property.address = ""
        self.property.save()

        report = self.run_import()

        self.assertIn("Configure the property address", report.rejected[0])
        self.assertFalse(RentEntry.objects.exists())


class ImportLedgerCommandTests(TestCase):
    def setUp(self):
        self.user = make_user(username="owner", name="Imran Khan")
        self.tenancy = make_tenancy(make_property(name="Saleem Towers", member=self.user))
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.ledger = Path(folder.name, "ledger.json")
        self.ledger.write_text(json.dumps(ledger_data()))
        self.mapping = Path(folder.name, "map.json")
        self.mapping.write_text(json.dumps({"Tenant A": str(self.tenancy.pk)}))

    def call(self, *extra):
        out, err = StringIO(), StringIO()
        call_command(
            "import_legacy_ledger",
            str(self.ledger),
            "--mapping",
            str(self.mapping),
            "--imported-by",
            "owner",
            *extra,
            stdout=out,
            stderr=err,
        )
        return out.getvalue()

    def test_reports_a_dry_run(self):
        output = self.call("--dry-run")

        self.assertRegex(output, r"bills +2 +0\n")
        self.assertRegex(output, r"total paid +20750.00 / 20750.00 +ok")
        self.assertIn("Dry run: nothing was saved.", output)
        self.assertFalse(RentEntry.objects.exists())

    def test_imports(self):
        self.assertIn("Imported.", self.call())
        self.assertEqual(RentEntry.objects.count(), 2)

    def test_fails_with_the_problems_listed(self):
        data = copy.deepcopy(ledger_data())
        data["tenants"][0]["bills"][0]["billingMonth"] = "August"
        self.ledger.write_text(json.dumps(data))

        with self.assertRaisesMessage(CommandError, "1 problem(s); nothing was imported"):
            self.call()

    def test_fails_on_rejected_records(self):
        make_entry(self.tenancy, self.user, month=date(2026, 8, 1))

        with self.assertRaisesMessage(CommandError, "Nothing was imported"):
            self.call()

    def test_needs_an_existing_user(self):
        self.mapping.write_text(json.dumps({"Tenant A": str(self.tenancy.pk)}))
        with self.assertRaisesMessage(CommandError, "There's no user 'nobody'"):
            call_command(
                "import_legacy_ledger",
                str(self.ledger),
                "--mapping",
                str(self.mapping),
                "--imported-by",
                "nobody",
                stdout=StringIO(),
            )
