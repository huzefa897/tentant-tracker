import uuid
from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from billing.models import Payment, RentEntry
from billing.periods import period_for_bill
from properties.models import PropertyMembership

from .factories import make_property, make_tenancy, make_user

TODAY = date(2026, 10, 7)


def entries_url(prop, tenancy):
    return f"/api/v1/properties/{prop.id}/tenancies/{tenancy.id}/entries/"


def payments_url(prop, tenancy, entry_id):
    return f"{entries_url(prop, tenancy)}{entry_id}/payments/"


def make_entry(tenancy, user, month=date(2026, 9, 1)):
    # ₹15,000 + 75 × ₹6 + ₹300 = ₹15,750. With its month's rental period, as every bill has.
    period_for_bill(tenancy, month)
    return RentEntry.objects.create(
        tenancy=tenancy,
        billing_month=month,
        rent_amount=Decimal("15000.00"),
        electricity_units=Decimal("75.000"),
        electricity_rate=Decimal("6.00"),
        water_amount=Decimal("300.00"),
        created_by=user,
    )


def make_payment(entry, user, amount, **fields):
    # The next sequence on the bill, as record_payment gives it.
    defaults = {
        "paid_date": date(2026, 10, 1),
        "idempotency_key": uuid.uuid4(),
        "sequence": entry.payments.count() + 1,
    }
    return Payment.objects.create(
        entry=entry, amount=Decimal(amount), created_by=user, **{**defaults, **fields}
    )


def freeze_business_date(test):
    """Today at the property is TODAY, for the paid-date checks."""
    patcher = mock.patch("billing.serializers.business_date", return_value=TODAY)
    patcher.start()
    test.addCleanup(patcher.stop)


class PaymentApiTestCase(TestCase):
    def setUp(self):
        freeze_business_date(self)
        self.user = make_user()
        self.property = make_property(member=self.user)
        self.tenancy = make_tenancy(self.property)
        self.entry = make_entry(self.tenancy, self.user)
        self.url = payments_url(self.property, self.tenancy, self.entry.id)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def pay(self, amount="3000.00", key=None, url=None, **fields):
        body = {"amount": amount, "paidDate": "2026-10-05", "notes": "Bank transfer", **fields}
        body = {name: value for name, value in body.items() if value is not None}
        headers = {} if key is False else {"Idempotency-Key": str(key or uuid.uuid4())}
        return self.client.post(url or self.url, body, format="json", headers=headers)


class RecordPaymentTests(PaymentApiTestCase):
    def test_records_a_payment_and_returns_it_with_the_updated_bill(self):
        make_payment(self.entry, self.user, "10000.00")

        response = self.pay("3000.00")

        self.assertEqual(response.status_code, 201)
        payment = Payment.objects.get(amount=Decimal("3000.00"))
        body = response.json()
        self.assertEqual(
            {key: value for key, value in body["payment"].items() if key != "createdAt"},
            {
                "id": str(payment.id),
                "entryId": str(self.entry.id),
                "amount": "3000.00",
                "paidDate": "2026-10-05",
                "notes": "Bank transfer",
                "status": "recorded",
                "reversal": None,
                "receipt": None,
            },
        )
        self.assertEqual(body["entry"]["id"], str(self.entry.id))
        self.assertEqual(body["entry"]["totalDue"], "15750.00")
        self.assertEqual(body["entry"]["totalPaid"], "13000.00")
        self.assertEqual(body["entry"]["outstandingAmount"], "2750.00")
        self.assertEqual(body["entry"]["paymentStatus"], "partially_paid")

    def test_assigns_the_bill_and_creator_on_the_server(self):
        self.pay()

        payment = Payment.objects.get()
        self.assertEqual(payment.entry, self.entry)
        self.assertEqual(payment.created_by, self.user)

    def test_paying_the_outstanding_amount_settles_the_bill(self):
        make_payment(self.entry, self.user, "13000.00")

        response = self.pay("2750.00")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["entry"]["paymentStatus"], "paid")
        self.assertEqual(response.json()["entry"]["outstandingAmount"], "0.00")

    def test_refuses_more_than_the_outstanding_amount_and_says_what_it_is(self):
        make_payment(self.entry, self.user, "13000.00")

        response = self.pay("3000.00")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "payment_exceeds_outstanding")
        self.assertEqual(response.json()["outstandingAmount"], "2750.00")
        self.assertEqual(Payment.objects.count(), 1)

    def test_a_fully_paid_bill_takes_no_more_payments(self):
        make_payment(self.entry, self.user, "15750.00")

        response = self.pay("1.00")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["outstandingAmount"], "0.00")
        self.assertEqual(response.json()["detail"], "This bill is already fully paid.")

    def test_same_amount_and_date_are_separate_payments_with_separate_keys(self):
        self.assertEqual(self.pay("1000.00").status_code, 201)
        self.assertEqual(self.pay("1000.00").status_code, 201)

        self.assertEqual(Payment.objects.count(), 2)

    def test_an_ended_tenancys_unpaid_bill_can_still_be_paid(self):
        self.tenancy.end_date = date(2026, 9, 30)
        self.tenancy.save()

        self.assertEqual(self.pay().status_code, 201)

    def test_a_payment_may_be_made_after_the_billing_month(self):
        # September's bill, paid in October (and today).
        self.assertEqual(self.pay(paidDate=TODAY.isoformat()).status_code, 201)

    def test_validates_amount_date_and_notes(self):
        cases = [
            ({"amount": "0"}, "amount", "Enter an amount greater than zero."),
            ({"amount": "-5"}, "amount", "Enter an amount greater than zero."),
            ({"amount": "10.005"}, "amount", "Amount can have at most two decimal places."),
            ({"amount": "abc"}, "amount", "A valid number is required."),
            ({"amount": None}, "amount", "This field is required."),
            ({"paidDate": None}, "paidDate", "This field is required."),
            ({"paidDate": "2026-02-30"}, "paidDate", None),
            (
                {"paidDate": (TODAY + timedelta(1)).isoformat()},
                "paidDate",
                "The paid date can't be in the future.",
            ),
            ({"notes": "x" * 501}, "notes", "Notes must be 500 characters or fewer."),
        ]
        for fields, field, message in cases:
            with self.subTest(fields=fields):
                response = self.pay(**{"amount": "100.00", **fields})

                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json())
                if message:
                    self.assertEqual(response.json()[field], [message])
        self.assertFalse(Payment.objects.exists())

    def test_trims_notes_and_allows_none(self):
        self.pay(notes="  Cash  ")
        self.pay(notes=None)

        self.assertEqual(sorted(Payment.objects.values_list("notes", flat=True)), ["", "Cash"])

    def test_refuses_balances_and_server_fields_rather_than_ignoring_them(self):
        for field, message in [
            ("totalPaid", "This is calculated by the server."),
            ("outstandingAmount", "This is calculated by the server."),
            ("paymentStatus", "This is calculated by the server."),
            ("createdBy", "This is set by the server."),
            ("id", "This is set by the server."),
            ("entry", "Unknown field."),
        ]:
            with self.subTest(field=field):
                response = self.pay(**{field: "1"})

                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json(), {field: [message]})
        self.assertFalse(Payment.objects.exists())

    def test_requires_a_uuid_idempotency_key(self):
        self.assertEqual(self.pay(key=False).status_code, 400)
        self.assertIn("Idempotency-Key", self.pay(key=False).json())
        self.assertEqual(self.pay(key="not-a-uuid").status_code, 400)
        self.assertFalse(Payment.objects.exists())


    def test_numbers_each_bills_payments_in_recorded_order(self):
        other_bill = make_entry(self.tenancy, self.user, month=date(2026, 10, 1))
        make_payment(other_bill, self.user, "700.00")

        self.pay("1000.00")
        self.pay("2000.00")

        self.assertEqual(
            list(self.entry.payments.order_by("sequence").values_list("amount", "sequence")),
            [(Decimal("1000.00"), 1), (Decimal("2000.00"), 2)],
        )


class PaymentRetryTests(PaymentApiTestCase):
    def test_a_retry_returns_the_payment_already_recorded(self):
        key = uuid.uuid4()
        first = self.pay("3000.00", key=key)

        retry = self.pay("3000", key=key, notes=" Bank transfer ")

        self.assertEqual(first.status_code, 201)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()["payment"], first.json()["payment"])
        self.assertEqual(Payment.objects.count(), 1)

    def test_a_retry_shows_the_bills_current_balance(self):
        key = uuid.uuid4()
        self.pay("3000.00", key=key)
        self.pay("2000.00")

        retry = self.pay("3000.00", key=key)

        self.assertEqual(retry.json()["entry"]["totalPaid"], "5000.00")

    def test_a_retry_of_the_payment_that_settled_the_bill_succeeds(self):
        key = uuid.uuid4()
        self.assertEqual(self.pay("15750.00", key=key).status_code, 201)

        retry = self.pay("15750.00", key=key)

        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()["entry"]["paymentStatus"], "paid")
        self.assertEqual(Payment.objects.count(), 1)

    def test_the_same_key_with_other_details_is_a_conflict(self):
        key = uuid.uuid4()
        self.pay("3000.00", key=key)

        for fields in ({"amount": "3001.00"}, {"paidDate": "2026-10-04"}, {"notes": "Cash"}):
            with self.subTest(fields=fields):
                response = self.pay(key=key, **{"amount": "3000.00", **fields})

                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json()["code"], "idempotency_conflict")
        self.assertEqual(Payment.objects.count(), 1)

    def test_the_same_key_on_another_bill_is_a_conflict(self):
        key = uuid.uuid4()
        self.pay("3000.00", key=key)
        october = make_entry(self.tenancy, self.user, month=date(2026, 10, 1))

        response = self.pay(
            "3000.00", key=key, url=payments_url(self.property, self.tenancy, october.id)
        )

        self.assertEqual(response.status_code, 409)
        self.assertFalse(october.payments.exists())

    def test_the_same_key_from_another_person_is_a_conflict(self):
        key = uuid.uuid4()
        self.pay("3000.00", key=key)
        colleague = make_user("colleague")
        PropertyMembership.objects.create(user=colleague, property=self.property, role="owner")
        self.client.force_authenticate(colleague)

        response = self.pay("3000.00", key=key)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(Payment.objects.count(), 1)


