import uuid
from datetime import date, datetime
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from billing.models import Payment, Receipt
from billing.services import (
    PaymentNotFoundError,
    ReceiptConfigurationIncompleteError,
    issue_payment_receipt,
)
from properties.models import PropertyMembership

from .factories import make_property, make_tenancy, make_user
from .test_payments_api import TODAY, make_entry, make_payment, payments_url


def receipt_url(prop, tenancy, entry_id, payment_id):
    return f"{payments_url(prop, tenancy, entry_id)}{payment_id}/receipt/"


class ReceiptTestCase(TestCase):
    def setUp(self):
        patcher = mock.patch("billing.services.business_date", return_value=TODAY)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = make_user(name="Imran Khan")
        self.property = make_property(name="Saleem Towers", member=self.user)
        self.property.contact_number = "+919000000001"
        self.property.save()
        self.tenancy = make_tenancy(self.property)
        # September: ₹15,750 due.
        self.entry = make_entry(self.tenancy, self.user)
        self.payment = make_payment(
            self.entry, self.user, "3000.00", paid_date=date(2026, 10, 6), notes="Bank transfer"
        )
        self.url = receipt_url(self.property, self.tenancy, self.entry.id, self.payment.id)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def issue(self, payment=None):
        return issue_payment_receipt(payment_id=(payment or self.payment).pk, actor=self.user)


class IssueReceiptServiceTests(ReceiptTestCase):
    def test_snapshots_the_payment_and_the_bill_as_it_stood(self):
        result = self.issue()
        receipt = result.receipt

        self.assertTrue(result.created)
        self.assertEqual(Receipt.objects.count(), 1)
        self.assertEqual(receipt.reference, f"RCT-{receipt.id}")
        self.assertEqual(receipt.issued_by, self.user)
        self.assertEqual(receipt.issued_date, TODAY)
        # A ₹3,000 receipt against a ₹15,750 bill: it never implies the bill is paid.
        self.assertEqual(receipt.payment_amount, Decimal("3000.00"))
        self.assertEqual(receipt.total_due, Decimal("15750.00"))
        self.assertEqual(receipt.total_paid, Decimal("3000.00"))
        self.assertEqual(receipt.outstanding_amount, Decimal("12750.00"))
        self.assertEqual(receipt.electricity_amount, Decimal("450.00"))
        self.assertEqual(
            (receipt.issuer_name, receipt.issuer_address, receipt.issuer_contact_number),
            ("Saleem Towers", "1 Main Road", "+919000000001"),
        )
        self.assertEqual(receipt.received_by_name, "Imran Khan")
        self.assertEqual(
            (receipt.tenant_name, receipt.flat_number, receipt.tenant_mobile_number),
            ("Shaik Zahid Ali", "202", "+919000000101"),
        )
        self.assertEqual(receipt.deposit_amount, Decimal("90000.00"))
        self.assertEqual(receipt.rent_due_day, 11)
        self.assertEqual(receipt.billing_month, date(2026, 9, 1))
        self.assertEqual(receipt.paid_date, date(2026, 10, 6))
        self.assertEqual(receipt.payment_notes, "Bank transfer")
        self.assertEqual(receipt.previous_month_outstanding, Decimal("0.00"))

    def test_counts_only_payments_recorded_up_to_this_one(self):
        later = make_payment(self.entry, self.user, "5000.00")

        first = self.issue().receipt
        second = self.issue(later).receipt

        self.assertEqual(first.total_paid, Decimal("3000.00"))
        self.assertEqual(first.outstanding_amount, Decimal("12750.00"))
        self.assertEqual(second.total_paid, Decimal("8000.00"))
        self.assertEqual(second.outstanding_amount, Decimal("7750.00"))

    def test_shows_what_the_previous_month_still_owes(self):
        august = make_entry(self.tenancy, self.user, month=date(2026, 8, 1))
        make_payment(august, self.user, "15000.00")

        self.assertEqual(self.issue().receipt.previous_month_outstanding, Decimal("750.00"))

    def test_a_repeated_request_returns_the_same_receipt(self):
        first = self.issue()
        again = self.issue()

        self.assertFalse(again.created)
        self.assertEqual(again.receipt.pk, first.receipt.pk)
        self.assertEqual(again.receipt.reference, first.receipt.reference)
        self.assertEqual(Receipt.objects.count(), 1)

    def test_later_payments_and_changed_details_never_change_an_issued_receipt(self):
        issued = self.issue().receipt
        make_payment(self.entry, self.user, "12750.00")
        self.tenancy.name = "Someone Else"
        self.tenancy.save()
        self.property.address = "2 New Road"
        self.property.save()

        again = self.issue().receipt

        self.assertEqual(again.tenant_name, "Shaik Zahid Ali")
        self.assertEqual(again.issuer_address, "1 Main Road")
        self.assertEqual(again.outstanding_amount, Decimal("12750.00"))
        self.assertEqual(again.reference, issued.reference)

    def test_refuses_a_new_receipt_without_the_property_address(self):
        self.property.address = "  "
        self.property.save()

        with self.assertRaisesMessage(
            ReceiptConfigurationIncompleteError,
            "Configure the property address before issuing receipts.",
        ):
            self.issue()
        self.assertFalse(Receipt.objects.exists())

    def test_refuses_a_new_receipt_without_the_property_name(self):
        self.property.name = ""
        self.property.save()

        with self.assertRaisesMessage(
            ReceiptConfigurationIncompleteError, "Configure the property name"
        ):
            self.issue()

    def test_reopens_an_issued_receipt_after_the_address_is_cleared(self):
        issued = self.issue().receipt
        self.property.address = ""
        self.property.save()

        again = self.issue()

        self.assertFalse(again.created)
        self.assertEqual(again.receipt.issuer_address, "1 Main Road")
        self.assertEqual(again.receipt.pk, issued.pk)

    def test_an_ended_membership_cannot_issue(self):
        PropertyMembership.objects.filter(user=self.user).update(is_active=False)

        with self.assertRaises(PaymentNotFoundError):
            self.issue()

    def test_a_failed_save_leaves_no_receipt_and_keeps_the_payment(self):
        with (
            mock.patch("billing.services.Receipt.objects.create", side_effect=RuntimeError),
            self.assertRaises(RuntimeError),
        ):
            self.issue()

        self.assertFalse(Receipt.objects.exists())
        self.assertTrue(Payment.objects.filter(pk=self.payment.pk).exists())


