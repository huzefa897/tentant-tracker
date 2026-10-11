"""Correcting payments: reversals, their effect on balances, receipts and retries, who may
reverse, and the reversal API."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import QuerySet
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from billing.calculations import entry_amounts
from billing.models import Payment, PaymentReversal, Receipt, RentEntry
from billing.services import (
    PaymentNotFoundError,
    PaymentReversedError,
    ReversalConflictError,
    ReversalNotAllowedError,
    issue_payment_receipt,
    record_payment,
    reverse_payment,
)
from billing.summary import ledger_summary
from properties.models import PropertyMembership
from properties.roles import ROLE_CAPABILITIES, Role

from .factories import make_property, make_tenancy, make_user
from .test_payments_api import TODAY, entries_url, make_entry, make_payment, payments_url

REASON = "Entered ₹10,000 instead of ₹1,000."


def reversal_url(prop, tenancy, entry_id, payment_id):
    return f"{payments_url(prop, tenancy, entry_id)}{payment_id}/reversal/"


def receipt_url(prop, tenancy, entry_id, payment_id):
    return f"{payments_url(prop, tenancy, entry_id)}{payment_id}/receipt/"


class ReversalTestCase(TestCase):
    def setUp(self):
        for target in ("billing.services.business_date", "billing.serializers.business_date"):
            patcher = mock.patch(target, return_value=TODAY)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.owner = make_user("owner", name="Huzefa")
        self.property = make_property(name="Saleem Towers", member=self.owner, role="owner")
        self.tenancy = make_tenancy(self.property)
        # September: ₹15,750 due, ₹10,000 recorded by mistake.
        self.entry = make_entry(self.tenancy, self.owner)
        self.payment = record_payment(
            entry_id=self.entry.pk,
            actor=self.owner,
            idempotency_key=uuid.uuid4(),
            validated_data={"amount": Decimal("10000.00"), "paid_date": date(2026, 10, 5)},
        ).payment
        self.url = reversal_url(self.property, self.tenancy, self.entry.id, self.payment.id)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def reverse(self, payment=None, actor=None, reason=REASON):
        return reverse_payment(
            payment_id=(payment or self.payment).pk, actor=actor or self.owner, reason=reason
        )

    def amounts(self, entry=None):
        return entry_amounts(RentEntry.objects.get(pk=(entry or self.entry).pk))

    def issue_receipt(self, payment=None):
        return issue_payment_receipt(payment_id=(payment or self.payment).pk, actor=self.owner)

    def make_manager(self):
        manager = make_user("manager", name="Manager")
        PropertyMembership.objects.create(user=manager, property=self.property, role="manager")
        return manager


class ReversePaymentServiceTests(ReversalTestCase):
    def test_a_reversed_payment_stops_counting_and_stays_as_recorded(self):
        result = self.reverse()

        self.assertTrue(result.created)
        self.assertEqual(result.reversal.payment, self.payment)
        self.assertEqual(result.reversal.reason, REASON)
        self.assertEqual(result.reversal.created_by, self.owner)
        amounts = self.amounts()
        self.assertEqual(amounts.total_paid, Decimal("0.00"))
        self.assertEqual(amounts.outstanding_amount, Decimal("15750.00"))
        self.assertEqual(amounts.payment_status, "unpaid")
        # The original record is unchanged.
        payment = Payment.objects.get(pk=self.payment.pk)
        self.assertEqual(
            (payment.amount, payment.paid_date, payment.sequence),
            (Decimal("10000.00"), date(2026, 10, 5), 1),
        )
        # The returned bill is the balance after the reversal.
        self.assertEqual(entry_amounts(result.entry).outstanding_amount, Decimal("15750.00"))

    def test_a_replacement_payment_counts_instead(self):
        self.reverse()

        record_payment(
            entry_id=self.entry.pk,
            actor=self.owner,
            idempotency_key=uuid.uuid4(),
            validated_data={"amount": Decimal("1000.00"), "paid_date": date(2026, 10, 5)},
        )

        amounts = self.amounts()
        self.assertEqual(amounts.total_paid, Decimal("1000.00"))
        self.assertEqual(amounts.outstanding_amount, Decimal("14750.00"))
        self.assertEqual(self.entry.payments.count(), 2)

    def test_a_paid_bill_becomes_partially_paid(self):
        rest = record_payment(
            entry_id=self.entry.pk,
            actor=self.owner,
            idempotency_key=uuid.uuid4(),
            validated_data={"amount": Decimal("5750.00"), "paid_date": date(2026, 10, 6)},
        ).payment
        self.assertEqual(self.amounts().payment_status, "paid")

        self.reverse(rest)

        self.assertEqual(self.amounts().payment_status, "partially_paid")
        self.assertEqual(self.amounts().outstanding_amount, Decimal("5750.00"))

    def test_the_bills_full_amount_can_be_paid_again_after_a_reversal(self):
        # Overpayment is checked against effective payments only.
        record_payment(
            entry_id=self.entry.pk,
            actor=self.owner,
            idempotency_key=uuid.uuid4(),
            validated_data={"amount": Decimal("5750.00"), "paid_date": date(2026, 10, 6)},
        )
        self.reverse()

        record_payment(
            entry_id=self.entry.pk,
            actor=self.owner,
            idempotency_key=uuid.uuid4(),
            validated_data={"amount": Decimal("10000.00"), "paid_date": date(2026, 10, 7)},
        )

        self.assertEqual(self.amounts().payment_status, "paid")

    def test_voids_the_receipt_and_keeps_its_reference_and_snapshot(self):
        receipt = self.issue_receipt().receipt
        snapshot = {
            field.attname: getattr(receipt, field.attname)
            for field in Receipt._meta.concrete_fields
            if field.name not in ("voided_at", "voided_by", "void_reason")
        }

        result = self.reverse()

        receipt.refresh_from_db()
        self.assertEqual(receipt.voided_at, result.reversal.created_at)
        self.assertEqual(receipt.voided_by, self.owner)
        self.assertEqual(receipt.void_reason, REASON)
        for name, value in snapshot.items():
            self.assertEqual(getattr(receipt, name), value, name)
        self.assertEqual(str(receipt), "Shaik_Zahid_Ali_202_Rent_September 2026 (void)")

    def test_a_payment_without_a_receipt_is_reversed_without_one(self):
        self.reverse()

        self.assertFalse(Receipt.objects.exists())

    def test_the_same_reason_again_returns_the_reversal(self):
        first = self.reverse()

        again = self.reverse(reason=f"  {REASON} ")

        self.assertFalse(again.created)
        self.assertEqual(again.reversal, first.reversal)
        self.assertEqual(PaymentReversal.objects.count(), 1)

    def test_another_reason_conflicts(self):
        self.reverse()

        with self.assertRaises(ReversalConflictError):
            self.reverse(reason="Wrong bill.")
        self.assertEqual(PaymentReversal.objects.get().reason, REASON)

    def test_managers_can_reverse(self):
        manager = self.make_manager()

        self.reverse(actor=manager)

        self.assertEqual(PaymentReversal.objects.get().created_by, manager)
        self.assertEqual(self.amounts().total_paid, Decimal("0.00"))

    def test_a_role_without_the_capability_cant_reverse(self):
        manager = self.make_manager()

        with mock.patch.dict(ROLE_CAPABILITIES, {Role.MANAGER: frozenset()}):
            with self.assertRaises(ReversalNotAllowedError):
                self.reverse(actor=manager)

        self.assertFalse(PaymentReversal.objects.exists())

    def test_ended_access_is_not_found(self):
        PropertyMembership.objects.filter(user=self.owner).update(is_active=False)

        with self.assertRaises(PaymentNotFoundError):
            self.reverse()

    def test_a_missing_payment_is_not_found(self):
        with self.assertRaises(PaymentNotFoundError):
            reverse_payment(payment_id=uuid.uuid4(), actor=self.owner, reason=REASON)

    def test_refuses_an_empty_or_long_reason(self):
        for reason in ("", "   ", "x" * 501):
            with self.subTest(length=len(reason)), self.assertRaises(ValueError):
                self.reverse(reason=reason)

    def test_a_failure_voiding_the_receipt_saves_no_reversal(self):
        receipt = self.issue_receipt().receipt

        with (
            mock.patch.object(QuerySet, "update", side_effect=RuntimeError("database gone")),
            self.assertRaises(RuntimeError),
        ):
            self.reverse()

        self.assertFalse(PaymentReversal.objects.exists())
        receipt.refresh_from_db()
        self.assertIsNone(receipt.voided_at)
        self.assertEqual(self.amounts().total_paid, Decimal("10000.00"))

    def test_the_unique_column_decides_when_both_reach_the_insert(self):
        # As if the check missed an existing reversal: the insert is refused, and the existing
        # one is returned as a retry.
        PaymentReversal.objects.create(payment=self.payment, reason=REASON, created_by=self.owner)
        real_filter = PaymentReversal.objects.filter

        def no_reversal_found(*args, **kwargs):
            found = mock.Mock()
            found.first.return_value = None
            return found if kwargs.get("payment") == self.payment else real_filter(*args, **kwargs)

        with mock.patch("billing.services.PaymentReversal.objects.filter", no_reversal_found):
            result = self.reverse()

        self.assertFalse(result.created)
        self.assertEqual(PaymentReversal.objects.count(), 1)

    def test_one_reversal_per_payment_in_the_database(self):
        PaymentReversal.objects.create(payment=self.payment, reason=REASON, created_by=self.owner)

        with self.assertRaises(IntegrityError), transaction.atomic():
            PaymentReversal.objects.create(
                payment=self.payment, reason="Again", created_by=self.owner
            )

    def test_the_database_refuses_an_empty_reason(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            PaymentReversal.objects.create(payment=self.payment, reason="", created_by=self.owner)

    def test_the_database_refuses_partial_void_details(self):
        receipt = self.issue_receipt().receipt

        with self.assertRaises(IntegrityError), transaction.atomic():
            Receipt.objects.filter(pk=receipt.pk).update(void_reason="Half void")

    def test_a_reversed_payment_cant_be_deleted(self):
        self.reverse()

        with self.assertRaises(Exception), transaction.atomic():
            self.payment.delete()
        self.assertTrue(Payment.objects.filter(pk=self.payment.pk).exists())


class ReversedPaymentReceiptTests(ReversalTestCase):
    def test_a_reversed_payment_gets_no_new_receipt(self):
        self.reverse()

        with self.assertRaises(PaymentReversedError):
            self.issue_receipt()
        self.assertFalse(Receipt.objects.exists())

    def test_issuing_again_returns_the_void_receipt(self):
        issued = self.issue_receipt().receipt
        self.reverse()

        again = self.issue_receipt()

        self.assertFalse(again.created)
        self.assertEqual(again.receipt, issued)
        self.assertIsNotNone(again.receipt.voided_at)
        self.assertEqual(Receipt.objects.count(), 1)

    def test_a_later_receipt_leaves_out_an_earlier_reversed_payment(self):
        self.reverse()
        replacement = record_payment(
            entry_id=self.entry.pk,
            actor=self.owner,
            idempotency_key=uuid.uuid4(),
            validated_data={"amount": Decimal("1000.00"), "paid_date": date(2026, 10, 6)},
        ).payment

        receipt = self.issue_receipt(replacement).receipt

        self.assertEqual(receipt.total_paid, Decimal("1000.00"))
        self.assertEqual(receipt.outstanding_amount, Decimal("14750.00"))

    def test_the_next_months_receipt_counts_only_effective_payments_as_paid(self):
        self.reverse()
        october = make_entry(self.tenancy, self.owner, month=date(2026, 10, 1))
        payment = make_payment(october, self.owner, "1000.00")

        receipt = self.issue_receipt(payment).receipt

        self.assertEqual(receipt.previous_month_outstanding, Decimal("15750.00"))


class ReversalRetryTests(ReversalTestCase):
    def test_retrying_a_reversed_payment_returns_it_reversed(self):
        key = uuid.uuid4()
        original = record_payment(
            entry_id=self.entry.pk,
            actor=self.owner,
            idempotency_key=key,
            validated_data={"amount": Decimal("500.00"), "paid_date": date(2026, 10, 6)},
        ).payment
        self.reverse(original)
        url = payments_url(self.property, self.tenancy, self.entry.id)

        response = self.client.post(
            url,
            {"amount": "500.00", "paidDate": "2026-10-06", "notes": ""},
            format="json",
            headers={"Idempotency-Key": str(key)},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["payment"]["id"], str(original.id))
        self.assertEqual(body["payment"]["status"], "reversed")
        self.assertEqual(body["payment"]["reversal"]["reason"], REASON)
        # Not counted again: only the ₹10,000 payment still counts.
        self.assertEqual(body["entry"]["totalPaid"], "10000.00")
        self.assertEqual(self.entry.payments.count(), 2)

    def test_retrying_a_bill_whose_initial_payment_was_reversed_returns_it_unpaid(self):
        key = uuid.uuid4()
        body = {
            "billingMonth": "2026-10",
            "electricityUnits": "75.000",
            "waterAmount": "300.00",
            "initialPayment": {"amount": "10000.00", "paidDate": "2026-10-05"},
        }
        url = entries_url(self.property, self.tenancy)
        created = self.client.post(url, body, format="json", headers={"Idempotency-Key": str(key)})
        self.assertEqual(created.json()["totalPaid"], "10000.00")
        self.reverse(Payment.objects.get(idempotency_key=key))

        retried = self.client.post(url, body, format="json", headers={"Idempotency-Key": str(key)})

        self.assertEqual(retried.status_code, 200)
        self.assertEqual(retried.json()["id"], created.json()["id"])
        self.assertEqual(retried.json()["totalPaid"], "0.00")
        self.assertEqual(retried.json()["paymentStatus"], "unpaid")
        self.assertEqual(Payment.objects.filter(idempotency_key=key).count(), 1)


class ReversalApiTests(ReversalTestCase):
    def post(self, body=None, url=None, client=None):
        return (client or self.client).post(
            url or self.url, {"reason": REASON} if body is None else body, format="json"
        )

    def test_reverses_and_returns_the_payment_and_the_bill(self):
        response = self.post()

        self.assertEqual(response.status_code, 201)
        body = response.json()
        reversal = PaymentReversal.objects.get()
        self.assertEqual(body["payment"]["id"], str(self.payment.id))
        self.assertEqual(body["payment"]["amount"], "10000.00")
        self.assertEqual(body["payment"]["status"], "reversed")
        self.assertEqual(
            body["payment"]["reversal"],
            {
                "id": str(reversal.id),
                "reason": REASON,
                "createdAt": body["payment"]["reversal"]["createdAt"],
                "createdByName": "Huzefa",
            },
        )
        datetime.fromisoformat(body["payment"]["reversal"]["createdAt"])
        self.assertEqual(body["entry"]["totalPaid"], "0.00")
        self.assertEqual(body["entry"]["outstandingAmount"], "15750.00")
        self.assertEqual(body["entry"]["paymentStatus"], "unpaid")

    def test_shows_the_voided_receipt(self):
        self.issue_receipt()

        body = self.post().json()

        self.assertEqual(body["payment"]["receipt"]["status"], "void")

    def test_a_matching_retry_is_200_and_another_reason_409(self):
        self.assertEqual(self.post().status_code, 201)

        retry = self.post()
        conflict = self.post({"reason": "Wrong bill."})

        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()["payment"]["status"], "reversed")
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["code"], "reversal_conflict")
        self.assertEqual(PaymentReversal.objects.count(), 1)

    def test_managers_can_reverse(self):
        self.issue_receipt()
        client = APIClient()
        client.force_authenticate(self.make_manager())

        response = self.post(client=client)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["payment"]["status"], "reversed")
        self.assertIsNotNone(Receipt.objects.get().voided_at)

    def test_a_role_without_the_capability_is_refused_and_nothing_changes(self):
        self.issue_receipt()
        client = APIClient()
        client.force_authenticate(self.make_manager())

        with mock.patch.dict(ROLE_CAPABILITIES, {Role.MANAGER: frozenset()}):
            response = self.post(client=client)

        self.assertEqual(response.status_code, 403)
        self.assertFalse(PaymentReversal.objects.exists())
        self.assertIsNone(Receipt.objects.get().voided_at)
        self.assertEqual(self.amounts().total_paid, Decimal("10000.00"))

    def test_without_access_its_not_found(self):
        outsider = make_user("outsider")
        make_property(name="Elsewhere", member=outsider, role="owner")
        client = APIClient()
        client.force_authenticate(outsider)

        self.assertEqual(self.post(client=client).status_code, 404)
        self.assertFalse(PaymentReversal.objects.exists())

    def test_another_bills_payment_is_not_found(self):
        october = make_entry(self.tenancy, self.owner, month=date(2026, 10, 1))
        url = reversal_url(self.property, self.tenancy, october.id, self.payment.id)

        self.assertEqual(self.post(url=url).status_code, 404)

    def test_requires_authentication(self):
        self.assertEqual(self.post(client=APIClient()).status_code, 401)

    def test_validates_the_reason(self):
        cases = [
            ({}, "Say why this payment is being reversed."),
            ({"reason": "   "}, "Say why this payment is being reversed."),
            ({"reason": "x" * 501}, "The reason must be 500 characters or fewer."),
        ]
        for body, message in cases:
            with self.subTest(body=body):
                response = self.post(body)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["reason"], [message])
        self.assertFalse(PaymentReversal.objects.exists())

    def test_trims_the_reason_and_accepts_500_characters(self):
        reason = "x" * 500

        self.assertEqual(self.post({"reason": f"  {reason}  "}).status_code, 201)
        self.assertEqual(PaymentReversal.objects.get().reason, reason)

    def test_refuses_other_fields(self):
        response = self.post({"reason": REASON, "amount": "500.00"})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["amount"], ["Unknown field."])

    def test_only_post(self):
        self.assertEqual(self.client.get(self.url).status_code, 405)


class ReversalHistoryTests(ReversalTestCase):
    def test_payment_history_keeps_reversed_payments_and_marks_them(self):
        replacement = make_payment(self.entry, self.owner, "1000.00")
        self.reverse()
        url = payments_url(self.property, self.tenancy, self.entry.id)

        payments = {p["id"]: p for p in self.client.get(url).json()}

        self.assertEqual(payments[str(self.payment.id)]["status"], "reversed")
        self.assertEqual(payments[str(self.payment.id)]["reversal"]["createdByName"], "Huzefa")
        self.assertEqual(payments[str(replacement.id)]["status"], "recorded")
        self.assertIsNone(payments[str(replacement.id)]["reversal"])

    def test_reversals_load_in_the_list_query(self):
        for _ in range(3):
            self.reverse(make_payment(self.entry, self.owner, "100.00"))
        url = payments_url(self.property, self.tenancy, self.entry.id)

        with self.assertNumQueries(4):
            # Property, tenancy, bill, then payments with their receipts and reversals.
            self.assertEqual(len(self.client.get(url).json()), 4)

    def test_bill_lists_and_status_filters_leave_reversed_payments_out(self):
        self.reverse()
        url = entries_url(self.property, self.tenancy)

        listed = self.client.get(url).json()["results"][0]
        unpaid = self.client.get(url, {"payment_status": "unpaid"}).json()["results"]
        partial = self.client.get(url, {"payment_status": "partially_paid"}).json()["results"]
        detail = self.client.get(f"{url}{self.entry.id}/").json()

        self.assertEqual(listed["totalPaid"], "0.00")
        self.assertEqual([e["id"] for e in unpaid], [str(self.entry.id)])
        self.assertEqual(partial, [])
        self.assertEqual(detail["outstandingAmount"], "15750.00")

    def test_get_receipt_shows_it_void(self):
        self.issue_receipt()
        self.reverse()
        url = receipt_url(self.property, self.tenancy, self.entry.id, self.payment.id)

        body = self.client.get(url).json()
        reissued = self.client.post(url, {}, format="json")

        self.assertEqual(body["status"], "void")
        self.assertEqual(body["voidReason"], REASON)
        datetime.fromisoformat(body["voidedAt"])
        self.assertEqual(body["paymentAmount"], "10000.00")
        self.assertEqual(reissued.status_code, 200)
        self.assertEqual(reissued.json()["status"], "void")

    def test_issuing_a_receipt_for_a_reversed_payment_is_409(self):
        self.reverse()
        url = receipt_url(self.property, self.tenancy, self.entry.id, self.payment.id)

        response = self.client.post(url, {}, format="json")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "payment_reversed")

    def test_the_ledger_summary_counts_reversals_and_leaves_them_out_of_the_totals(self):
        before = dict(ledger_summary())

        self.reverse()
        after = dict(ledger_summary())

        self.assertEqual(after["payment reversals"], "1")
        self.assertEqual(after["total paid"], "0.00")
        self.assertNotEqual(before["payment reversals digest"], after["payment reversals digest"])

    def test_a_reversal_by_someone_without_a_name_says_unnamed_person(self):
        self.owner.name = ""
        self.owner.save()
        self.reverse()
        url = payments_url(self.property, self.tenancy, self.entry.id)

        payments = {p["id"]: p for p in self.client.get(url).json()}

        self.assertEqual(
            payments[str(self.payment.id)]["reversal"]["createdByName"], "Unnamed person"
        )


class ReversalAdminTests(ReversalTestCase):
    def setUp(self):
        super().setUp()
        self.admin = get_user_model().objects.create_superuser(username="admin", password="pass")
        self.client.force_login(self.admin)

    def test_reversals_are_view_only(self):
        reversal = self.reverse().reversal

        self.assertContains(
            self.client.get(reverse("admin:billing_paymentreversal_changelist")), REASON
        )
        self.assertEqual(
            self.client.get(reverse("admin:billing_paymentreversal_add")).status_code, 403
        )
        change = reverse("admin:billing_paymentreversal_change", args=[reversal.pk])
        self.client.post(change, {"reason": "Changed"})
        reversal.refresh_from_db()
        self.assertEqual(reversal.reason, REASON)
        delete = reverse("admin:billing_paymentreversal_delete", args=[reversal.pk])
        self.assertEqual(self.client.post(delete, {"post": "yes"}).status_code, 403)

    def test_payments_and_bills_show_reversed_payments(self):
        self.reverse()

        payments = self.client.get(reverse("admin:billing_payment_changelist"))
        bill = self.client.get(reverse("admin:billing_rententry_change", args=[self.entry.pk]))

        self.assertContains(payments, "Reversed (not counted)")
        self.assertContains(bill, "Reversed (not counted)")
        self.assertContains(bill, "15750.00")

    def test_void_receipts_show_why(self):
        receipt = self.issue_receipt().receipt
        self.reverse()

        response = self.client.get(reverse("admin:billing_receipt_change", args=[receipt.pk]))

        self.assertContains(response, REASON)

