"""Correcting bills: voiding one that shouldn't exist, voiding and replacing one with wrong
charges, the payments that must be reversed first, retries, who may do it, the API, and void
bills counting towards nothing."""

import uuid
from datetime import date
from decimal import Decimal
from unittest import mock

from django.db import IntegrityError
from django.test import TestCase
from rest_framework.test import APIClient

from billing.calculations import entry_amounts
from billing.models import RentEntry
from billing.services import (
    BillCorrectionNotAllowedError,
    DuplicateBillingMonthError,
    EntryNotFoundError,
    EntryVoidError,
    IdempotencyConflictError,
    NothingToCorrectError,
    UnreversedPaymentsError,
    VoidConflictError,
    correct_rent_entry,
    create_rent_entry,
    issue_payment_receipt,
    record_payment,
    reverse_payment,
    void_rent_entry,
)
from billing.summary import ledger_summary
from properties.models import PropertyMembership

from .factories import make_property, make_tenancy, make_user
from .test_payments_api import TODAY, entries_url, make_entry

REASON = "October's electricity units were entered as 750 instead of 75."
# October's corrected charges: ₹15,000 + 75 × ₹6 + ₹300 = ₹15,750.
CORRECTED = {
    "rent_amount": Decimal("15000.00"),
    "electricity_units": Decimal("75.000"),
    "water_amount": Decimal("300.00"),
    "notes": "",
}


def void_url(prop, tenancy, entry_id):
    return f"{entries_url(prop, tenancy)}{entry_id}/void/"


def correction_url(prop, tenancy, entry_id):
    return f"{entries_url(prop, tenancy)}{entry_id}/correction/"


class BillCorrectionTestCase(TestCase):
    def setUp(self):
        for target in ("billing.services.business_date", "billing.serializers.business_date"):
            patcher = mock.patch(target, return_value=TODAY)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.owner = make_user("owner", name="Huzefa")
        self.property = make_property(name="Saleem Towers", member=self.owner, role="owner")
        self.tenancy = make_tenancy(self.property)
        # October, with 750 units instead of 75: ₹15,000 + 750 × ₹6 + ₹300 = ₹19,800.
        self.entry = make_entry(self.tenancy, self.owner, month=date(2026, 10, 1))
        RentEntry.objects.filter(pk=self.entry.pk).update(electricity_units=Decimal("750.000"))
        self.entry.refresh_from_db()
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def pay(self, amount="1000.00", entry=None):
        return record_payment(
            entry_id=(entry or self.entry).pk,
            actor=self.owner,
            idempotency_key=uuid.uuid4(),
            validated_data={"amount": Decimal(amount), "paid_date": date(2026, 10, 5)},
        ).payment

    def void(self, actor=None, reason=REASON):
        return void_rent_entry(entry_id=self.entry.pk, actor=actor or self.owner, reason=reason)

    def correct(self, actor=None, reason=REASON, key=None, **changes):
        return correct_rent_entry(
            entry_id=self.entry.pk,
            actor=actor or self.owner,
            reason=reason,
            validated_data={**CORRECTED, **changes},
            idempotency_key=key or uuid.uuid4(),
        )

    def make_manager(self):
        manager = make_user("manager", name="Manager")
        PropertyMembership.objects.create(user=manager, property=self.property, role="manager")
        return manager


