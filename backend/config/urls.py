from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import SimpleRouter

from accounts.views import me
from properties.views import PropertyViewSet

from .views import health_check

router = SimpleRouter()
router.register("properties", PropertyViewSet, basename="property")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/health/", health_check, name="health"),
    path("api/v1/me/", me, name="me"),
    path("api/v1/", include(router.urls)),
]
