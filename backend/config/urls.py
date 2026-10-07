from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import SimpleRouter

from accounts.views import me
from billing.views import PaymentViewSet, RentEntryViewSet
from properties.views import PropertyViewSet, TenancyViewSet

from .views import health_check

router = SimpleRouter()
router.register("properties", PropertyViewSet, basename="property")

# Tenancies are always reached through their property, so access is checked first.
tenancy_list = TenancyViewSet.as_view({"get": "list"})
tenancy_detail = TenancyViewSet.as_view({"get": "retrieve"})
# Bills are reached through their property and tenancy, both checked first.
rent_entry_list = RentEntryViewSet.as_view({"get": "list", "post": "create"})
rent_entry_detail = RentEntryViewSet.as_view({"get": "retrieve"})
payment_list = PaymentViewSet.as_view({"get": "list", "post": "create"})

urlpatterns = [
    path(settings.ADMIN_PATH, admin.site.urls),
    path("api/v1/health/", health_check, name="health"),
    path("api/v1/me/", me, name="me"),
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
        "api/v1/properties/<uuid:property_id>/tenancies/<uuid:tenancy_id>/entries/<uuid:entry_id>/payments/",
        payment_list,
        name="payment-list",
    ),
    path("api/v1/", include(router.urls)),
]