class VoidServiceTests(BillCorrectionTestCase):
    def test_voids_the_bill_keeping_its_charges_creator_and_time(self):
        before = RentEntry.objects.get(pk=self.entry.pk)

        result = self.void()

        self.assertTrue(result.created)
        entry = RentEntry.objects.get(pk=self.entry.pk)
        self.assertEqual(entry.status, "void")
        self.assertEqual(entry.voided_by, self.owner)
        self.assertIsNotNone(entry.voided_at)
        self.assertEqual(entry.void_reason, REASON)
        for field in (
            "rent_amount",
            "electricity_units",
            "electricity_rate",
            "water_amount",
            "notes",
            "created_by_id",
            "created_at",
        ):
            with self.subTest(field=field):
                self.assertEqual(getattr(entry, field), getattr(before, field))

    def test_a_void_bill_keeps_its_total_but_owes_nothing(self):
        amounts = entry_amounts(self.void().entry)

        self.assertEqual(amounts.total_due, Decimal("19800.00"))
        self.assertEqual(amounts.outstanding_amount, Decimal("0.00"))
        self.assertIsNone(amounts.payment_status)

    def test_trims_the_reason_and_refuses_an_empty_or_long_one(self):
        for reason in ("", "   ", "x" * 501):
            with self.subTest(length=len(reason)), self.assertRaises(ValueError):
                self.void(reason=reason)
        self.assertEqual(RentEntry.objects.get(pk=self.entry.pk).status, "active")

        self.void(reason=f"  {REASON}  ")
        self.assertEqual(RentEntry.objects.get(pk=self.entry.pk).void_reason, REASON)

    def test_a_retry_with_the_same_reason_returns_the_void(self):
        first = self.void()

        retry = self.void()

        self.assertFalse(retry.created)
        self.assertEqual(retry.entry.voided_at, first.entry.voided_at)

    def test_another_reason_is_a_conflict(self):
        self.void()

        with self.assertRaises(VoidConflictError):
            self.void(reason="Entered twice")
        self.assertEqual(RentEntry.objects.get(pk=self.entry.pk).void_reason, REASON)

    def test_refused_while_a_payment_still_counts(self):
        self.pay()
        self.pay("500.00")

        with self.assertRaises(UnreversedPaymentsError) as raised:
            self.void()

        self.assertEqual(raised.exception.count, 2)
        self.assertEqual(RentEntry.objects.get(pk=self.entry.pk).status, "active")

    def test_allowed_once_every_payment_is_reversed_and_their_receipts_are_void(self):
        payment = self.pay()
        receipt = issue_payment_receipt(payment_id=payment.pk, actor=self.owner).receipt
        reverse_payment(payment_id=payment.pk, actor=self.owner, reason="Wrong bill")

        self.void()

        receipt.refresh_from_db()
        self.assertIsNotNone(receipt.voided_at)
        self.assertEqual(RentEntry.objects.get(pk=self.entry.pk).status, "void")
        # Nothing moved: the reversed payment stays on the void bill, as history.
        self.assertEqual(self.entry.payments.count(), 1)

    def test_only_owners_may_void(self):
        with self.assertRaises(BillCorrectionNotAllowedError):
            self.void(actor=self.make_manager())
        self.assertEqual(RentEntry.objects.get(pk=self.entry.pk).status, "active")

    def test_someone_without_access_is_told_it_does_not_exist(self):
        with self.assertRaises(EntryNotFoundError):
            self.void(actor=make_user("stranger"))


