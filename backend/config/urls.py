from django.contrib import admin
from django.urls import path

from .views import health_check

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/health/", health_check, name="health"),
]
