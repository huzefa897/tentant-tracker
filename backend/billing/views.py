import re
import uuid

from rest_framework import exceptions, mixins, status, viewsets
from rest_framework.generics import get_object_or_404
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from properties.models import Tenancy
from properties.queries import properties_for_user
from properties.roles import Capability, role_can

from .calculations import PaymentStatus
from .models import Payment, Receipt, RentEntry
from .serializers import (
    BillingMonthField,
    PaymentCreateSerializer,
    PaymentSerializer,
    ReceiptSerializer,
    RentEntryCreateSerializer,
    RentEntrySerializer,
)
from .services import (
    BillingMonthOutsideTenancyError,
    DuplicateBillingMonthError,
    EntryNotFoundError,
    IdempotencyConflictError,
    PaymentExceedsOutstandingError,
    PaymentNotAllowedError,
    PaymentNotFoundError,
    ReceiptConfigurationIncompleteError,
    ReceiptNotAllowedError,
    create_rent_entry,
    issue_payment_receipt,
    record_payment,
)

# 0001–9999: Django builds a date from the year, and there is no year 0.
YEAR_PATTERN = re.compile(r"^(?!0000)\d{4}$")
PAYMENT_STATUSES = (PaymentStatus.UNPAID, PaymentStatus.PARTIALLY_PAID, PaymentStatus.PAID)
IDEMPOTENCY_HEADER = "Idempotency-Key"


class DuplicateBillingMonth(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = {
        "code": "duplicate_billing_month",
        "detail": "An entry already exists for this tenancy and billing month.",
    }
    default_code = "duplicate_billing_month"


class IdempotencyConflict(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = {
        "code": "idempotency_conflict",
        "detail": "This request key was already used for a different request.",
    }
    default_code = "idempotency_conflict"


class PaymentExceedsOutstanding(exceptions.APIException):
    """With the current outstanding amount, so the app can refresh its preview."""

    status_code = status.HTTP_409_CONFLICT
    default_code = "payment_exceeds_outstanding"

    def __init__(self, outstanding):
        super().__init__(
            {
                "code": "payment_exceeds_outstanding",
                "detail": "This bill is already fully paid."
                if outstanding <= 0
                else f"The payment is more than the outstanding ₹{outstanding}.",
                "outstandingAmount": str(outstanding),
            }
        )


class ReceiptConfigurationIncomplete(exceptions.APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "receipt_configuration_incomplete"

    def __init__(self, detail: str):
        super().__init__({"code": "receipt_configuration_incomplete", "detail": detail})


def idempotency_key(request, required: bool):
    """The request's Idempotency-Key header as a UUID: one per intended operation, reused only
    by retries of it."""
    value = request.headers.get(IDEMPOTENCY_HEADER)
    if value is None or value == "":
        if required:
            raise exceptions.ValidationError(
                {IDEMPOTENCY_HEADER: ["Send an Idempotency-Key header (a UUID) with this request."]}
            )
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        raise exceptions.ValidationError(
            {IDEMPOTENCY_HEADER: ["The Idempotency-Key header must be a UUID."]}
        ) from None


class ScopedLookupMixin:
    """Property, then tenancy, then bill, then payment, each found only within the one before,
    so a record under another property's or tenancy's URL 404s rather than trusting the URL.
    Every billing view looks records up through these."""

    def get_property(self):
        # Through the user's active memberships first, so another property 404s before its
        # tenancies or bills are looked at. Annotated with the user's role there.
        if not hasattr(self, "_property"):
            self._property = get_object_or_404(
                properties_for_user(self.request.user), pk=self.kwargs["property_id"]
            )
        return self._property

    def get_tenancy(self):
        if not hasattr(self, "_tenancy"):
            self._tenancy = get_object_or_404(
                Tenancy.objects.filter(property=self.get_property()),
                pk=self.kwargs["tenancy_id"],
            )
        return self._tenancy

    def get_entry(self):
        if not hasattr(self, "_entry"):
            self._entry = get_object_or_404(
                RentEntry.objects.filter(tenancy=self.get_tenancy()), pk=self.kwargs["entry_id"]
            )
        return self._entry

    def get_payment(self):
        if not hasattr(self, "_payment"):
            self._payment = get_object_or_404(
                Payment.objects.filter(entry=self.get_entry()), pk=self.kwargs["payment_id"]
            )
        return self._payment


class RentEntryPagination(PageNumberPagination):
    """{count, next, previous, results}, a year of bills per page (?page=)."""

    page_size = 12


class RentEntryViewSet(
    ScopedLookupMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """A tenancy's bills: list, retrieve and create. No update or delete: financial
    corrections need deliberate rules first.

    List: newest billing month first; ?year=2026, ?billing_month=2026-10 (to check whether
    a bill exists) and ?payment_status=unpaid|partially_paid|paid, applied before paging.

    Create takes an optional Idempotency-Key header (required with an initialPayment): a retry
    with the same key returns the bill it created (200) instead of creating another.
    """

    serializer_class = RentEntrySerializer
    pagination_class = RentEntryPagination

    def get_queryset(self):
        # Every lookup is limited to the authorised tenancy, so another tenancy's bill 404s.
        # Payments are summed in the same query, never once per bill.
        return (
            RentEntry.objects.filter(tenancy=self.get_tenancy())
            .with_amounts()
            .order_by("-billing_month", "-created_at")
        )

    def filter_queryset(self, queryset):
        if self.action != "list":
            return queryset

        params = self.request.query_params
        year = params.get("year")
        if year is not None:
            if not YEAR_PATTERN.match(year):
                raise exceptions.ValidationError({"year": "Enter a year as YYYY, e.g. 2026."})
            queryset = queryset.filter(billing_month__year=int(year))

        billing_month = params.get("billing_month")
        if billing_month is not None:
            try:
                month = BillingMonthField().to_internal_value(billing_month)
            except exceptions.ValidationError as error:
                raise exceptions.ValidationError({"billing_month": error.detail}) from None
            queryset = queryset.filter(billing_month=month)

        payment_status = params.get("payment_status")
        if payment_status is not None:
            if payment_status not in PAYMENT_STATUSES:
                raise exceptions.ValidationError(
                    {"payment_status": f"Choose one of: {', '.join(PAYMENT_STATUSES)}."}
                )
            queryset = queryset.with_payment_status(payment_status)

        return queryset

    def create(self, request, *args, **kwargs):
        tenancy = self.get_tenancy()
        if not role_can(self.get_property().role, Capability.RECORD_PAYMENTS):
            raise exceptions.PermissionDenied("Your role can't add rent entries.")

        serializer = RentEntryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        initial_payment = data.pop("initial_payment", None)
        key = idempotency_key(request, required=initial_payment is not None)

        try:
            result = create_rent_entry(
                tenancy=tenancy,
                actor=request.user,
                validated_data=data,
                creation_key=key,
                initial_payment=initial_payment,
            )
        except DuplicateBillingMonthError:
            raise DuplicateBillingMonth() from None
        except BillingMonthOutsideTenancyError:
            raise exceptions.ValidationError(
                {"billingMonth": ["This month is outside the tenancy's occupancy period."]}
            ) from None
        except IdempotencyConflictError:
            raise IdempotencyConflict() from None
        except PaymentExceedsOutstandingError as error:
            # The initial payment is more than the bill (whose rate the server sets).
            raise PaymentExceedsOutstanding(error.outstanding) from None

        # A retry returns the bill as it is now, with any later payments.
        entry = self.get_queryset().get(pk=result.entry.pk)
        return Response(
            RentEntrySerializer(entry).data,
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )


class PaymentViewSet(
    ScopedLookupMixin, mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet
):
    """A bill's payments: list and record. No update or delete: editing and reversing
    payments need their own rules.

    List: newest paid date first, then newest recorded, then id; every payment of the bill
    (bills have few), unpaginated.

    Create needs an Idempotency-Key header (a UUID). A new key records the payment (201); a
    retry with the same key, bill and details returns that payment (200); the same key with
    anything else is 409 idempotency_conflict. Either way the response has the payment and the
    bill's current balance.
    """

    serializer_class = PaymentSerializer
    pagination_class = None

    def get_queryset(self):
        # Receipts in the same query, never once per payment.
        return (
            Payment.objects.filter(entry=self.get_entry())
            .select_related("receipt")
            .order_by("-paid_date", "-sequence", "id")
        )

    def create(self, request, *args, **kwargs):
        entry = self.get_entry()
        if not role_can(self.get_property().role, Capability.RECORD_PAYMENTS):
            raise exceptions.PermissionDenied("Your role can't record payments.")

        serializer = PaymentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        key = idempotency_key(request, required=True)

        try:
            result = record_payment(
                entry_id=entry.pk,
                actor=request.user,
                idempotency_key=key,
                validated_data=serializer.validated_data,
            )
        except EntryNotFoundError:
            raise exceptions.NotFound() from None
        except PaymentNotAllowedError:
            raise exceptions.PermissionDenied("Your role can't record payments.") from None
        except IdempotencyConflictError:
            raise IdempotencyConflict() from None
        except PaymentExceedsOutstandingError as error:
            raise PaymentExceedsOutstanding(error.outstanding) from None

        # The balance as it is now: on a retry it may include later payments.
        current = RentEntry.objects.with_amounts().get(pk=entry.pk)
        return Response(
            {
                "payment": PaymentSerializer(result.payment).data,
                "entry": RentEntrySerializer(current).data,
            },
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )


class ReceiptViewSet(ScopedLookupMixin, viewsets.GenericViewSet):
    """A payment's receipt: POST issues it (201), or returns the one already issued (200);
    GET returns it, or 404 if none was issued (a GET never issues one). The body is empty:
    everything on the receipt comes from the stored records. No update or delete.

    No Idempotency-Key: the payment identifies the only receipt it can have, so a retry
    returns that receipt.
    """

    serializer_class = ReceiptSerializer
    pagination_class = None

    def retrieve(self, request, *args, **kwargs):
        payment = self.get_payment()
        receipt = get_object_or_404(Receipt.objects.select_related("payment"), payment=payment)
        return Response(ReceiptSerializer(receipt).data)

    def create(self, request, *args, **kwargs):
        payment = self.get_payment()
        if not role_can(self.get_property().role, Capability.ISSUE_RECEIPTS):
            raise exceptions.PermissionDenied("Your role can't issue receipts.")
        if request.data:
            raise exceptions.ValidationError(
                {"nonFieldErrors": ["Send an empty body: receipts are made from saved records."]}
            )

        try:
            result = issue_payment_receipt(payment_id=payment.pk, actor=request.user)
        except PaymentNotFoundError:
            raise exceptions.NotFound() from None
        except ReceiptNotAllowedError:
            raise exceptions.PermissionDenied("Your role can't issue receipts.") from None
        except ReceiptConfigurationIncompleteError as error:
            raise ReceiptConfigurationIncomplete(error.detail) from None

        return Response(
            ReceiptSerializer(result.receipt).data,
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )
