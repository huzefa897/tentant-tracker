from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import SimpleRouter

from accounts.views import me
from billing.dashboard_views import (
    DashboardSummaryView,
    OverdueBillsView,
    PeriodNotOwedView,
    RentalPeriodsView,
)
from billing.views import (
    EntryCorrectionViewSet,
    EntryVoidViewSet,
    PaymentReversalViewSet,
    PaymentViewSet,
    ReceiptViewSet,
    RentEntryViewSet,
)
from properties.views import PropertyViewSet, TenancyViewSet

from .views import health_check, readiness_check

router = SimpleRouter()
router.register("properties", PropertyViewSet, basename="property")

# Tenancies are always reached through their property, so access is checked first.
tenancy_list = TenancyViewSet.as_view({"get": "list"})
tenancy_detail = TenancyViewSet.as_view({"get": "retrieve"})
# Bills are reached through their property and tenancy, both checked first.
rent_entry_list = RentEntryViewSet.as_view({"get": "list", "post": "create"})
rent_entry_detail = RentEntryViewSet.as_view({"get": "retrieve"})
entry_void = EntryVoidViewSet.as_view({"post": "create"})
entry_correction = EntryCorrectionViewSet.as_view({"post": "create"})
payment_list = PaymentViewSet.as_view({"get": "list", "post": "create"})
payment_receipt = ReceiptViewSet.as_view({"get": "retrieve", "post": "create"})
payment_reversal = PaymentReversalViewSet.as_view({"post": "create"})

urlpatterns = [
    path(settings.ADMIN_PATH, admin.site.urls),
    path("api/v1/health/", health_check, name="health"),
    path("api/v1/ready/", readiness_check, name="ready"),
    path("api/v1/me/", me, name="me"),
    path("api/v1/overdue-bills/", OverdueBillsView.as_view(), name="overdue-bills"),
    path(
        "api/v1/properties/<uuid:property_id>/dashboard/summary/",
        DashboardSummaryView.as_view(),
        name="dashboard-summary",
    ),
    path(
        "api/v1/properties/<uuid:property_id>/dashboard/rental-periods/",
        RentalPeriodsView.as_view(),
        name="dashboard-rental-periods",
    ),
    path(
        "api/v1/properties/<uuid:property_id>/rental-periods/<uuid:period_id>/not-owed/",
        PeriodNotOwedView.as_view(),
        name="rental-period-not-owed",
    ),
    path(
        "api/v1/properties/<uuid:property_id>/tenancies/",
        tenancy_list,
        name="tenancy-list",
    ),
    path(
        "api/v1/properties/<uuid:property_id>/tenancies/<uuid:pk>/",
        tenancy_detail,
        name="tenancy-detail",
    ),
    path(
        "api/v1/properties/<uuid:property_id>/tenancies/<uuid:tenancy_id>/entries/",
        rent_entry_list,
        name="rent-entry-list",
    ),
    path(
        "api/v1/properties/<uuid:property_id>/tenancies/<uuid:tenancy_id>/entries/<uuid:pk>/",
        rent_entry_detail,
        name="rent-entry-detail",
    ),
    path(
        "api/v1/properties/<uuid:property_id>/tenancies/<uuid:tenancy_id>/entries/<uuid:entry_id>/void/",
        entry_void,
        name="rent-entry-void",
    ),
    path(
        "api/v1/properties/<uuid:property_id>/tenancies/<uuid:tenancy_id>/entries/<uuid:entry_id>/correction/",
        entry_correction,
        name="rent-entry-correction",
    ),
    path(
        "api/v1/properties/<uuid:property_id>/tenancies/<uuid:tenancy_id>/entries/<uuid:entry_id>/payments/",
        payment_list,
        name="payment-list",
    ),
    path(
        "api/v1/properties/<uuid:property_id>/tenancies/<uuid:tenancy_id>/entries/<uuid:entry_id>/payments/<uuid:payment_id>/receipt/",
        payment_receipt,
        name="payment-receipt",
    ),
    path(
        "api/v1/properties/<uuid:property_id>/tenancies/<uuid:tenancy_id>/entries/<uuid:entry_id>/payments/<uuid:payment_id>/reversal/",
        payment_reversal,
        name="payment-reversal",
    ),
    path("api/v1/", include(router.urls)),
]