class CorrectionServiceTests(BillCorrectionTestCase):
    def test_voids_the_original_and_creates_its_replacement(self):
        result = self.correct()

        self.assertTrue(result.created)
        original, replacement = result.original, result.replacement
        self.assertEqual(original.pk, self.entry.pk)
        self.assertEqual(original.status, "void")
        self.assertEqual(original.void_reason, REASON)
        self.assertEqual(original.electricity_units, Decimal("750.000"))
        self.assertEqual(replacement.status, "active")
        self.assertEqual(replacement.replaces_entry_id, original.pk)
        self.assertEqual(replacement.created_by, self.owner)
        self.assertEqual(entry_amounts(replacement).total_due, Decimal("15750.00"))

    def test_keeps_the_originals_tenancy_month_and_rate_not_todays_defaults(self):
        self.tenancy.rent_amount = Decimal("18000.00")
        self.tenancy.electricity_rate = Decimal("9.00")
        self.tenancy.save()

        replacement = self.correct().replacement

        self.assertEqual(replacement.tenancy_id, self.tenancy.pk)
        self.assertEqual(replacement.billing_month, date(2026, 10, 1))
        self.assertEqual(replacement.electricity_rate, Decimal("6.00"))
        self.assertEqual(replacement.rent_amount, Decimal("15000.00"))

    def test_refused_when_nothing_changes(self):
        with self.assertRaises(NothingToCorrectError):
            self.correct(electricity_units=Decimal("750.000"))

        self.assertEqual(RentEntry.objects.get(pk=self.entry.pk).status, "active")
        self.assertEqual(RentEntry.objects.count(), 1)

    def test_a_change_to_the_notes_alone_is_a_correction(self):
        result = self.correct(electricity_units=Decimal("750.000"), notes="Meter read on the 1st")

        self.assertEqual(result.replacement.notes, "Meter read on the 1st")

    def test_refused_while_a_payment_still_counts(self):
        self.pay()

        with self.assertRaises(UnreversedPaymentsError):
            self.correct()
        self.assertEqual(RentEntry.objects.get(pk=self.entry.pk).status, "active")
        self.assertEqual(RentEntry.objects.count(), 1)

    def test_a_void_bill_cannot_be_corrected(self):
        self.void()

        with self.assertRaises(EntryVoidError):
            self.correct()
        self.assertEqual(RentEntry.objects.count(), 1)

    def test_a_failed_replacement_leaves_the_original_active(self):
        with (
            mock.patch("billing.services.RentEntry.objects.create", side_effect=RuntimeError),
            self.assertRaises(RuntimeError),
        ):
            self.correct()

        entry = RentEntry.objects.get(pk=self.entry.pk)
        self.assertEqual(entry.status, "active")
        self.assertIsNone(entry.voided_at)
        self.assertEqual(RentEntry.objects.count(), 1)

    def test_a_replacement_the_database_refuses_leaves_the_original_active(self):
        # Rent must be more than zero: the constraint fails the insert after the void.
        with self.assertRaises(IntegrityError):
            self.correct(rent_amount=Decimal("0"))

        self.assertEqual(RentEntry.objects.get(pk=self.entry.pk).status, "active")
        self.assertEqual(RentEntry.objects.count(), 1)

    def test_another_active_bill_for_the_month_is_refused(self):
        # As if the month's check missed it: the unique constraint still decides, and nothing
        # is saved.
        with mock.patch("billing.services.RentEntry.objects.active") as active:
            active.return_value.filter.return_value.exists.return_value = True
            with self.assertRaises(DuplicateBillingMonthError):
                self.correct()

        self.assertEqual(RentEntry.objects.get(pk=self.entry.pk).status, "active")

    def test_a_retry_with_the_same_key_returns_the_correction(self):
        key = uuid.uuid4()
        first = self.correct(key=key)

        retry = self.correct(key=key)

        self.assertFalse(retry.created)
        self.assertEqual(retry.replacement.pk, first.replacement.pk)
        self.assertEqual(retry.original.pk, self.entry.pk)
        self.assertEqual(RentEntry.objects.count(), 2)

    def test_a_retry_still_returns_it_after_the_replacement_is_paid(self):
        key = uuid.uuid4()
        first = self.correct(key=key)
        self.pay(entry=first.replacement)

        self.assertFalse(self.correct(key=key).created)

    def test_the_same_key_with_other_details_is_a_conflict(self):
        key = uuid.uuid4()
        self.correct(key=key)

        for changes in ({"water_amount": Decimal("400.00")}, {"reason": "Another reason"}):
            with self.subTest(changes=changes), self.assertRaises(IdempotencyConflictError):
                self.correct(key=key, **changes)

    def test_a_key_already_used_to_create_a_bill_is_a_conflict(self):
        key = uuid.uuid4()
        create_rent_entry(
            tenancy=self.tenancy,
            actor=self.owner,
            validated_data={
                "billing_month": date(2026, 11, 1),
                "electricity_units": Decimal("1"),
                "water_amount": Decimal("0"),
            },
            creation_key=key,
        )

        with self.assertRaises(IdempotencyConflictError):
            self.correct(key=key)
        self.assertEqual(RentEntry.objects.get(pk=self.entry.pk).status, "active")

    def test_only_owners_may_correct(self):
        with self.assertRaises(BillCorrectionNotAllowedError):
            self.correct(actor=self.make_manager())
        self.assertEqual(RentEntry.objects.count(), 1)

    def test_a_replacement_can_be_corrected_in_turn(self):
        replacement = self.correct().replacement
        self.entry = replacement

        second = self.correct(water_amount=Decimal("350.00"))

        self.assertEqual(second.original.pk, replacement.pk)
        self.assertEqual(second.replacement.replaces_entry_id, replacement.pk)
        self.assertEqual(RentEntry.objects.active().count(), 1)