class PaymentAccessTests(PaymentApiTestCase):
    def test_another_propertys_bill_is_not_found(self):
        other_property = make_property("Other")
        other_tenancy = make_tenancy(other_property)
        other_entry = make_entry(other_tenancy, self.user)
        url = payments_url(other_property, other_tenancy, other_entry.id)

        self.assertEqual(self.pay(url=url).status_code, 404)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertFalse(Payment.objects.exists())

    def test_a_bill_reached_through_another_tenancy_is_not_found(self):
        neighbour = make_tenancy(self.property, flat_number="301")
        url = payments_url(self.property, neighbour, self.entry.id)

        self.assertEqual(self.pay(url=url).status_code, 404)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_an_ended_membership_can_neither_record_nor_read(self):
        self.pay()
        PropertyMembership.objects.filter(user=self.user).update(is_active=False)

        self.assertEqual(self.pay().status_code, 404)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(Payment.objects.count(), 1)

    def test_a_retry_after_access_ended_returns_nothing(self):
        key = uuid.uuid4()
        self.pay(key=key)
        PropertyMembership.objects.filter(user=self.user).update(is_active=False)

        response = self.pay(key=key)

        self.assertEqual(response.status_code, 404)
        self.assertNotIn("payment", response.json())

    def test_requires_authentication(self):
        self.client.force_authenticate(None)

        self.assertEqual(self.pay().status_code, 401)
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_a_role_without_the_capability_is_refused(self):
        with mock.patch("billing.views.role_can", return_value=False):
            response = self.pay()

        self.assertEqual(response.status_code, 403)
        self.assertFalse(Payment.objects.exists())

    def test_the_service_checks_access_again_inside_the_lock(self):
        # As if the membership ended between the view's lookup and the payment.
        with mock.patch("billing.services.properties_for_user") as scoped:
            scoped.return_value.filter.return_value.values_list.return_value.first.return_value = (
                None
            )
            response = self.pay()

        self.assertEqual(response.status_code, 404)
        self.assertFalse(Payment.objects.exists())


class PaymentHistoryTests(PaymentApiTestCase):
    def test_lists_the_bills_payments_newest_first(self):
        older = make_payment(self.entry, self.user, "1000.00", paid_date=date(2026, 10, 1))
        newer = make_payment(self.entry, self.user, "2000.00", paid_date=date(2026, 10, 3))
        same_day_later = make_payment(self.entry, self.user, "500.00", paid_date=date(2026, 10, 3))
        # The same day, recorded later: by sequence, even if the clock says otherwise.
        Payment.objects.filter(pk=same_day_later.pk).update(created_at=older.created_at)
        other_bill = make_entry(self.tenancy, self.user, month=date(2026, 10, 1))
        make_payment(other_bill, self.user, "700.00")

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [payment["id"] for payment in response.json()],
            [str(same_day_later.id), str(newer.id), str(older.id)],
        )
        self.assertEqual(
            set(response.json()[0]),
            {
                "id",
                "entryId",
                "amount",
                "paidDate",
                "notes",
                "createdAt",
                "status",
                "reversal",
                "receipt",
            },
        )

    def test_payments_are_read_only(self):
        payment = make_payment(self.entry, self.user, "1000.00")

        for method in ("put", "patch", "delete"):
            with self.subTest(method=method):
                response = getattr(self.client, method)(self.url, {}, format="json")
                self.assertEqual(response.status_code, 405)
        self.assertEqual(self.client.get(f"{self.url}{payment.id}/").status_code, 404)
        self.assertTrue(Payment.objects.filter(pk=payment.pk).exists())