class ReceiptApiTests(ReceiptTestCase):
    def test_post_issues_the_receipt_from_saved_records(self):
        response = self.client.post(self.url, {}, format="json")

        self.assertEqual(response.status_code, 201)
        receipt = Receipt.objects.get()
        self.assertEqual(
            response.json(),
            {
                "id": str(receipt.id),
                "reference": f"RCT-{receipt.id}",
                "paymentId": str(self.payment.id),
                "entryId": str(self.entry.id),
                "issuedAt": response.json()["issuedAt"],
                "issuedDate": "2026-10-07",
                "issuer": {
                    "name": "Saleem Towers",
                    "address": "1 Main Road",
                    "contactNumber": "+919000000001",
                    "receivedBy": "Imran Khan",
                },
                "tenant": {
                    "name": "Shaik Zahid Ali",
                    "flatNumber": "202",
                    "mobileNumber": "+919000000101",
                    "depositAmount": "90000.00",
                },
                "billingMonth": "2026-09",
                "rentDueDay": 11,
                "charges": {
                    "rentAmount": "15000.00",
                    "electricityUnits": "75.000",
                    "electricityRate": "6.00",
                    "electricityAmount": "450.00",
                    "waterAmount": "300.00",
                },
                "totalDue": "15750.00",
                "totalPaid": "3000.00",
                "outstandingAmount": "12750.00",
                "previousMonthOutstanding": "0.00",
                "paymentAmount": "3000.00",
                "paidDate": "2026-10-06",
                "paymentNotes": "Bank transfer",
            },
        )
        datetime.fromisoformat(response.json()["issuedAt"])

    def test_post_again_returns_the_existing_receipt(self):
        first = self.client.post(self.url, {}, format="json")
        again = self.client.post(self.url, format="json")

        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.json(), first.json())
        self.assertEqual(Receipt.objects.count(), 1)

    def test_get_returns_the_snapshot_after_details_change(self):
        issued = self.client.post(self.url, {}, format="json").json()
        self.tenancy.name = "Someone Else"
        self.tenancy.save()

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), issued)

    def test_get_never_issues_a_receipt(self):
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 404)
        self.assertFalse(Receipt.objects.exists())

    def test_incomplete_configuration_is_a_readable_400(self):
        self.property.address = ""
        self.property.save()

        response = self.client.post(self.url, {}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json(),
            {
                "code": "receipt_configuration_incomplete",
                "detail": "Configure the property address before issuing receipts.",
            },
        )

    def test_refuses_a_request_body(self):
        response = self.client.post(self.url, {"paymentAmount": "15750.00"}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Receipt.objects.exists())

    def test_requires_authentication(self):
        self.client.force_authenticate(None)

        self.assertEqual(self.client.post(self.url, {}, format="json").status_code, 401)
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_a_payment_under_another_bills_url_is_404(self):
        october = make_entry(self.tenancy, self.user, month=date(2026, 10, 1))
        url = receipt_url(self.property, self.tenancy, october.id, self.payment.id)

        self.assertEqual(self.client.post(url, {}, format="json").status_code, 404)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertFalse(Receipt.objects.exists())

    def test_another_tenancys_or_propertys_url_is_404(self):
        self.issue()
        other_tenancy = make_tenancy(self.property, flat_number="301", name="Mohammed Yusuf")
        other_property = make_property(name="Annex", member=self.user)
        for url in (
            receipt_url(self.property, other_tenancy, self.entry.id, self.payment.id),
            receipt_url(other_property, self.tenancy, self.entry.id, self.payment.id),
        ):
            self.assertEqual(self.client.get(url).status_code, 404)
            self.assertEqual(self.client.post(url, {}, format="json").status_code, 404)

    def test_an_unknown_payment_is_404(self):
        url = receipt_url(self.property, self.tenancy, self.entry.id, uuid.uuid4())

        self.assertEqual(self.client.post(url, {}, format="json").status_code, 404)

    def test_an_ended_membership_can_neither_issue_nor_retrieve(self):
        self.issue()
        PropertyMembership.objects.filter(user=self.user).update(is_active=False)

        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.client.post(self.url, {}, format="json").status_code, 404)

    def test_a_role_without_issue_receipts_is_403(self):
        with mock.patch("billing.views.role_can", return_value=False):
            response = self.client.post(self.url, {}, format="json")

        self.assertEqual(response.status_code, 403)
        self.assertFalse(Receipt.objects.exists())

    def test_no_update_or_delete(self):
        self.issue()

        self.assertEqual(self.client.put(self.url, {}, format="json").status_code, 405)
        self.assertEqual(self.client.patch(self.url, {}, format="json").status_code, 405)
        self.assertEqual(self.client.delete(self.url).status_code, 405)


class PaymentReceiptMetadataTests(ReceiptTestCase):
    def setUp(self):
        super().setUp()
        self.list_url = payments_url(self.property, self.tenancy, self.entry.id)

    def test_payments_show_their_receipt_or_null(self):
        receipt = self.issue().receipt
        unreceipted = make_payment(self.entry, self.user, "1000.00", paid_date=date(2026, 10, 7))

        payments = {p["id"]: p for p in self.client.get(self.list_url).json()}

        self.assertEqual(
            payments[str(self.payment.id)]["receipt"],
            {"id": str(receipt.id), "reference": receipt.reference},
        )
        self.assertIsNone(payments[str(unreceipted.id)]["receipt"])

    def test_receipts_load_in_the_list_query(self):
        for amount in ("1000.00", "1000.00", "1000.00"):
            self.issue(make_payment(self.entry, self.user, amount))

        with self.assertNumQueries(4):
            # Property, tenancy, bill, then payments with their receipts (no query per payment).
            response = self.client.get(self.list_url)

        self.assertEqual(len(response.json()), 4)


class ReceiptAdminTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_superuser(username="admin", password="pass")
        self.client.force_login(self.admin)
        entry = make_entry(make_tenancy(make_property(member=self.admin)), self.admin)
        payment = make_payment(entry, self.admin, "3000.00")
        self.receipt = issue_payment_receipt(payment_id=payment.pk, actor=self.admin).receipt

    def test_receipts_are_view_only_and_searchable(self):
        changelist = reverse("admin:billing_receipt_changelist")
        response = self.client.get(changelist, {"q": self.receipt.reference})
        self.assertContains(response, self.receipt.reference)
        self.assertContains(response, "Shaik Zahid Ali")

        self.assertEqual(self.client.get(reverse("admin:billing_receipt_add")).status_code, 403)
        change = reverse("admin:billing_receipt_change", args=[self.receipt.pk])
        self.client.post(change, {"tenant_name": "Changed"})
        self.receipt.refresh_from_db()
        self.assertEqual(self.receipt.tenant_name, "Shaik Zahid Ali")
        delete = reverse("admin:billing_receipt_delete", args=[self.receipt.pk])
        self.assertEqual(self.client.post(delete, {"post": "yes"}).status_code, 403)
