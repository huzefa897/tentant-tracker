"""The property dashboard's API (billing/dashboard.py has the queries). Reads are for anyone
with access to the property; another property 404s. Money is a decimal string, and an amount
that isn't known yet (a month without a bill) is null, never "0.00".

Each read first creates the property's rental periods that are due by now and don't exist yet
(periods.ensure_property_periods), so the dashboard is right after any downtime without a
scheduled job."""

from django.utils import timezone
from rest_framework import exceptions, serializers, status, views
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from properties.models import Tenancy, business_date
from properties.roles import Capability, role_can

from . import dashboard
from .models import RentalPeriod
from .periods import ensure_property_periods
from .serializers import BillingMonthField, format_month, money, person_name
from .services import (
    BillCorrectionNotAllowedError,
    NotOwedConflictError,
    PeriodHasBillError,
    PeriodNotFoundError,
    mark_period_not_owed,
)
from .views import CORRECTIONS_FORBIDDEN, ScopedLookupMixin


class DashboardView(ScopedLookupMixin, views.APIView):
    def today(self):
        # Once per request, so every figure in a response is for the same day.
        if not hasattr(self, "_today"):
            self._today = business_date()
        return self._today

    def ensured_property(self):
        prop = self.get_property()
        ensure_property_periods(prop, self.today())
        return prop


class DashboardSummaryView(DashboardView):
    """GET .../dashboard/summary/: counts of rental periods (and, where named, tenancies) and
    the amounts known from prepared bills, as of today in India. The known amounts never
    include a month awaiting its bill (awaitingBillPeriodCount says how many)."""

    def get(self, request, property_id):
        prop = self.ensured_property()
        totals = dashboard.summary(prop, self.today())
        return Response(
            {
                "asOfDate": self.today().isoformat(),
                "generatedAt": serializers.DateTimeField().to_representation(timezone.now()),
                "currency": "INR",
                "overduePeriodCount": totals["overdue_periods"],
                "overdueTenancyCount": totals["overdue_tenancies"],
                "dueTodayPeriodCount": totals["due_today_periods"],
                "upcomingPeriodCount": totals["upcoming_periods"],
                "awaitingBillPeriodCount": totals["awaiting_bill_periods"],
                "overdueAwaitingBillPeriodCount": totals["overdue_awaiting_bill_periods"],
                "owingTenancyCount": totals["owing_tenancies"],
                "knownOutstandingAmount": money(totals["known_outstanding"]),
                "knownOverdueAmount": money(totals["known_overdue"]),
                "knownDueTodayAmount": money(totals["known_due_today"]),
                "knownUpcomingAmount": money(totals["known_upcoming"]),
            }
        )


class RentalPeriodsPagination(PageNumberPagination):
    """{count, next, previous, results} (?page=)."""

    page_size = 20


def settlement(row) -> str:
    """unknown (no bill), unpaid, partially_paid or paid, from the bill's effective payments."""
    if not row["has_bill"]:
        return "unknown"
    if row["outstanding"] <= 0:
        return "paid"
    if row["bill_paid"] <= 0:
        return "unpaid"
    return "partially_paid"


class RentalPeriodsView(DashboardView):
    """GET .../dashboard/rental-periods/: one row per month still owed, its bill prepared or
    not, oldest due first. ?timing=due (the default: overdue or due today)|overdue|due_today|
    upcoming (the next 7 days)|all, ?preparation=all|prepared|not_prepared and
    ?month=YYYY-MM. Filters change the list, never the summary. Each row's actions are the
    ones the viewer's role allows."""

    def get(self, request, property_id):
        prop = self.ensured_property()
        params = request.query_params
        timing = params.get("timing", "due")
        if timing not in dashboard.TIMING_FILTERS:
            raise exceptions.ValidationError(
                {"timing": f"Choose one of: {', '.join(dashboard.TIMING_FILTERS)}."}
            )
        preparation = params.get("preparation", "all")
        if preparation not in dashboard.PREPARATION_FILTERS:
            raise exceptions.ValidationError(
                {"preparation": f"Choose one of: {', '.join(dashboard.PREPARATION_FILTERS)}."}
            )
        month = None
        if "month" in params:
            try:
                month = BillingMonthField().to_internal_value(params["month"])
            except exceptions.ValidationError as error:
                raise exceptions.ValidationError({"month": error.detail}) from None

        today = self.today()
        rows = dashboard.periods(prop, today, timing=timing, preparation=preparation, month=month)
        paginator = RentalPeriodsPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        can_bill = role_can(prop.role, Capability.RECORD_PAYMENTS)
        return paginator.get_paginated_response(
            [self.row(row, today, can_bill) for row in page]
        )

    @staticmethod
    def row(row, today, can_bill: bool):
        dates = Tenancy(start_date=row["tenancy__start_date"], end_date=row["tenancy__end_date"])
        timing = dashboard.timing_of(row["due_date"], today)
        prepared = row["has_bill"]
        if prepared:
            actions = ["view_bill"] + (["record_payment"] if can_bill else [])
        else:
            actions = ["prepare_bill"] if can_bill else []
        return {
            "id": str(row["id"]),
            "tenancyId": str(row["tenancy_id"]),
            "name": row["tenancy__name"],
            "flatNumber": row["tenancy__flat_number"],
            "tenancyStatus": dates.status_on(today),
            "periodMonth": format_month(row["period_month"]),
            "paymentTiming": row["payment_timing"],
            "dueDate": row["due_date"].isoformat(),
            "timing": timing,
            "daysOverdue": (today - row["due_date"]).days if timing == "overdue" else 0,
            "preparation": "prepared" if prepared else "not_prepared",
            "billId": str(row["bill_id"]) if prepared else None,
            "settlement": settlement(row),
            "totalDue": money(row["bill_total"]) if prepared else None,
            "outstandingAmount": money(row["outstanding"]) if prepared else None,
            "actions": actions,
        }


class NotOwedSerializer(serializers.Serializer):
    reason = serializers.CharField(
        max_length=500,
        trim_whitespace=True,
        error_messages={
            "required": "Say why this month isn't owed.",
            "blank": "Say why this month isn't owed.",
            "max_length": "The reason must be 500 characters or fewer.",
        },
    )


class PeriodHasBill(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = {
        "code": "period_has_bill",
        "detail": "This month has a bill. Void the bill first.",
    }
    default_code = "period_has_bill"


class NotOwedConflict(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = {
        "code": "not_owed_conflict",
        "detail": "This month was already marked not owed with a different reason.",
    }
    default_code = "not_owed_conflict"


class PeriodNotOwedView(DashboardView):
    """POST .../rental-periods/{id}/not-owed/ {"reason"}: marks the month's rent as not owed
    (owners only; a manager is 403). 201 with the period; a retry with the same reason returns
    it (200), another reason is 409 not_owed_conflict. A month with an active bill is 409
    period_has_bill: void the bill first."""

    def post(self, request, property_id, period_id):
        prop = self.get_property()
        if not RentalPeriod.objects.filter(pk=period_id, tenancy__property=prop).exists():
            raise exceptions.NotFound()
        if not role_can(prop.role, Capability.CORRECT_BILLS):
            raise exceptions.PermissionDenied(CORRECTIONS_FORBIDDEN)

        serializer = NotOwedSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = mark_period_not_owed(
                period_id=period_id,
                actor=request.user,
                reason=serializer.validated_data["reason"],
            )
        except PeriodNotFoundError:
            raise exceptions.NotFound() from None
        except BillCorrectionNotAllowedError:
            raise exceptions.PermissionDenied(CORRECTIONS_FORBIDDEN) from None
        except PeriodHasBillError:
            raise PeriodHasBill() from None
        except NotOwedConflictError:
            raise NotOwedConflict() from None

        period = result.period
        return Response(
            {
                "id": str(period.pk),
                "tenancyId": str(period.tenancy_id),
                "periodMonth": format_month(period.period_month),
                "dueDate": period.due_date.isoformat(),
                "notOwedAt": serializers.DateTimeField().to_representation(period.not_owed_at),
                "notOwedByName": person_name(period.not_owed_by),
                "notOwedReason": period.not_owed_reason,
            },
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )
