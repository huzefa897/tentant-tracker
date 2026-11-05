"""Electricity meter readings and the bills measured from them: the baseline, recording
readings, units carried over skipped or not-charged months, billing each stretch once,
corrections, receipts, scoping and the API. TC-nn are the spec's test cases."""

import uuid
from datetime import date
from decimal import Decimal
from unittest import mock

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from billing.meter import (
    ClosingReadingRequiredError,
    DuplicateReadingDayError,
    InvalidReadingError,
    LaterMeterBillError,
    MeterNotSetUpError,
    NothingToCorrectReadingError,
    ReadingAlreadyBilledError,
    ReadingIdempotencyConflictError,
    ReadingInUseError,
    ReadingNotAllowedError,
    ReadingNotFoundError,
    ReadingVoidConflictError,
    correct_meter_reading,
    last_billed,
    record_meter_reading,
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
from properties.models import PropertyMembership, TenancyHasReadingsError

from .factories import make_property, make_tenancy, make_user

TODAY = date(2027, 1, 20)
OCTOBER, NOVEMBER, DECEMBER = date(2026, 10, 1), date(2026, 11, 1), date(2026, 12, 1)


def readings_url(prop, tenancy):
    return f"/api/v1/properties/{prop.id}/tenancies/{tenancy.id}/meter-readings/"


class MeterTestCase(TestCase):
    def setUp(self):
        for target in (
            "billing.meter.business_date",
            "billing.services.business_date",
            "billing.serializers.business_date",
        ):
            patcher = mock.patch(target, return_value=TODAY)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.owner = make_user("owner", name="Huzefa")
        self.property = make_property(name="Saleem Towers", member=self.owner, role="owner")
        self.property.contact_number = ""
        self.tenancy = make_tenancy(
            self.property,
            electricity_rate=Decimal("8.00"),
            meter_baseline_reading=Decimal("2400"),
            meter_baseline_date=date(2026, 9, 30),
        )

    def read(self, value, on, tenancy=None, actor=None, key=None, notes=""):
        return record_meter_reading(
            tenancy_id=(tenancy or self.tenancy).pk,
            actor=actor or self.owner,
            validated_data={"reading": Decimal(value), "read_on": on, "notes": notes},
            idempotency_key=key or uuid.uuid4(),
        ).reading

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


class BaselineTests(MeterTestCase):
    def test_tc01_a_tenancy_has_its_own_baseline(self):
        tenancy = make_tenancy(
            self.property,
            flat_number="301",
            meter_baseline_reading=Decimal("2804"),
            meter_baseline_date=date(2026, 1, 1),
        )
        self.assertEqual(tenancy.meter_baseline_reading, Decimal("2804"))

    def test_tc02_the_first_reading_is_measured_from_the_baseline(self):
        tenancy = make_tenancy(
            self.property,
            flat_number="301",
            electricity_rate=Decimal("8.00"),
            meter_baseline_reading=Decimal("2804"),
            meter_baseline_date=date(2026, 1, 1),
        )
        entry = self.bill(date(2026, 2, 1), ("2920", date(2026, 2, 28)), tenancy=tenancy)
        self.assertEqual(entry.electricity_mode, RentEntry.ElectricityMode.METER)
        self.assertEqual(entry.electricity_units, Decimal("116"))
        self.assertIsNone(entry.opening_reading)
        self.assertEqual(entry.meter_opening, Decimal("2804"))

    def test_a_baseline_needs_its_date_within_the_occupancy(self):
        tenancy = make_tenancy(self.property, flat_number="301")
        tenancy.meter_baseline_reading = Decimal("100")
        with self.assertRaises(ValidationError):
            tenancy.full_clean()
        tenancy.meter_baseline_date = date(2025, 12, 31)
        with self.assertRaises(ValidationError):
            tenancy.full_clean()
        with self.assertRaises(IntegrityError), transaction.atomic():
            tenancy.save()

    def test_the_baseline_is_fixed_once_readings_exist(self):
        self.read("2563", date(2026, 10, 31))
        self.tenancy.meter_baseline_reading = Decimal("2000")
        with self.assertRaises(ValidationError):
            self.tenancy.full_clean()
        with self.assertRaises(TenancyHasReadingsError):
            self.tenancy.save()

    def test_the_baseline_can_change_while_only_void_readings_exist(self):
        reading = self.read("2563", date(2026, 10, 31))
        void_meter_reading(
            tenancy_id=self.tenancy.pk, reading_id=reading.pk, actor=self.owner, reason="Typo"
        )
        self.tenancy.meter_baseline_reading = Decimal("2000")
        self.tenancy.save()

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


class ReadingTests(MeterTestCase):
    def test_tc03_consecutive_readings(self):
        self.read("2563", date(2026, 10, 31))
        self.read("2876", date(2026, 11, 30))
        entry = self.bill(OCTOBER, include=False)
        self.assertEqual(entry.electricity_units, 0)
        # From the baseline 2400: the October and November units wait together.
        december = self.bill(DECEMBER, reading_id=MeterReading.objects.get(reading=2876).pk)
        self.assertEqual(december.electricity_units, Decimal("476"))

    def test_tc09_tc10_readings_never_go_down_or_below_zero(self):
        self.read("2563", date(2026, 10, 31))
        with self.assertRaises(InvalidReadingError):
            self.read("2500", date(2026, 11, 30))
        with self.assertRaises(InvalidReadingError):
            self.read("2300", date(2026, 10, 15))  # below the baseline
        with self.assertRaises(InvalidReadingError):
            self.read("-1", date(2026, 11, 30))

    def test_tc22_a_backdated_reading_must_fit_between_its_neighbours(self):
        self.read("2563", date(2026, 10, 31))
        self.read("2985", date(2026, 12, 31))
        with self.assertRaises(InvalidReadingError):
            self.read("3000", date(2026, 11, 30))
        with self.assertRaises(InvalidReadingError):
            self.read("2500", date(2026, 11, 30))
        self.read("2876", date(2026, 11, 30))

    def test_dates_are_within_the_tenancy_after_the_baseline_and_not_ahead(self):
        for on in (date(2026, 9, 30), date(2026, 9, 1), date(2027, 1, 21)):
            with self.subTest(on=on), self.assertRaises(InvalidReadingError):
                self.read("2500", on)

    def test_one_reading_a_day(self):
        self.read("2563", date(2026, 10, 31))
        with self.assertRaises(DuplicateReadingDayError):
            self.read("2563", date(2026, 10, 31))

    def test_a_retry_returns_the_reading_and_a_changed_request_conflicts(self):
        key = uuid.uuid4()
        first = self.read("2563", date(2026, 10, 31), key=key)
        self.assertEqual(self.read("2563", date(2026, 10, 31), key=key), first)
        with self.assertRaises(ReadingIdempotencyConflictError):
            self.read("2564", date(2026, 10, 31), key=key)
        self.assertEqual(MeterReading.objects.count(), 1)

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

    def test_managers_record_readings_and_others_cannot(self):
        manager = make_user("manager")
        PropertyMembership.objects.create(user=manager, property=self.property, role="manager")
        self.read("2563", date(2026, 10, 31), actor=manager)
        with self.assertRaises(ReadingNotFoundError):
            self.read("2600", date(2026, 11, 30), actor=make_user("stranger"))
        with mock.patch("billing.meter.role_can", return_value=False):
            with self.assertRaises(ReadingNotAllowedError):
                self.read("2600", date(2026, 11, 30))


class BillingTests(MeterTestCase):
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
            meter_baseline_date=date(2026, 10, 31),
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


class CorrectionTests(MeterTestCase):
    def test_tc15_a_reading_no_bill_uses_is_corrected_with_an_audit_trail(self):
        reading = self.read("2867", date(2026, 11, 30))
        result = correct_meter_reading(
            tenancy_id=self.tenancy.pk,
            reading_id=reading.pk,
            actor=self.owner,
            reason="Digits swapped",
            validated_data={"reading": Decimal("2876"), "read_on": date(2026, 11, 30)},
            idempotency_key=uuid.uuid4(),
        )
        reading.refresh_from_db()
        self.assertEqual(reading.status, MeterReading.Status.VOID)
        self.assertEqual(reading.reading, Decimal("2867"))
        self.assertEqual(result.replacement.replaces_reading, reading)
        self.assertEqual(result.replacement.reading, Decimal("2876"))

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

    def test_a_correction_must_change_something_and_fit_the_others(self):
        reading = self.read("2563", date(2026, 10, 31))
        self.read("2985", date(2026, 12, 31))
        kwargs = {
            "tenancy_id": self.tenancy.pk,
            "reading_id": reading.pk,
            "actor": self.owner,
            "reason": "Wrong",
            "idempotency_key": uuid.uuid4(),
        }
        with self.assertRaises(NothingToCorrectReadingError):
            correct_meter_reading(
                **kwargs, validated_data={"reading": Decimal("2563"), "read_on": date(2026, 10, 31)}
            )
        with self.assertRaises(InvalidReadingError):
            correct_meter_reading(
                **kwargs, validated_data={"reading": Decimal("3000"), "read_on": date(2026, 10, 31)}
            )
        reading.refresh_from_db()
        self.assertEqual(reading.status, MeterReading.Status.ACTIVE)

    def test_voiding_a_reading_twice(self):
        reading = self.read("2563", date(2026, 10, 31))
        kwargs = {"tenancy_id": self.tenancy.pk, "reading_id": reading.pk, "actor": self.owner}
        self.assertTrue(void_meter_reading(**kwargs, reason="Twice").created)
        self.assertFalse(void_meter_reading(**kwargs, reason="Twice").created)
        with self.assertRaises(ReadingVoidConflictError):
            void_meter_reading(**kwargs, reason="Other")


class ReceiptTests(MeterTestCase):
    def receipt_for(self, entry):
        payment = record_payment(
            entry_id=entry.pk,
            actor=self.owner,
            idempotency_key=uuid.uuid4(),
            validated_data={"amount": Decimal("1000.00"), "paid_date": date(2027, 1, 2)},
        ).payment
        return issue_payment_receipt(payment_id=payment.pk, actor=self.owner).receipt

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


class MeterApiTests(MeterTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.url = readings_url(self.property, self.tenancy)

    def post(self, body, url=None, key=None):
        return self.client.post(
            url or self.url,
            body,
            format="json",
            headers={"Idempotency-Key": str(key or uuid.uuid4())},
        )

    def test_records_and_lists_readings_with_consumption(self):
        response = self.post({"reading": "2563", "readOn": "2026-10-31"})
        self.assertEqual(response.status_code, 201, response.content)
        self.post({"reading": "2876.5", "readOn": "2026-11-30"})

        meter = self.client.get(self.url).json()
        self.assertEqual(meter["baseline"], {"reading": "2400.000", "readOn": "2026-09-30"})
        self.assertEqual(meter["lastBilled"], {"reading": "2400.000", "readOn": "2026-09-30", "id": None})
        self.assertEqual(
            [(r["reading"], r["consumption"]) for r in meter["readings"]],
            [("2876.500", "313.500"), ("2563.000", "163.000")],
        )

    def test_refuses_bad_readings_with_the_field(self):
        for body in (
            {"reading": "-1", "readOn": "2026-10-31"},
            {"reading": "abc", "readOn": "2026-10-31"},
            {"reading": "1.2345", "readOn": "2026-10-31"},
            {"reading": "2300", "readOn": "2026-10-31"},
            {"reading": "2500", "readOn": "2026-10-31", "tenancyId": "x"},
        ):
            with self.subTest(body=body):
                self.assertEqual(self.post(body).status_code, 400)
        self.post({"reading": "2563", "readOn": "2026-10-31"})
        response = self.post({"reading": "2563", "readOn": "2026-10-31"})
        self.assertEqual(response.json()["code"], "duplicate_reading_day")

    def test_needs_a_key(self):
        response = self.client.post(self.url, {"reading": "2563", "readOn": "2026-10-31"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_another_propertys_tenancy_is_not_found(self):
        stranger = make_user("stranger")
        self.client.force_authenticate(stranger)
        self.assertEqual(self.client.get(self.url).status_code, 404)

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

        reading_id = body["closingReading"]["id"]
        in_use = self.client.post(f"{self.url}{reading_id}/void/", {"reason": "x"}, format="json")
        self.assertEqual(in_use.status_code, 409)
        self.assertEqual(in_use.json()["entries"][0]["billingMonth"], "2026-10")

    def test_correction_endpoint(self):
        reading_id = self.post({"reading": "2867", "readOn": "2026-11-30"}).json()["reading"]
        response = self.post(
            {"reason": "Swapped", "reading": "2876", "readOn": "2026-11-30"},
            url=f"{self.url}{reading_id}/correction/",
        )
        self.assertEqual(response.status_code, 201, response.content)
        readings = response.json()["meter"]["readings"]
        self.assertEqual([r["status"] for r in readings], ["active", "void"])
        self.assertEqual(readings[1]["replacedByReadingId"], readings[0]["id"])
