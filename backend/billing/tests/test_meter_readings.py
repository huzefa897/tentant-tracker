"""Electricity meter readings: the baseline, recording readings in order, corrections,
scoping and the API. The bills measured from them are test_meter_billing.py. TC-nn are the
spec's test cases."""

import uuid
from datetime import date
from decimal import Decimal
from unittest import mock

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from billing.meter import (
    DuplicateReadingDayError,
    InvalidReadingError,
    MeterNotSetUpError,
    NothingToCorrectReadingError,
    ReadingIdempotencyConflictError,
    ReadingNotAllowedError,
    ReadingNotFoundError,
    ReadingVoidConflictError,
    correct_meter_reading,
    record_meter_reading,
    void_meter_reading,
)
from billing.models import MeterReading
from properties.models import PropertyMembership, TenancyHasReadingsError

from .factories import make_property, make_tenancy, make_user, recorded_on

TODAY = date(2027, 1, 20)


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
            meter_baseline_recorded_at=recorded_on(date(2026, 9, 30)),
        )

    def read(self, value, on, tenancy=None, actor=None, key=None, notes=""):
        return record_meter_reading(
            tenancy_id=(tenancy or self.tenancy).pk,
            actor=actor or self.owner,
            validated_data={"reading": Decimal(value), "read_on": on, "notes": notes},
            idempotency_key=key or uuid.uuid4(),
        ).reading


class BaselineTests(MeterTestCase):
    def test_tc01_a_tenancy_has_its_own_baseline(self):
        tenancy = make_tenancy(
            self.property,
            flat_number="301",
            meter_baseline_reading=Decimal("2804"),
            meter_baseline_recorded_at=recorded_on(date(2026, 1, 1)),
        )
        self.assertEqual(tenancy.meter_baseline_reading, Decimal("2804"))

    def test_the_server_records_when_the_baseline_was_entered(self):
        tenancy = make_tenancy(self.property, flat_number="301")
        self.assertIsNone(tenancy.meter_baseline_recorded_at)
        first, later = recorded_on(date(2026, 11, 6)), recorded_on(date(2026, 11, 7))

        tenancy.meter_baseline_reading = Decimal("671")
        with mock.patch("properties.models.timezone.now", return_value=first):
            tenancy.save()
        self.assertEqual(tenancy.meter_baseline_recorded_at, first)
        self.assertEqual(tenancy.meter_baseline_date(), date(2026, 11, 6))

        # Saving something else keeps it; a new reading is recorded again; off clears it.
        tenancy.name = "Mohammed Yusuf"
        with mock.patch("properties.models.timezone.now", return_value=later):
            tenancy.save()
        self.assertEqual(tenancy.meter_baseline_recorded_at, first)
        tenancy.meter_baseline_reading = Decimal("675")
        with mock.patch("properties.models.timezone.now", return_value=later):
            tenancy.save()
        self.assertEqual(tenancy.meter_baseline_recorded_at, later)
        tenancy.meter_baseline_reading = None
        tenancy.save()
        self.assertIsNone(tenancy.meter_baseline_recorded_at)

    def test_the_database_needs_both_or_neither(self):
        tenancy = make_tenancy(self.property, flat_number="301")
        with self.assertRaises(IntegrityError), transaction.atomic():
            type(tenancy).objects.filter(pk=tenancy.pk).update(meter_baseline_reading=Decimal("1"))

    def test_the_baseline_is_fixed_and_tracking_stays_on_once_readings_exist(self):
        self.read("2563", date(2026, 10, 31))
        for value in (Decimal("2000"), None):
            with self.subTest(value=value):
                self.tenancy.meter_baseline_reading = value
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
    def test_admin_keeps_tracking_on_once_readings_exist(self):
        self.read("2563", date(2026, 10, 31))
        admin = make_user("admin", is_staff=True, is_superuser=True)
        self.client.force_login(admin)
        url = reverse("admin:properties_tenancy_change", args=[self.tenancy.pk])

        page = self.client.get(url)
        self.assertContains(page, "Enable meter reading tracking")
        self.assertNotContains(page, 'name="meter_tracking"')
        self.assertNotContains(page, 'name="meter_baseline_reading"')

    def test_a_tenancy_without_a_baseline_takes_no_readings(self):
        tenancy = make_tenancy(self.property, flat_number="301")
        with self.assertRaises(MeterNotSetUpError):
            self.read("100", date(2026, 10, 31), tenancy=tenancy)


class ReadingTests(MeterTestCase):
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

    def test_dates_are_from_the_day_tracking_started_and_not_ahead(self):
        for on in (date(2026, 9, 29), date(2025, 12, 31), date(2027, 1, 21)):
            with self.subTest(on=on), self.assertRaises(InvalidReadingError):
                self.read("2500", on)
        # The day the baseline was recorded is fine: tracking started that day.
        self.read("2500", date(2026, 9, 30))

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

    def test_managers_record_readings_and_others_cannot(self):
        manager = make_user("manager")
        PropertyMembership.objects.create(user=manager, property=self.property, role="manager")
        self.read("2563", date(2026, 10, 31), actor=manager)
        with self.assertRaises(ReadingNotFoundError):
            self.read("2600", date(2026, 11, 30), actor=make_user("stranger"))
        with mock.patch("billing.meter.role_can", return_value=False):
            with self.assertRaises(ReadingNotAllowedError):
                self.read("2600", date(2026, 11, 30))


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
