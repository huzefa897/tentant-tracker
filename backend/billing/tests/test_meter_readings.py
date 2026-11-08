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

    def test_a_time_the_caller_sets_is_kept(self):
        tenancy = make_tenancy(self.property, flat_number="301")
        set_by_caller = recorded_on(date(2026, 1, 1))
        tenancy.meter_baseline_reading = Decimal("671")
        tenancy.meter_baseline_recorded_at = set_by_caller
        now = recorded_on(date(2026, 11, 6))
        with mock.patch("properties.models.timezone.now", return_value=now):
            tenancy.save()
        tenancy.refresh_from_db()
        self.assertEqual(tenancy.meter_baseline_recorded_at, set_by_caller)

    def test_saving_other_fields_leaves_the_baseline_time_alone(self):
        tenancy = make_tenancy(self.property, flat_number="301")
        first, later = recorded_on(date(2026, 11, 6)), recorded_on(date(2026, 11, 7))
        tenancy.meter_baseline_reading = Decimal("671")
        with mock.patch("properties.models.timezone.now", return_value=first):
            tenancy.save()

        # A save that doesn't write the baseline doesn't stamp it, even with the reading
        # changed in memory.
        tenancy.name = "Mohammed Yusuf"
        tenancy.meter_baseline_reading = Decimal("675")
        with mock.patch("properties.models.timezone.now", return_value=later):
            tenancy.save(update_fields=["name"])
        tenancy.refresh_from_db()
        self.assertEqual(tenancy.name, "Mohammed Yusuf")
        self.assertEqual(tenancy.meter_baseline_reading, Decimal("671"))
        self.assertEqual(tenancy.meter_baseline_recorded_at, first)

        # One that does, saves the time with the reading.
        tenancy.meter_baseline_reading = Decimal("675")
        with mock.patch("properties.models.timezone.now", return_value=later):
            tenancy.save(update_fields=["meter_baseline_reading"])
        tenancy.refresh_from_db()
        self.assertEqual(tenancy.meter_baseline_reading, Decimal("675"))
        self.assertEqual(tenancy.meter_baseline_recorded_at, later)

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
    def test_a_new_baseline_after_every_reading_is_void_starts_the_meter_again(self):
        old = self.read("2563", date(2026, 10, 31))
        void_meter_reading(
            tenancy_id=self.tenancy.pk, reading_id=old.pk, actor=self.owner, reason="Typo"
        )
        self.tenancy.meter_baseline_reading = Decimal("2000")
        with mock.patch(
            "properties.models.timezone.now", return_value=recorded_on(date(2027, 1, 10))
        ):
            self.tenancy.save()

        # Dated from the new baseline's day, and measured from it.
        with self.assertRaises(InvalidReadingError):
            self.read("2100", date(2026, 12, 31))
        with self.assertRaises(InvalidReadingError):
            self.read("1999", date(2027, 1, 10))
        new = self.read("2100", date(2027, 1, 10))
        self.assertEqual(new.reading, Decimal("2100"))
        # The void reading stays as it was: history, measuring nothing.
        old.refresh_from_db()
        self.assertEqual((old.status, old.reading), (MeterReading.Status.VOID, Decimal("2563")))

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


class UnitsEntryTests(MeterTestCase):
    """A reading entered as the units used since the latest reading: the server adds them to
    it under the tenancy's lock, and keeps the units as entered."""

    def units(self, value, on, key=None, notes=""):
        return record_meter_reading(
            tenancy_id=self.tenancy.pk,
            actor=self.owner,
            validated_data={"units": Decimal(value), "read_on": on, "notes": notes},
            idempotency_key=key or uuid.uuid4(),
        ).reading

    def test_units_are_added_to_the_baseline_when_nothing_is_read_yet(self):
        reading = self.units("163", date(2026, 10, 31))
        self.assertEqual(reading.reading, Decimal("2563"))
        self.assertEqual(reading.entered_units, Decimal("163"))

    def test_units_are_added_to_the_newest_reading_billed_or_not(self):
        self.read("2563", date(2026, 10, 31))
        self.read("2876", date(2026, 11, 30))
        reading = self.units("109", date(2026, 12, 31))
        self.assertEqual(reading.reading, Decimal("2985"))

    def test_a_reading_entered_after_units_is_measured_from_them(self):
        self.units("163", date(2026, 10, 31))
        reading = self.read("2700", date(2026, 11, 30))
        self.assertIsNone(reading.entered_units)
        self.assertEqual(reading.reading, Decimal("2700"))

    def test_units_can_start_on_the_day_tracking_started(self):
        self.assertEqual(self.units("0", date(2026, 9, 30)).reading, Decimal("2400"))

    def test_units_are_dated_after_the_newest_reading(self):
        self.read("2563", date(2026, 10, 31))
        self.read("2876", date(2026, 11, 30))
        for on in (date(2026, 11, 15), date(2026, 11, 30)):
            with self.subTest(on=on), self.assertRaises(InvalidReadingError) as error:
                self.units("50", on)
            self.assertEqual(error.exception.field, "readOn")
            self.assertIn("2876 on 30 Nov 2026", error.exception.detail)
        # A day no reading can have says why, not that it's before the latest reading.
        with self.assertRaises(InvalidReadingError) as error:
            self.units("50", date(2026, 9, 29))
        self.assertIn("before meter tracking started on 30 Sep 2026", error.exception.detail)

    def test_void_readings_are_not_what_units_are_added_to(self):
        self.read("2563", date(2026, 10, 31))
        wrong = self.read("9999", date(2026, 11, 30))
        void_meter_reading(
            tenancy_id=self.tenancy.pk, reading_id=wrong.pk, actor=self.owner, reason="Typo"
        )
        self.assertEqual(self.units("100", date(2026, 12, 1)).reading, Decimal("2663"))

    def test_the_other_checks_still_apply(self):
        with self.assertRaises(InvalidReadingError) as error:
            self.units("10", date(2027, 1, 21))
        self.assertEqual(error.exception.field, "readOn")
        with self.assertRaises(InvalidReadingError) as error:
            self.units("9999999", date(2026, 10, 31))
        self.assertEqual(error.exception.field, "units")
        bare = make_tenancy(self.property, flat_number="302")
        with self.assertRaises(MeterNotSetUpError):
            record_meter_reading(
                tenancy_id=bare.pk,
                actor=self.owner,
                validated_data={"units": Decimal("5"), "read_on": date(2026, 10, 31)},
                idempotency_key=uuid.uuid4(),
            )

    def test_a_retry_returns_the_same_reading_even_after_a_later_one(self):
        key = uuid.uuid4()
        first = self.units("163", date(2026, 10, 31), key=key)
        self.read("2700", date(2026, 11, 30))
        self.assertEqual(self.units("163", date(2026, 10, 31), key=key).pk, first.pk)
        with self.assertRaises(ReadingIdempotencyConflictError):
            self.units("164", date(2026, 10, 31), key=key)
        with self.assertRaises(ReadingIdempotencyConflictError):
            # The same figure as a reading is another request.
            record_meter_reading(
                tenancy_id=self.tenancy.pk,
                actor=self.owner,
                validated_data={"reading": Decimal("163"), "read_on": date(2026, 10, 31)},
                idempotency_key=key,
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


class ReadingGuardTests(MeterTestCase):
    """The database refuses what billing/meter.py never does, so a queryset update, a shell
    session or a script can't rewrite a reading either."""

    def assert_refused(self, action):
        # A refused statement aborts its transaction, so each runs in a savepoint.
        with self.assertRaises(IntegrityError), transaction.atomic():
            action()

    def test_what_was_read_is_never_edited(self):
        reading = self.read("2563", date(2026, 10, 31))
        other = make_tenancy(
            self.property, flat_number="303", meter_baseline_reading=Decimal("0")
        )
        for change in (
            {"reading": Decimal("2000")},
            {"read_on": date(2026, 10, 30)},
            {"notes": "Changed"},
            {"tenancy": other},
            {"created_by": make_user("other")},
            {"entered_units": Decimal("5")},
        ):
            self.assert_refused(lambda change=change: MeterReading.objects.filter(pk=reading.pk).update(**change))
        reading.refresh_from_db()
        self.assertEqual(reading.reading, Decimal("2563"))
        self.assertEqual(reading.read_on, date(2026, 10, 31))

    def test_a_reading_is_never_deleted(self):
        reading = self.read("2563", date(2026, 10, 31))
        self.assert_refused(lambda: MeterReading.objects.filter(pk=reading.pk).delete())
        self.assert_refused(reading.delete)
        self.assertTrue(MeterReading.objects.filter(pk=reading.pk).exists())

    def test_voiding_still_works_and_a_void_reading_stays_void(self):
        reading = self.read("2563", date(2026, 10, 31))
        void_meter_reading(
            tenancy_id=self.tenancy.pk, reading_id=reading.pk, actor=self.owner, reason="Twice"
        )
        self.assert_refused(
            lambda: MeterReading.objects.filter(pk=reading.pk).update(
                status=MeterReading.Status.ACTIVE, voided_at=None, voided_by=None, void_reason=""
            )
        )
        self.assert_refused(
            lambda: MeterReading.objects.filter(pk=reading.pk).update(void_reason="Another reason")
        )
        reading.refresh_from_db()
        self.assertEqual(reading.status, MeterReading.Status.VOID)
        self.assertEqual(reading.void_reason, "Twice")

    def replacement_of(self, original, **overrides):
        values = {
            "tenancy": self.tenancy,
            "reading": Decimal("2570"),
            "read_on": date(2026, 11, 1),
            "created_by": self.owner,
            "idempotency_key": uuid.uuid4(),
            "fingerprint": "x",
            "replaces_reading": original,
        }
        return MeterReading.objects.create(**{**values, **overrides})

    def test_a_replacement_replaces_a_void_reading_of_the_same_tenancy(self):
        active = self.read("2563", date(2026, 10, 31))
        self.assert_refused(lambda: self.replacement_of(active))

        void = self.read("2600", date(2026, 11, 15))
        void_meter_reading(
            tenancy_id=self.tenancy.pk, reading_id=void.pk, actor=self.owner, reason="Wrong"
        )
        void.refresh_from_db()
        other = make_tenancy(
            self.property,
            flat_number="303",
            meter_baseline_reading=Decimal("0"),
            meter_baseline_recorded_at=recorded_on(date(2026, 9, 30)),
        )
        self.assert_refused(lambda: self.replacement_of(void, tenancy=other))

        self.assertEqual(self.replacement_of(void).replaces_reading, void)


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

    def test_records_units_and_shows_how_each_reading_was_entered(self):
        response = self.post({"units": "163", "readOn": "2026-10-31"})
        self.assertEqual(response.status_code, 201, response.content)
        self.post({"reading": "2700", "readOn": "2026-11-30"})
        readings = self.client.get(self.url).json()["readings"]
        self.assertEqual(
            [(r["reading"], r["enteredUnits"], r["consumption"]) for r in readings],
            [("2700.000", None, "137.000"), ("2563.000", "163.000", "163.000")],
        )

    def test_takes_the_reading_or_the_units(self):
        for body, field in (
            ({"readOn": "2026-10-31"}, "reading"),
            ({"reading": "2563", "units": "163", "readOn": "2026-10-31"}, "units"),
            ({"units": "-1", "readOn": "2026-10-31"}, "units"),
            ({"units": "1.2345", "readOn": "2026-10-31"}, "units"),
        ):
            with self.subTest(body=body):
                response = self.post(body)
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json())

    def test_a_correction_takes_the_reading_not_units(self):
        reading_id = self.post({"units": "163", "readOn": "2026-10-31"}).json()["reading"]
        response = self.post(
            {"reason": "Wrong", "units": "150", "readOn": "2026-10-31"},
            url=f"{self.url}{reading_id}/correction/",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("units", response.json())

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
