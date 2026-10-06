from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import SimpleRouter

from accounts.views import me
from properties.views import PropertyViewSet, TenancyViewSet

from .views import health_check

router = SimpleRouter()
router.register("properties", PropertyViewSet, basename="property")

# Tenancies are always reached through their property, so access is checked first.
tenancy_list = TenancyViewSet.as_view({"get": "list"})
tenancy_detail = TenancyViewSet.as_view({"get": "retrieve"})

urlpatterns = [
    path("admin/", admin.site.urls),
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
    path("api/v1/", include(router.urls)),
]
