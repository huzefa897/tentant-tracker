"""Bills with payments: initial payments, retries of bill creation, balances in responses and
the payment-status filter."""

import uuid
from datetime import date
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APIClient

from billing.models import Payment, RentEntry

from .factories import make_property, make_tenancy, make_user
from .test_payments_api import entries_url, freeze_business_date, make_entry, make_payment

BILL = {
    "billingMonth": "2026-10",
    "rentAmount": "15000.00",
    "electricityUnits": "75.000",
    "waterAmount": "300.00",
    "notes": "",
}
INITIAL = {"amount": "10000.00", "paidDate": "2026-10-05", "notes": "Initial payment"}


class InitialPaymentTests(TestCase):
    def setUp(self):
        freeze_business_date(self)
        self.user = make_user()
        self.property = make_property(member=self.user)
        self.tenancy = make_tenancy(self.property)
        self.url = entries_url(self.property, self.tenancy)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def create(self, key=None, initial=INITIAL, **changes):
        body = {**BILL, **changes}
        if initial is not None:
            body["initialPayment"] = initial
        headers = {} if key is False else {"Idempotency-Key": str(key or uuid.uuid4())}
        return self.client.post(self.url, body, format="json", headers=headers)

    def test_creates_the_bill_and_its_initial_payment_together(self):
        response = self.create()

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["totalPaid"], "10000.00")
        self.assertEqual(body["outstandingAmount"], "5750.00")
        self.assertEqual(body["paymentStatus"], "partially_paid")
        payment = Payment.objects.get()
        self.assertEqual(str(payment.entry_id), body["id"])
        self.assertEqual(payment.notes, "Initial payment")
        self.assertEqual(payment.created_by, self.user)

    def test_an_initial_payment_requires_an_idempotency_key(self):
        response = self.create(key=False)

        self.assertEqual(response.status_code, 400)
        self.assertIn("Idempotency-Key", response.json())
        self.assertFalse(RentEntry.objects.exists())

    def test_a_bill_without_a_payment_needs_no_key(self):
        response = self.create(key=False, initial=None)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["paymentStatus"], "unpaid")

    def test_an_invalid_initial_payment_saves_nothing(self):
        for initial in (
            {**INITIAL, "amount": "0"},
            {**INITIAL, "paidDate": "2026-10-08"},
            {"amount": "100.00"},
        ):
            with self.subTest(initial=initial):
                response = self.create(initial=initial)

                self.assertEqual(response.status_code, 400)
                self.assertIn("initialPayment", response.json())
        self.assertFalse(RentEntry.objects.exists())

    def test_an_initial_payment_over_the_bill_rolls_the_bill_back(self):
        response = self.create(initial={**INITIAL, "amount": "15750.01"})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "payment_exceeds_outstanding")
        self.assertEqual(response.json()["outstandingAmount"], "15750.00")
        self.assertFalse(RentEntry.objects.exists())
        self.assertFalse(Payment.objects.exists())

    def test_the_initial_payment_may_settle_the_bill(self):
        response = self.create(initial={**INITIAL, "amount": "15750.00"})

        self.assertEqual(response.json()["paymentStatus"], "paid")

    def test_a_failing_payment_insert_rolls_the_bill_back(self):
        with mock.patch.object(Payment.objects, "create", side_effect=IntegrityError("boom")):
            with self.assertRaises(IntegrityError):
                self.create()

        self.assertFalse(RentEntry.objects.exists())
        self.assertFalse(Payment.objects.exists())

    def test_a_retry_returns_the_bill_it_created(self):
        key = uuid.uuid4()
        first = self.create(key=key)

        retry = self.create(key=key)

        self.assertEqual(first.status_code, 201)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()["id"], first.json()["id"])
        self.assertEqual(RentEntry.objects.count(), 1)
        self.assertEqual(Payment.objects.count(), 1)

    def test_later_payments_dont_make_a_genuine_retry_conflict(self):
        key = uuid.uuid4()
        entry_id = self.create(key=key).json()["id"]
        make_payment(RentEntry.objects.get(pk=entry_id), self.user, "5750.00")

        retry = self.create(key=key)

        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()["paymentStatus"], "paid")

    def test_the_same_key_with_other_details_is_a_conflict(self):
        key = uuid.uuid4()
        self.create(key=key)

        for changes in (
            {"waterAmount": "301.00"},
            {"initial": {**INITIAL, "amount": "9000.00"}},
            {"initial": None},
        ):
            with self.subTest(changes=changes):
                response = self.create(key=key, **changes)

                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json()["code"], "idempotency_conflict")
        self.assertEqual(RentEntry.objects.count(), 1)

    def test_a_key_already_used_for_a_payment_cant_create_a_bill_with_one(self):
        september = make_entry(self.tenancy, self.user)
        key = uuid.uuid4()
        make_payment(september, self.user, "100.00", idempotency_key=key)

        response = self.create(key=key)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "idempotency_conflict")
        self.assertEqual(RentEntry.objects.count(), 1)

    def test_a_new_key_for_an_existing_month_is_still_a_duplicate(self):
        self.create()

        response = self.create()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "duplicate_billing_month")


class BalanceTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.property = make_property(member=self.user)
        self.tenancy = make_tenancy(self.property)
        self.url = entries_url(self.property, self.tenancy)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        # ₹15,750 each: unpaid, partially paid, paid.
        self.unpaid = make_entry(self.tenancy, self.user, month=date(2026, 7, 1))
        self.partial = make_entry(self.tenancy, self.user, month=date(2026, 8, 1))
        self.paid = make_entry(self.tenancy, self.user, month=date(2026, 9, 1))
        make_payment(self.partial, self.user, "10000.00")
        make_payment(self.paid, self.user, "15000.00")
        make_payment(self.paid, self.user, "750.00")

    def test_responses_carry_balances_from_the_payments(self):
        listed = {entry["billingMonth"]: entry for entry in self.client.get(self.url).json()["results"]}
        detail = self.client.get(f"{self.url}{self.partial.id}/").json()

        self.assertEqual(
            [(e["totalPaid"], e["outstandingAmount"], e["paymentStatus"]) for e in listed.values()],
            [
                ("15750.00", "0.00", "paid"),
                ("10000.00", "5750.00", "partially_paid"),
                ("0.00", "15750.00", "unpaid"),
            ],
        )
        self.assertEqual(detail["totalPaid"], "10000.00")
        self.assertEqual(detail["outstandingAmount"], "5750.00")

    def test_a_list_sums_payments_in_one_query_not_one_per_bill(self):
        with CaptureQueriesContext(connection) as few:
            self.client.get(self.url)
        for month in range(1, 7):
            entry = make_entry(self.tenancy, self.user, month=date(2026, month, 1))
            make_payment(entry, self.user, "1.00")

        with CaptureQueriesContext(connection) as many:
            response = self.client.get(self.url)

        self.assertEqual(len(response.json()["results"]), 9)
        self.assertEqual(len(many), len(few))

    def test_filters_by_payment_status_before_paging(self):
        for status, entry in (
            ("unpaid", self.unpaid),
            ("partially_paid", self.partial),
            ("paid", self.paid),
        ):
            with self.subTest(status=status):
                body = self.client.get(self.url, {"payment_status": status}).json()

                self.assertEqual(body["count"], 1)
                self.assertEqual([e["id"] for e in body["results"]], [str(entry.id)])

    def test_status_filter_combines_with_year(self):
        body = self.client.get(self.url, {"payment_status": "paid", "year": "2025"}).json()

        self.assertEqual(body["count"], 0)

    def test_status_filter_agrees_with_rounded_electricity(self):
        # A half paisa of electricity rounds up, in SQL as in calculations.py.
        entry = make_entry(self.tenancy, self.user, month=date(2026, 10, 1))
        RentEntry.objects.filter(pk=entry.pk).update(
            electricity_units=Decimal("0.125"), electricity_rate=Decimal("0.20")
        )
        # 0.125 × 0.20 = 0.025 → 0.03; total ₹15,300.03.
        make_payment(entry, self.user, "15300.03")

        body = self.client.get(self.url, {"payment_status": "paid"}).json()

        self.assertIn(str(entry.id), [e["id"] for e in body["results"]])
        self.assertEqual(
            next(e for e in body["results"] if e["id"] == str(entry.id))["paymentStatus"], "paid"
        )

    def test_rejects_an_unknown_status(self):
        response = self.client.get(self.url, {"payment_status": "overdue"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("payment_status", response.json())


class PaymentConstraintTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.entry = make_entry(make_tenancy(make_property(member=self.user)), self.user)

    def test_amount_must_be_positive(self):
        for amount in ("0.00", "-1.00"):
            with self.subTest(amount=amount), self.assertRaises(IntegrityError):
                with transaction.atomic():
                    make_payment(self.entry, self.user, amount)

    def test_a_key_is_used_once(self):
        key = uuid.uuid4()
        make_payment(self.entry, self.user, "1.00", idempotency_key=key)

        with self.assertRaises(IntegrityError), transaction.atomic():
            make_payment(self.entry, self.user, "1.00", idempotency_key=key)

    def test_a_sequence_is_used_once_per_bill_and_starts_at_one(self):
        make_payment(self.entry, self.user, "1.00", sequence=1)

        for sequence in (0, 1):
            with self.subTest(sequence=sequence), self.assertRaises(IntegrityError):
                with transaction.atomic():
                    make_payment(self.entry, self.user, "1.00", sequence=sequence)

    def test_a_bill_with_payments_cant_be_deleted(self):
        make_payment(self.entry, self.user, "1.00")

        with self.assertRaises(Exception), transaction.atomic():
            self.entry.delete()
        self.assertTrue(RentEntry.objects.filter(pk=self.entry.pk).exists())


class PaymentAdminTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_superuser(username="admin", password="pass")
        self.client.force_login(self.admin)
        self.entry = make_entry(make_tenancy(make_property()), self.admin)
        self.payment = make_payment(self.entry, self.admin, "10000.00")

    def test_payments_are_view_only(self):
        self.assertEqual(self.client.get(reverse("admin:billing_payment_changelist")).status_code, 200)
        self.assertEqual(self.client.get(reverse("admin:billing_payment_add")).status_code, 403)
        change = reverse("admin:billing_payment_change", args=[self.payment.pk])
        self.client.post(change, {"amount": "1.00"})
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount, Decimal("10000.00"))
        delete = reverse("admin:billing_payment_delete", args=[self.payment.pk])
        self.assertEqual(self.client.post(delete, {"post": "yes"}).status_code, 403)

    def test_a_bill_shows_its_payments_and_balance(self):
        response = self.client.get(reverse("admin:billing_rententry_change", args=[self.entry.pk]))

        self.assertContains(response, "10000.00")
        self.assertContains(response, "5750.00")
