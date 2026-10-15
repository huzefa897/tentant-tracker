"""The property dashboard's API (billing/dashboard.py has the queries). Read-only, for anyone
with access to the property; another property 404s. Money is a decimal string."""

from django.utils import timezone
from rest_framework import exceptions, serializers, views
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from properties.models import Tenancy, business_date

from . import dashboard
from .serializers import BillingMonthField, format_month, money
from .views import ScopedLookupMixin

SEARCH_MAX_LENGTH = 100


class DashboardView(ScopedLookupMixin, views.APIView):
    def today(self):
        # Once per request, so every figure in a response is for the same day.
        if not hasattr(self, "_today"):
            self._today = business_date()
        return self._today


class DashboardSummaryView(DashboardView):
    """GET .../dashboard/summary/: property-wide totals from recorded bills, as of today in
    India. overdue, dueToday, dueNext7Days and withoutDueDate are parts of outstanding."""

    def get(self, request, property_id):
        prop = self.get_property()
        totals = dashboard.summary(prop, self.today())
        return Response(
            {
                "asOfDate": self.today().isoformat(),
                "generatedAt": serializers.DateTimeField().to_representation(timezone.now()),
                "currency": "INR",
                "outstandingAmount": money(totals["outstanding"]),
                "overdueAmount": money(totals["overdue"]),
                "dueTodayAmount": money(totals["due_today"]),
                "dueNext7DaysAmount": money(totals["due_next_7_days"]),
                "withoutDueDateAmount": money(totals["without_due_date"]),
                "pendingTenancyCount": totals["pending_tenancies"],
                "overdueTenancyCount": totals["overdue_tenancies"],
            }
        )


class PendingTenanciesPagination(PageNumberPagination):
    """{count, next, previous, results} (?page=)."""

    page_size = 20


class PendingTenanciesView(DashboardView):
    """GET .../dashboard/pending-tenancies/: one row per tenancy that owes money, ended ones
    too, overdue first. ?due_status=all (the default)|overdue|due_today|due_next_7_days keeps
    the tenancies with money in that window; ?search= matches name or flat number. Filters
    change the list, never the summary."""

    def get(self, request, property_id):
        prop = self.get_property()
        params = request.query_params
        due = params.get("due_status", "all")
        if due not in dashboard.DUE_FILTERS:
            raise exceptions.ValidationError(
                {"due_status": f"Choose one of: {', '.join(dashboard.DUE_FILTERS)}."}
            )
        search = params.get("search", "")
        if len(search) > SEARCH_MAX_LENGTH:
            raise exceptions.ValidationError(
                {"search": f"Search with {SEARCH_MAX_LENGTH} characters or fewer."}
            )

        today = self.today()
        rows = dashboard.pending_tenancies(prop, today, due=due, search=search)
        paginator = PendingTenanciesPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        return paginator.get_paginated_response([self.row(row, today) for row in page])

    @staticmethod
    def row(row, today):
        dates = Tenancy(start_date=row["tenancy__start_date"], end_date=row["tenancy__end_date"])
        oldest_due, oldest_overdue = row["oldest_due_date"], row["oldest_overdue_date"]
        return {
            "tenancyId": str(row["tenancy_id"]),
            "name": row["tenancy__name"],
            "flatNumber": row["tenancy__flat_number"],
            "tenancyStatus": dates.status_on(today),
            "outstandingAmount": money(row["outstanding"]),
            "overdueAmount": money(row["overdue"]),
            "dueTodayAmount": money(row["due_today"]),
            "dueNext7DaysAmount": money(row["due_next_7_days"]),
            "withoutDueDateAmount": money(row["without_due_date"]),
            "pendingBillCount": row["bill_count"],
            "oldestDueDate": None if oldest_due is None else oldest_due.isoformat(),
            "oldestOverdueDate": None if oldest_overdue is None else oldest_overdue.isoformat(),
        }


class MissingBillsView(DashboardView):
    """GET .../dashboard/missing-bills/: tenancies occupying the month with no active bill for
    it. ?billing_month=YYYY-MM, by default last month (postpaid) or this month (prepaid).
    Nothing is estimated: these never add to the totals."""

    def get(self, request, property_id):
        prop = self.get_property()
        value = request.query_params.get("billing_month")
        if value is None:
            month = dashboard.default_missing_month(prop, self.today())
        else:
            try:
                month = BillingMonthField().to_internal_value(value)
            except exceptions.ValidationError as error:
                raise exceptions.ValidationError({"billing_month": error.detail}) from None

        tenancies = list(dashboard.missing_bills(prop, month))
        return Response(
            {
                "billingMonth": format_month(month),
                "count": len(tenancies),
                "tenancies": [
                    {
                        "tenancyId": str(tenancy.id),
                        "name": tenancy.name,
                        "flatNumber": tenancy.flat_number,
                        "tenancyStatus": tenancy.status_on(self.today()),
                        "rentAmount": money(tenancy.rent_amount),
                    }
                    for tenancy in tenancies
                ],
            }
        )
