import re

from rest_framework import exceptions, mixins, status, viewsets
from rest_framework.generics import get_object_or_404
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from properties.models import Tenancy
from properties.queries import properties_for_user
from properties.roles import Capability, role_can

from .models import RentEntry
from .serializers import BillingMonthField, RentEntryCreateSerializer, RentEntrySerializer
from .services import (
    BillingMonthOutsideTenancyError,
    DuplicateBillingMonthError,
    create_rent_entry,
)

YEAR_PATTERN = re.compile(r"^\d{4}$")


class DuplicateBillingMonth(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = {
        "code": "duplicate_billing_month",
        "detail": "An entry already exists for this tenancy and billing month.",
    }
    default_code = "duplicate_billing_month"


class RentEntryPagination(PageNumberPagination):
    """{count, next, previous, results}, a year of bills per page (?page=)."""

    page_size = 12


class RentEntryViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """A tenancy's bills: list, retrieve and create. No update or delete: financial
    corrections need deliberate rules first.

    List: newest billing month first; ?year=2026 and ?billing_month=2026-10 (to check whether
    a bill exists, e.g. after a save timed out).
    """

    serializer_class = RentEntrySerializer
    pagination_class = RentEntryPagination

    def get_property(self):
        # Through the user's active memberships first, so another property 404s before its
        # tenancies or bills are looked at.
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

    def get_queryset(self):
        # Every lookup is limited to the authorised tenancy, so another tenancy's bill 404s.
        return RentEntry.objects.filter(tenancy=self.get_tenancy()).order_by(
            "-billing_month", "-created_at"
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

        return queryset

    def create(self, request, *args, **kwargs):
        tenancy = self.get_tenancy()
        if not role_can(self.get_property().role, Capability.RECORD_PAYMENTS):
            raise exceptions.PermissionDenied("Your role can't add rent entries.")

        serializer = RentEntryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            entry = create_rent_entry(
                tenancy=tenancy, actor=request.user, validated_data=serializer.validated_data
            )
        except DuplicateBillingMonthError:
            raise DuplicateBillingMonth() from None
        except BillingMonthOutsideTenancyError:
            raise exceptions.ValidationError(
                {"billingMonth": ["This month is outside the tenancy's occupancy period."]}
            ) from None

        return Response(RentEntrySerializer(entry).data, status=status.HTTP_201_CREATED)
