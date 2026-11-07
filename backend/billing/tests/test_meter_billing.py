"""Bills charged from the electricity meter: the units between the last billed reading and
a closing one, electricity left off (its units wait for the next meter bill), billing each
stretch once, voiding and correcting meter bills, readings bills are measured from, and the
receipts' readings. TC-nn are the spec's test cases."""

import uuid
from datetime import date
from decimal import Decimal

from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from billing.meter import (
    ClosingReadingRequiredError,
    DuplicateReadingDayError,
    InvalidReadingError,
    LaterMeterBillError,
    MeterNotSetUpError,
    ReadingAlreadyBilledError,
    ReadingInUseError,
    correct_meter_reading,
    last_billed,
    void_meter_reading,
)
from billing.models import MeterReading, Payment, Receipt, RentEntry
from billing.services import (
    ElectricityNotCorrectableError,
    PaymentExceedsOutstandingError,
    correct_rent_entry,
    create_rent_entry,
    issue_payment_receipt,
    record_payment,
    reverse_payment,
    void_rent_entry,
)

from .factories import make_tenancy, recorded_on
from .test_meter_readings import MeterTestCase, readings_url

OCTOBER, NOVEMBER, DECEMBER = date(2026, 10, 1), date(2026, 11, 1), date(2026, 12, 1)


class MeterBillTestCase(MeterTestCase):
    def bill(self, month, closing=None, include=True, reading_id=None, tenancy=None, **extra):
        data = {"billing_month": month, "water_amount": Decimal("0.00"), **extra}
        if not include:
            data["include_electricity"] = False
        if closing is not None:
            value, on = closing
            data["closing_reading"] = {"reading": Decimal(value), "read_on": on}
        if reading_id is not None:
            data["closing_reading_id"] = reading_id
        return create_rent_entry(
            tenancy=tenancy or self.tenancy,
            actor=self.owner,
            validated_data=data,
            creation_key=uuid.uuid4(),
        ).entry


class BaselineBillingTests(MeterBillTestCase):
    def test_tc02_the_first_reading_is_measured_from_the_baseline(self):
        tenancy = make_tenancy(
            self.property,
            flat_number="301",
            electricity_rate=Decimal("8.00"),
            meter_baseline_reading=Decimal("2804"),
            meter_baseline_recorded_at=recorded_on(date(2026, 1, 1)),
        )
        entry = self.bill(date(2026, 2, 1), ("2920", date(2026, 2, 28)), tenancy=tenancy)
        self.assertEqual(entry.electricity_mode, RentEntry.ElectricityMode.METER)
        self.assertEqual(entry.electricity_units, Decimal("116"))
        self.assertIsNone(entry.opening_reading)
        self.assertEqual(entry.meter_opening, Decimal("2804"))

    def test_tc14_a_tenancy_without_a_baseline_keeps_typed_units(self):
        tenancy = make_tenancy(self.property, flat_number="301")
        entry = self.bill(OCTOBER, tenancy=tenancy, electricity_units=Decimal("75"))
        self.assertEqual(entry.electricity_mode, RentEntry.ElectricityMode.MANUAL)
        self.assertEqual(entry.electricity_units, Decimal("75"))
        with self.assertRaises(MeterNotSetUpError):
            self.read("100", date(2026, 10, 31), tenancy=tenancy)
        with self.assertRaises(MeterNotSetUpError):
            self.bill(NOVEMBER, ("100", date(2026, 11, 30)), tenancy=tenancy)
        with self.assertRaises(InvalidReadingError):
            self.bill(NOVEMBER, tenancy=tenancy)

    def test_a_tenancy_without_a_baseline_can_leave_electricity_off(self):
        tenancy = make_tenancy(self.property, flat_number="301")
        entry = self.bill(OCTOBER, tenancy=tenancy, include=False)
        self.assertEqual(entry.electricity_mode, RentEntry.ElectricityMode.NOT_CHARGED)
        self.assertEqual(entry.electricity_units, 0)


class ReadingBillingTests(MeterBillTestCase):
    def test_tc03_consecutive_readings(self):
        self.read("2563", date(2026, 10, 31))
        self.read("2876", date(2026, 11, 30))
        entry = self.bill(OCTOBER, include=False)
        self.assertEqual(entry.electricity_units, 0)
        # From the baseline 2400: the October and November units wait together.
        december = self.bill(DECEMBER, reading_id=MeterReading.objects.get(reading=2876).pk)
        self.assertEqual(december.electricity_units, Decimal("476"))

    def test_tc21_a_reading_after_a_rent_only_payment_changes_no_bill(self):
        entry = self.bill(OCTOBER, include=False)
        record_payment(
            entry_id=entry.pk,
            actor=self.owner,
            idempotency_key=uuid.uuid4(),
            validated_data={"amount": Decimal("15000.00"), "paid_date": date(2026, 10, 5)},
        )
        self.read("2563", date(2026, 10, 31))
        entry.refresh_from_db()
        self.assertEqual(entry.electricity_units, 0)
        self.assertEqual(Payment.objects.count(), 1)

    def test_tc15_a_reading_a_bill_is_measured_from_waits_for_the_bill(self):
        entry = self.bill(OCTOBER, ("2563", date(2026, 10, 31)))
        with self.assertRaises(ReadingInUseError) as caught:
            correct_meter_reading(
                tenancy_id=self.tenancy.pk,
                reading_id=entry.closing_reading_id,
                actor=self.owner,
                reason="Wrong",
                validated_data={"reading": Decimal("2600"), "read_on": date(2026, 10, 31)},
                idempotency_key=uuid.uuid4(),
            )
        self.assertEqual(caught.exception.entries, [entry])
        void_rent_entry(entry_id=entry.pk, actor=self.owner, reason="Wrong reading")
        correct_meter_reading(
            tenancy_id=self.tenancy.pk,
            reading_id=entry.closing_reading_id,
            actor=self.owner,
            reason="Wrong",
            validated_data={"reading": Decimal("2600"), "read_on": date(2026, 10, 31)},
            idempotency_key=uuid.uuid4(),
        )
        entry.refresh_from_db()
        self.assertEqual(entry.electricity_units, Decimal("163"))  # never changed silently

    def test_a_billed_reading_names_every_bill_to_void_newest_first(self):
        october = self.bill(OCTOBER, ("2563", date(2026, 10, 31)))
        november = self.bill(NOVEMBER, ("2876", date(2026, 11, 30)))
        december = self.bill(DECEMBER, ("2985", date(2026, 12, 31)))
        unbilled = self.read("3001", date(2027, 1, 5))
        with self.assertRaises(ReadingInUseError) as caught:
            correct_meter_reading(
                tenancy_id=self.tenancy.pk,
                reading_id=november.closing_reading_id,
                actor=self.owner,
                reason="Wrong",
                validated_data={"reading": Decimal("2870"), "read_on": date(2026, 11, 30)},
                idempotency_key=uuid.uuid4(),
            )
        # November closes on it, December opens on it; October is untouched.
        self.assertEqual(caught.exception.entries, [december, november])
        with self.assertRaises(ReadingInUseError) as caught:
            void_meter_reading(
                tenancy_id=self.tenancy.pk,
                reading_id=october.closing_reading_id,
                actor=self.owner,
                reason="Wrong",
            )
        self.assertEqual(caught.exception.entries, [december, november, october])
        void_meter_reading(
            tenancy_id=self.tenancy.pk, reading_id=unbilled.pk, actor=self.owner, reason="Wrong"
        )


class BillingTests(MeterBillTestCase):
    def test_tc04_a_skipped_month_carries_the_reading_forward(self):
        self.bill(OCTOBER, ("2563", date(2026, 10, 31)))
        december = self.bill(DECEMBER, ("2985", date(2026, 12, 31)))
        self.assertEqual(december.electricity_units, Decimal("422"))
        self.assertEqual(MeterReading.objects.count(), 2)  # no November reading invented

    def test_tc06_tc07_tc11_unbilled_units_wait_for_the_next_meter_bill(self):
        october = self.bill(OCTOBER, ("2563", date(2026, 10, 31)))
        november = self.bill(NOVEMBER, ("2876", date(2026, 11, 30)), include=False)
        self.assertEqual(november.electricity_mode, RentEntry.ElectricityMode.NOT_CHARGED)
        self.assertEqual(november.electricity_units, 0)
        self.assertEqual(last_billed(self.tenancy).reading_id, october.closing_reading_id)

        december = self.bill(DECEMBER, ("2985", date(2026, 12, 31)))
        self.assertEqual(december.electricity_units, Decimal("422"))
        self.assertEqual(december.opening_reading_id, october.closing_reading_id)
        self.assertEqual(december.meter_opening, Decimal("2563"))
        amounts = RentEntry.objects.with_amounts().get(pk=december.pk)
        self.assertEqual(amounts.due_total - december.rent_amount, Decimal("3376.00"))

    def test_tc08_the_same_stretch_is_not_billed_twice(self):
        october = self.bill(OCTOBER, ("2563", date(2026, 10, 31)))
        with self.assertRaises(ReadingAlreadyBilledError):
            self.bill(NOVEMBER, reading_id=october.closing_reading_id)
        # The same reading again is the same day's reading: choose it, and it's billed.
        with self.assertRaises(DuplicateReadingDayError):
            self.bill(NOVEMBER, ("2563", date(2026, 10, 31)))

    def test_the_database_refuses_a_second_bill_on_a_billed_reading(self):
        october = self.bill(OCTOBER, ("2563", date(2026, 10, 31)))
        with self.assertRaises(IntegrityError), transaction.atomic():
            RentEntry.objects.create(
                tenancy=self.tenancy,
                billing_month=NOVEMBER,
                rent_amount=Decimal("15000"),
                electricity_units=Decimal("163"),
                electricity_rate=Decimal("8"),
                water_amount=Decimal("0"),
                created_by=self.owner,
                electricity_mode="meter",
                closing_reading=october.closing_reading,
                meter_opening=Decimal("2400"),
                meter_opening_date=date(2026, 9, 30),
            )

    def test_the_first_bill_can_close_on_the_day_tracking_started(self):
        entry = self.bill(OCTOBER, ("2410", date(2026, 9, 30)))
        self.assertEqual(entry.electricity_units, Decimal("10"))

    def test_charging_the_meter_needs_a_closing_reading_and_no_typed_units(self):
        with self.assertRaises(ClosingReadingRequiredError):
            self.bill(OCTOBER)
        with self.assertRaises(InvalidReadingError):
            self.bill(OCTOBER, ("2563", date(2026, 10, 31)), electricity_units=Decimal("5"))

    def test_tc19_a_failed_bill_records_no_reading(self):
        # A bill whose initial payment is refused rolls its reading back with it.
        with self.assertRaises(PaymentExceedsOutstandingError):
            create_rent_entry(
                tenancy=self.tenancy,
                actor=self.owner,
                validated_data={
                    "billing_month": OCTOBER,
                    "water_amount": Decimal("0"),
                    "closing_reading": {"reading": Decimal("2563"), "read_on": date(2026, 10, 31)},
                },
                creation_key=uuid.uuid4(),
                initial_payment={"amount": Decimal("999999"), "paid_date": date(2026, 10, 31)},
            )
        self.assertEqual(MeterReading.objects.count(), 0)
        self.assertEqual(RentEntry.objects.count(), 0)

    def test_tc05_paying_a_bill_needs_and_makes_no_reading(self):
        entry = self.bill(OCTOBER, ("2563", date(2026, 10, 31)))
        record_payment(
            entry_id=entry.pk,
            actor=self.owner,
            idempotency_key=uuid.uuid4(),
            validated_data={"amount": Decimal("1000.00"), "paid_date": date(2026, 11, 2)},
        )
        self.assertEqual(MeterReading.objects.count(), 1)
        entry.refresh_from_db()
        self.assertEqual(entry.electricity_units, Decimal("163"))

    def test_tc10_tc20_tenancies_never_share_readings(self):
        self.read("2563", date(2026, 10, 31))
        later = make_tenancy(
            self.property,
            flat_number="301",
            electricity_rate=Decimal("8.00"),
            meter_baseline_reading=Decimal("2563"),
            meter_baseline_recorded_at=recorded_on(date(2026, 10, 31)),
        )
        entry = self.bill(NOVEMBER, ("2700", date(2026, 11, 30)), tenancy=later)
        self.assertEqual(entry.electricity_units, Decimal("137"))
        other = MeterReading.objects.get(tenancy=self.tenancy)
        with self.assertRaises(InvalidReadingError):
            self.bill(DECEMBER, reading_id=other.pk, tenancy=later)

    def test_tc16_voiding_a_meter_bill_frees_its_stretch_newest_first(self):
        october = self.bill(OCTOBER, ("2563", date(2026, 10, 31)))
        december = self.bill(DECEMBER, ("2985", date(2026, 12, 31)))
        with self.assertRaises(LaterMeterBillError):
            void_rent_entry(entry_id=october.pk, actor=self.owner, reason="Wrong")
        void_rent_entry(entry_id=december.pk, actor=self.owner, reason="Wrong")
        self.assertEqual(last_billed(self.tenancy).reading_id, october.closing_reading_id)
        again = self.bill(DECEMBER, reading_id=december.closing_reading_id)
        self.assertEqual(again.electricity_units, Decimal("422"))

    def test_a_correction_keeps_the_meter_bills_readings(self):
        entry = self.bill(OCTOBER, ("2563", date(2026, 10, 31)))
        data = {
            "rent_amount": Decimal("14000.00"),
            "electricity_units": entry.electricity_units,
            "water_amount": Decimal("0.00"),
        }
        result = correct_rent_entry(
            entry_id=entry.pk,
            actor=self.owner,
            reason="Rent discount",
            validated_data=data,
            idempotency_key=uuid.uuid4(),
        )
        replacement = result.replacement
        self.assertEqual(replacement.electricity_mode, RentEntry.ElectricityMode.METER)
        self.assertEqual(replacement.closing_reading_id, entry.closing_reading_id)
        self.assertEqual(replacement.electricity_units, Decimal("163"))
        with self.assertRaises(ElectricityNotCorrectableError):
            correct_rent_entry(
                entry_id=replacement.pk,
                actor=self.owner,
                reason="Units",
                validated_data={**data, "electricity_units": Decimal("1")},
                idempotency_key=uuid.uuid4(),
            )


class ReceiptTests(MeterBillTestCase):
    def receipt_for(self, entry):
        payment = record_payment(
            entry_id=entry.pk,
            actor=self.owner,
            idempotency_key=uuid.uuid4(),
            validated_data={"amount": Decimal("1000.00"), "paid_date": date(2027, 1, 2)},
        ).payment
        return issue_payment_receipt(payment_id=payment.pk, actor=self.owner).receipt

    def test_a_receipt_leaves_out_the_day_tracking_started(self):
        october = self.bill(OCTOBER, ("2563", date(2026, 10, 31)))
        receipt = self.receipt_for(october)
        self.assertEqual(receipt.opening_reading, Decimal("2400"))
        self.assertIsNone(receipt.opening_read_on)
        self.assertEqual(receipt.closing_read_on, date(2026, 10, 31))

        december = self.bill(DECEMBER, ("2985", date(2026, 12, 31)))
        self.assertEqual(self.receipt_for(december).opening_read_on, date(2026, 10, 31))

    def test_tc13_tc17_a_meter_receipt_keeps_its_readings(self):
        self.bill(OCTOBER, ("2563", date(2026, 10, 31)))
        self.bill(NOVEMBER, ("2876", date(2026, 11, 30)), include=False)
        december = self.bill(DECEMBER, ("2985", date(2026, 12, 31)))
        receipt = self.receipt_for(december)
        self.read("3100", date(2027, 1, 15))
        receipt.refresh_from_db()
        self.assertEqual(receipt.electricity_mode, "meter")
        self.assertEqual(
            (receipt.opening_reading, receipt.closing_reading), (Decimal("2563"), Decimal("2985"))
        )
        self.assertEqual(receipt.electricity_units, Decimal("422"))
        self.assertEqual(receipt.electricity_amount, Decimal("3376.00"))

    def test_tc12_a_not_charged_receipt_says_so(self):
        receipt = self.receipt_for(self.bill(NOVEMBER, include=False))
        self.assertEqual(receipt.electricity_mode, "not_charged")
        self.assertIsNone(receipt.opening_reading)
        self.assertEqual(receipt.electricity_amount, Decimal("0.00"))

    def test_reversing_a_payment_leaves_the_readings(self):
        entry = self.bill(OCTOBER, ("2563", date(2026, 10, 31)))
        receipt = self.receipt_for(entry)
        reverse_payment(payment_id=receipt.payment_id, actor=self.owner, reason="Wrong amount")
        self.assertEqual(MeterReading.objects.active().count(), 1)
        self.assertEqual(Receipt.objects.get(pk=receipt.pk).closing_reading, Decimal("2563"))


class MeterBillApiTests(MeterBillTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.url = readings_url(self.property, self.tenancy)

    def test_the_meter_says_where_the_next_bill_starts_and_what_billed_each_reading(self):
        meter = self.client.get(self.url).json()
        self.assertEqual(
            meter["lastBilled"], {"reading": "2400.000", "readOn": "2026-09-30", "id": None}
        )
        october = self.bill(OCTOBER, ("2563", date(2026, 10, 31)))
        meter = self.client.get(self.url).json()
        self.assertEqual(meter["lastBilled"]["id"], str(october.closing_reading_id))
        self.assertEqual(
            meter["readings"][0]["billedBy"], {"id": str(october.pk), "billingMonth": "2026-10"}
        )

    def test_a_bill_with_a_closing_reading_and_its_contract(self):
        entries = f"/api/v1/properties/{self.property.id}/tenancies/{self.tenancy.id}/entries/"
        response = self.client.post(
            entries,
            {
                "billingMonth": "2026-10",
                "waterAmount": "0",
                "closingReading": {"reading": "2563", "readOn": "2026-10-31"},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body["electricityMode"], "meter")
        self.assertEqual(body["electricityUnits"], "163.000")
        self.assertEqual(body["openingReading"], {"reading": "2400.000", "readOn": "2026-09-30", "id": None})
        self.assertEqual(body["closingReading"]["reading"], "2563.000")

        again = self.client.post(
            entries,
            {"billingMonth": "2026-11", "waterAmount": "0", "closingReadingId": body["closingReading"]["id"]},
            format="json",
        )
        self.assertIn("already billed up to 2563", again.json()["closingReading"][0])
        missing = self.client.post(entries, {"billingMonth": "2026-11", "waterAmount": "0"}, format="json")
        self.assertIn("closing meter reading", missing.json()["closingReading"][0])
        both = self.client.post(
            entries,
            {
                "billingMonth": "2026-11",
                "waterAmount": "0",
                "closingReading": {"reading": "2700", "readOn": "2026-11-30"},
                "closingReadingId": body["closingReading"]["id"],
            },
            format="json",
        )
        self.assertEqual(both.status_code, 400)
        self.assertIn("not both", both.json()["closingReading"][0])
        self.assertFalse(MeterReading.objects.filter(reading=Decimal("2700")).exists())

        reading_id = body["closingReading"]["id"]
        in_use = self.client.post(f"{self.url}{reading_id}/void/", {"reason": "x"}, format="json")
        self.assertEqual(in_use.status_code, 409)
        self.assertEqual(in_use.json()["entries"][0]["billingMonth"], "2026-10")