class VoidBillsInOtherOperationsTests(BillCorrectionTestCase):
    def test_a_void_bill_takes_no_payments(self):
        self.void()

        with self.assertRaises(EntryVoidError):
            self.pay()
        self.assertEqual(self.entry.payments.count(), 0)

    def test_a_retry_of_a_payment_since_reversed_on_a_void_bill_returns_it(self):
        key = uuid.uuid4()
        data = {"amount": Decimal("1000.00"), "paid_date": date(2026, 10, 5)}
        payment = record_payment(
            entry_id=self.entry.pk, actor=self.owner, idempotency_key=key, validated_data=data
        ).payment
        reverse_payment(payment_id=payment.pk, actor=self.owner, reason="Wrong bill")
        self.void()

        retry = record_payment(
            entry_id=self.entry.pk, actor=self.owner, idempotency_key=key, validated_data=data
        )

        self.assertFalse(retry.created)
        self.assertEqual(retry.payment.pk, payment.pk)

    def test_a_voided_month_can_have_a_new_bill(self):
        self.void()

        result = create_rent_entry(
            tenancy=self.tenancy,
            actor=self.owner,
            validated_data={
                "billing_month": date(2026, 10, 1),
                "electricity_units": Decimal("75.000"),
                "water_amount": Decimal("300.00"),
            },
        )

        self.assertTrue(result.created)
        self.assertIsNone(result.entry.replaces_entry_id)

    def test_a_corrected_month_still_refuses_another_bill(self):
        self.correct()

        with self.assertRaises(DuplicateBillingMonthError):
            create_rent_entry(
                tenancy=self.tenancy,
                actor=self.owner,
                validated_data={
                    "billing_month": date(2026, 10, 1),
                    "electricity_units": Decimal("75.000"),
                    "water_amount": Decimal("300.00"),
                },
            )

    def test_a_receipts_previous_month_is_the_active_bill(self):
        # October corrected from ₹19,800 to ₹16,000, and ₹15,750 paid on the replacement.
        replacement = self.correct(rent_amount=Decimal("15250.00")).replacement
        self.pay("15750.00", entry=replacement)
        november = make_entry(self.tenancy, self.owner, month=date(2026, 11, 1))

        receipt = issue_payment_receipt(
            payment_id=self.pay(entry=november).pk, actor=self.owner
        ).receipt

        self.assertEqual(receipt.previous_month_outstanding, Decimal("250.00"))

    def test_the_ledger_summary_leaves_void_bills_out_of_its_totals(self):
        before = dict(ledger_summary())
        self.correct()

        after = dict(ledger_summary())

        self.assertEqual(before["total billed"], "19800.00")
        self.assertEqual(after["total billed"], "15750.00")
        self.assertEqual(after["total outstanding"], "15750.00")
        self.assertEqual(after["bills"], "2")
        self.assertEqual(after["void bills"], "1")
        self.assertNotEqual(before["bills digest"], after["bills digest"])


class AcceptanceTests(BillCorrectionTestCase):
    def test_correcting_octobers_electricity(self):
        """Given October's bill contains incorrect electricity units, and it has no unreversed
        payments, when I submit a corrected replacement, then the original bill becomes void,
        the replacement becomes active, both remain visible in history, and only the
        replacement contributes to financial totals."""
        response = self.client.post(
            correction_url(self.property, self.tenancy, self.entry.id),
            {
                "reason": REASON,
                "rentAmount": "15000.00",
                "electricityUnits": "75.000",
                "waterAmount": "300.00",
                "notes": "",
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
        )
        self.assertEqual(response.status_code, 201)
        replacement_id = response.json()["replacement"]["id"]

        history = self.client.get(
            entries_url(self.property, self.tenancy), {"status": "all"}
        ).json()["results"]
        self.assertEqual(
            [(e["id"], e["status"]) for e in history],
            [(replacement_id, "active"), (str(self.entry.id), "void")],
        )
        void, active = history[1], history[0]
        self.assertEqual(void["replacedByEntryId"], replacement_id)
        self.assertEqual(active["replacesEntryId"], str(self.entry.id))

        # Totals: the active list is the one that counts, and only the replacement is in it.
        counted = self.client.get(entries_url(self.property, self.tenancy)).json()
        self.assertEqual(counted["count"], 1)
        self.assertEqual(counted["results"][0]["outstandingAmount"], "15750.00")
        self.assertEqual(void["outstandingAmount"], "0.00")
        self.assertEqual(dict(ledger_summary())["total billed"], "15750.00")


class BillCorrectionApiTests(BillCorrectionTestCase):
    def post_void(self, data=None, entry=None):
        return self.client.post(
            void_url(self.property, self.tenancy, (entry or self.entry).id),
            {"reason": REASON} if data is None else data,
            format="json",
        )

    def post_correction(self, key=None, **changes):
        data = {
            "reason": REASON,
            "rentAmount": "15000.00",
            "electricityUnits": "75.000",
            "waterAmount": "300.00",
            "notes": "",
            **changes,
        }
        headers = {} if key is False else {"HTTP_IDEMPOTENCY_KEY": str(key or uuid.uuid4())}
        return self.client.post(
            correction_url(self.property, self.tenancy, self.entry.id),
            data,
            format="json",
            **headers,
        )

    def test_void_returns_the_bill_void(self):
        response = self.post_void()

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["status"], "void")
        self.assertEqual(body["voidReason"], REASON)
        self.assertEqual(body["voidedByName"], "Huzefa")
        self.assertTrue(body["voidedAt"])
        self.assertEqual(body["totalDue"], "19800.00")
        self.assertEqual(body["outstandingAmount"], "0.00")
        self.assertIsNone(body["paymentStatus"])

    def test_void_retry_is_200_and_another_reason_409(self):
        self.post_void()

        self.assertEqual(self.post_void().status_code, 200)
        conflict = self.post_void({"reason": "Entered twice"})
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["code"], "void_conflict")

    def test_void_with_payments_that_count_is_409(self):
        self.pay()

        response = self.post_void()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "unreversed_payments")

    def test_void_needs_a_reason_and_refuses_other_fields(self):
        for data, field in (
            ({}, "reason"),
            ({"reason": " "}, "reason"),
            ({"reason": REASON, "status": "void"}, "status"),
        ):
            with self.subTest(data=data):
                response = self.post_void(data)
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json())

    def test_correction_returns_both_bills_linked(self):
        response = self.post_correction()

        self.assertEqual(response.status_code, 201)
        original, replacement = response.json()["original"], response.json()["replacement"]
        self.assertEqual(original["status"], "void")
        self.assertEqual(original["replacedByEntryId"], replacement["id"])
        self.assertEqual(replacement["status"], "active")
        self.assertEqual(replacement["replacesEntryId"], original["id"])
        self.assertEqual(replacement["electricityRate"], "6.00")
        self.assertEqual(replacement["totalDue"], "15750.00")
        self.assertEqual(replacement["paymentStatus"], "unpaid")

    def test_correction_retry_is_200_and_the_key_reused_409(self):
        key = uuid.uuid4()
        first = self.post_correction(key=key)

        retry = self.post_correction(key=key)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()["replacement"]["id"], first.json()["replacement"]["id"])

        reused = self.post_correction(key=key, waterAmount="400.00")
        self.assertEqual(reused.status_code, 409)
        self.assertEqual(reused.json()["code"], "idempotency_conflict")

    def test_correction_needs_an_idempotency_key(self):
        response = self.post_correction(key=False)

        self.assertEqual(response.status_code, 400)
        self.assertIn("Idempotency-Key", response.json())
        self.assertEqual(RentEntry.objects.count(), 1)

    def test_correction_refuses_the_rate_month_and_tenancy(self):
        for field in ("electricityRate", "billingMonth", "tenancyId"):
            with self.subTest(field=field):
                response = self.post_correction(**{field: "1"})
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json())
        self.assertEqual(RentEntry.objects.count(), 1)

    def test_correction_validates_the_charges_and_reason(self):
        for changes, field in (
            ({"rentAmount": "0"}, "rentAmount"),
            ({"electricityUnits": "-1"}, "electricityUnits"),
            ({"waterAmount": "1.001"}, "waterAmount"),
            ({"reason": ""}, "reason"),
        ):
            with self.subTest(changes=changes):
                response = self.post_correction(**changes)
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json())

    def test_correction_that_changes_nothing_is_400(self):
        response = self.post_correction(electricityUnits="750")

        self.assertEqual(response.status_code, 400)
        self.assertIn("nonFieldErrors", response.json())

    def test_correction_with_payments_that_count_is_409(self):
        self.pay()

        response = self.post_correction()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "unreversed_payments")

    def test_correcting_a_void_bill_is_409(self):
        self.void()

        response = self.post_correction()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "entry_void")

    def test_a_payment_on_a_void_bill_is_409(self):
        self.void()

        response = self.client.post(
            f"{entries_url(self.property, self.tenancy)}{self.entry.id}/payments/",
            {"amount": "100.00", "paidDate": "2026-10-05"},
            format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "entry_void")

    def test_managers_are_forbidden_and_strangers_find_nothing(self):
        manager = self.make_manager()
        self.client.force_authenticate(manager)
        self.assertEqual(self.post_void().status_code, 403)
        self.assertEqual(self.post_correction().status_code, 403)

        self.client.force_authenticate(make_user("stranger"))
        self.assertEqual(self.post_void().status_code, 404)
        self.assertEqual(self.post_correction().status_code, 404)

        self.assertEqual(RentEntry.objects.get(pk=self.entry.pk).status, "active")

    def test_another_tenancys_bill_is_404(self):
        other = make_tenancy(self.property, flat_number="301")

        response = self.client.post(
            void_url(self.property, other, self.entry.id), {"reason": REASON}, format="json"
        )

        self.assertEqual(response.status_code, 404)


class BillStatusFilterTests(BillCorrectionTestCase):
    def setUp(self):
        super().setUp()
        self.replacement = self.correct().replacement
        self.url = entries_url(self.property, self.tenancy)

    def ids(self, **params):
        response = self.client.get(self.url, params)
        self.assertEqual(response.status_code, 200)
        return [entry["id"] for entry in response.json()["results"]]

    def test_lists_active_bills_unless_asked_for_void_ones(self):
        self.assertEqual(self.ids(), [str(self.replacement.id)])
        self.assertEqual(self.ids(status="active"), [str(self.replacement.id)])
        self.assertEqual(self.ids(status="void"), [str(self.entry.id)])
        self.assertEqual(self.ids(status="all"), [str(self.replacement.id), str(self.entry.id)])

    def test_payment_status_filters_never_include_void_bills(self):
        for payment_status in ("unpaid", "partially_paid", "paid"):
            with self.subTest(payment_status=payment_status):
                self.assertNotIn(
                    str(self.entry.id), self.ids(status="all", payment_status=payment_status)
                )
        self.assertEqual(
            self.ids(status="all", payment_status="unpaid"), [str(self.replacement.id)]
        )

    def test_the_month_check_finds_only_the_active_bill(self):
        self.assertEqual(self.ids(billing_month="2026-10"), [str(self.replacement.id)])

    def test_an_unknown_status_is_400(self):
        response = self.client.get(self.url, {"status": "deleted"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("status", response.json())

    def test_a_void_bill_is_still_retrieved_by_id(self):
        response = self.client.get(f"{self.url}{self.entry.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "void")

    def test_lists_without_a_query_per_bill(self):
        for month in (11, 12):
            make_entry(self.tenancy, self.owner, month=date(2026, month, 1))

        # The property (with the user's role), tenancy, count and the page (voiders and
        # replacements joined), however many bills.
        with self.assertNumQueries(4):
            self.client.get(self.url, {"status": "all"})
