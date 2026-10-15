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
    EntryCorrectionSerializer,
    EntryVoidSerializer,
    PaymentCreateSerializer,
    PaymentReversalCreateSerializer,
    PaymentSerializer,
    ReceiptSerializer,
    RentEntryCreateSerializer,
    RentEntrySerializer,
)
from .services import (
    BillCorrectionNotAllowedError,
    BillingMonthOutsideTenancyError,
    DuplicateBillingMonthError,
    EntryNotFoundError,
    EntryVoidError,
    NothingToCorrectError,
    IdempotencyConflictError,
    PaymentExceedsOutstandingError,
    PaymentNotAllowedError,
    PaymentNotFoundError,
    PaymentReversedError,
    ReceiptConfigurationIncompleteError,
    ReceiptNotAllowedError,
    ReversalConflictError,
    ReversalNotAllowedError,
    UnreversedPaymentsError,
    VoidConflictError,
    correct_rent_entry,
    create_rent_entry,
    issue_payment_receipt,
    record_payment,
    reverse_payment,
    void_rent_entry,
)

# 0001–9999: Django builds a date from the year, and there is no year 0.
YEAR_PATTERN = re.compile(r"^(?!0000)\d{4}$")
PAYMENT_STATUSES = (PaymentStatus.UNPAID, PaymentStatus.PARTIALLY_PAID, PaymentStatus.PAID)
BILL_STATUSES = ("active", "void", "all")
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


class PaymentReversed(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = {
        "code": "payment_reversed",
        "detail": "This payment has been reversed, so it can't have a receipt.",
    }
    default_code = "payment_reversed"


class ReversalConflict(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = {
        "code": "reversal_conflict",
        "detail": "This payment was already reversed with a different reason.",
    }
    default_code = "reversal_conflict"


class EntryVoid(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = {
        "code": "entry_void",
        "detail": "This bill is void, so it can't take payments or be voided or corrected.",
    }
    default_code = "entry_void"


class VoidConflict(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = {
        "code": "void_conflict",
        "detail": "This bill was already voided with a different reason.",
    }
    default_code = "void_conflict"


class UnreversedPayments(exceptions.APIException):
    """The app lists the payments from the bill's own payments."""

    status_code = status.HTTP_409_CONFLICT
    default_code = "unreversed_payments"

    def __init__(self, count: int):
        payments = "payment" if count == 1 else f"{count} payments"
        super().__init__(
            {
                "code": "unreversed_payments",
                "detail": f"Reverse this bill's {payments} before voiding it.",
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


def payment_with_details(payment_id) -> Payment:
    """A payment as the API shows it, its receipt and reversal in the same query."""
    return Payment.objects.select_related("receipt", "reversal__created_by").get(pk=payment_id)


def entry_with_details(entry_id) -> RentEntry:
    """A bill as the API shows it, after a change: its amounts, voider and replacement."""
    return (
        RentEntry.objects.with_amounts()
        .select_related("voided_by", "replaced_by")
        .get(pk=entry_id)
    )



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
    """A tenancy's bills: list, retrieve and create. No update or delete: a bill is corrected
    by voiding it (EntryVoidViewSet) or voiding and replacing it (EntryCorrectionViewSet).

    List: newest billing month first; ?status=active (the default)|void|all, ?year=2026,
    ?billing_month=2026-10 (to check whether a bill exists),
    ?payment_status=unpaid|partially_paid|paid (active bills only) and ?balance=outstanding
    (active bills with money still to pay), applied before paging.

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
            .select_related("voided_by", "replaced_by")
            .order_by("-billing_month", "-created_at")
        )

    def filter_queryset(self, queryset):
        if self.action != "list":
            return queryset

        params = self.request.query_params
        # Active by default: anything that lists bills without asking for void ones never sees
        # them, so it can't count them.
        bill_status = params.get("status", "active")
        if bill_status not in BILL_STATUSES:
            raise exceptions.ValidationError(
                {"status": f"Choose one of: {', '.join(BILL_STATUSES)}."}
            )
        if bill_status != "all":
            queryset = queryset.filter(status=bill_status)
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

        balance = params.get("balance")
        if balance is not None:
            if balance != "outstanding":
                raise exceptions.ValidationError({"balance": "The only choice is outstanding."})
            queryset = queryset.owing()

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
    """A bill's payments: list and record. No update or delete: a mistake is corrected by
    reversing the payment (PaymentReversalViewSet) and recording its replacement.

    List: newest paid date first, then newest recorded, then id; every payment of the bill
    (bills have few), reversed ones included (marked, not counted), unpaginated.

    Create needs an Idempotency-Key header (a UUID). A new key records the payment (201); a
    retry with the same key, bill and details returns that payment (200); the same key with
    anything else is 409 idempotency_conflict. Either way the response has the payment and the
    bill's current balance. A retry of a payment reversed since returns it as it is now,
    reversed: it's never recorded again.
    """

    serializer_class = PaymentSerializer
    pagination_class = None

    def get_queryset(self):
        # Receipts and reversals in the same query, never once per payment.
        return (
            Payment.objects.filter(entry=self.get_entry())
            .select_related("receipt", "reversal__created_by")
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
        except EntryVoidError:
            raise EntryVoid() from None
        except IdempotencyConflictError:
            raise IdempotencyConflict() from None
        except PaymentExceedsOutstandingError as error:
            raise PaymentExceedsOutstanding(error.outstanding) from None

        # The balance as it is now: on a retry it may include later payments or reversals.
        current = entry_with_details(entry.pk)
        return Response(
            {
                "payment": PaymentSerializer(payment_with_details(result.payment.pk)).data,
                "entry": RentEntrySerializer(current).data,
            },
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )


class ReceiptViewSet(ScopedLookupMixin, viewsets.GenericViewSet):
    """A payment's receipt: POST issues it (201), or returns the one already issued (200), void
    or not; a reversed payment without one is 409 payment_reversed. GET returns it, or 404 if
    none was issued (a GET never issues one). The body is empty: everything on the receipt
    comes from the stored records. No update or delete.

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
        except PaymentReversedError:
            raise PaymentReversed() from None

        return Response(
            ReceiptSerializer(result.receipt).data,
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )


class PaymentReversalViewSet(ScopedLookupMixin, viewsets.GenericViewSet):
    """Reverses a payment recorded by mistake: POST {"reason": "..."} (owners only; a manager
    is 403). 201 with {payment, entry}: the payment, now reversed, and the bill's balance
    without it. Its receipt, if any, is voided. A retry with the same reason returns the same
    (200); another reason is 409 reversal_conflict.

    No Idempotency-Key: the payment identifies the only reversal it can have.
    """

    pagination_class = None

    def create(self, request, *args, **kwargs):
        payment = self.get_payment()
        if not role_can(self.get_property().role, Capability.REVERSE_PAYMENTS):
            raise exceptions.PermissionDenied("Only the property's owners can reverse payments.")

        serializer = PaymentReversalCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            result = reverse_payment(
                payment_id=payment.pk,
                actor=request.user,
                reason=serializer.validated_data["reason"],
            )
        except PaymentNotFoundError:
            raise exceptions.NotFound() from None
        except ReversalNotAllowedError:
            raise exceptions.PermissionDenied(
                "Only the property's owners can reverse payments."
            ) from None
        except ReversalConflictError:
            raise ReversalConflict() from None

        return Response(
            {
                "payment": PaymentSerializer(payment_with_details(payment.pk)).data,
                "entry": RentEntrySerializer(entry_with_details(result.entry.pk)).data,
            },
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )


CORRECTIONS_FORBIDDEN = "Only the property's owners can void or correct bills."


class EntryVoidViewSet(ScopedLookupMixin, viewsets.GenericViewSet):
    """Voids a bill that should not exist: POST {"reason": "..."} (owners only; a manager is
    403). 201 with the bill, now void. Refused while any of its payments still count (409
    unreversed_payments): reverse them first. A retry with the same reason returns the same
    (200); another reason is 409 void_conflict.

    No Idempotency-Key: the bill identifies the only void it can have.
    """

    pagination_class = None

    def create(self, request, *args, **kwargs):
        entry = self.get_entry()
        if not role_can(self.get_property().role, Capability.CORRECT_BILLS):
            raise exceptions.PermissionDenied(CORRECTIONS_FORBIDDEN)

        serializer = EntryVoidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            result = void_rent_entry(
                entry_id=entry.pk, actor=request.user, reason=serializer.validated_data["reason"]
            )
        except EntryNotFoundError:
            raise exceptions.NotFound() from None
        except BillCorrectionNotAllowedError:
            raise exceptions.PermissionDenied(CORRECTIONS_FORBIDDEN) from None
        except VoidConflictError:
            raise VoidConflict() from None
        except UnreversedPaymentsError as error:
            raise UnreversedPayments(error.count) from None

        return Response(
            RentEntrySerializer(entry_with_details(result.entry.pk)).data,
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )


class EntryCorrectionViewSet(ScopedLookupMixin, viewsets.GenericViewSet):
    """Corrects a bill's charges: POST {"reason", "rentAmount", "electricityUnits",
    "waterAmount", "notes"} with an Idempotency-Key header (owners only). Voids the bill and
    creates its replacement for the same month, with the bill's electricity rate, in one
    transaction. 201 with {original, replacement}; a retry with the same key and request
    returns them (200); the same key with anything else is 409 idempotency_conflict.

    Refused (nothing changes) when the bill is void (409 entry_void), still has payments that
    count (409 unreversed_payments), or the replacement changes nothing (400).
    """

    pagination_class = None

    def create(self, request, *args, **kwargs):
        entry = self.get_entry()
        if not role_can(self.get_property().role, Capability.CORRECT_BILLS):
            raise exceptions.PermissionDenied(CORRECTIONS_FORBIDDEN)

        serializer = EntryCorrectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        key = idempotency_key(request, required=True)
        data = dict(serializer.validated_data)
        reason = data.pop("reason")

        try:
            result = correct_rent_entry(
                entry_id=entry.pk,
                actor=request.user,
                reason=reason,
                validated_data=data,
                idempotency_key=key,
            )
        except EntryNotFoundError:
            raise exceptions.NotFound() from None
        except BillCorrectionNotAllowedError:
            raise exceptions.PermissionDenied(CORRECTIONS_FORBIDDEN) from None
        except EntryVoidError:
            raise EntryVoid() from None
        except UnreversedPaymentsError as error:
            raise UnreversedPayments(error.count) from None
        except NothingToCorrectError:
            raise exceptions.ValidationError(
                {"nonFieldErrors": ["Change at least one charge or the notes."]}
            ) from None
        except IdempotencyConflictError:
            raise IdempotencyConflict() from None
        except DuplicateBillingMonthError:
            raise DuplicateBillingMonth() from None

        return Response(
            {
                "original": RentEntrySerializer(entry_with_details(result.original.pk)).data,
                "replacement": RentEntrySerializer(
                    entry_with_details(result.replacement.pk)
                ).data,
            },
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )
