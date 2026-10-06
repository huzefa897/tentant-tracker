from django.db.models import Q
from rest_framework import exceptions, viewsets
from rest_framework.generics import get_object_or_404
from rest_framework.pagination import PageNumberPagination

from .models import Tenancy, business_date
from .queries import properties_for_user
from .serializers import PropertySerializer, TenancySerializer

TENANCY_STATUSES = ("current", "upcoming", "ended", "all")


class PropertyViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PropertySerializer

    def get_queryset(self):
        # Scoping the queryset (not an object permission) keeps lists filtered and
        # makes other properties 404 rather than 403.
        return properties_for_user(self.request.user)


class TenancyPagination(PageNumberPagination):
    """{count, next, previous, results}. The app asks for pages by number (?page=)."""

    page_size = 20


class TenancyViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only for now: tenancies are added and edited in Django admin.

    List: ?status=current (default) | upcoming | ended | all, and ?search= (name or flat,
    case-insensitive). Detail returns a tenancy of any status, for historical bills.
    """

    serializer_class = TenancySerializer
    pagination_class = TenancyPagination

    def get_property(self):
        # Through the user's active memberships, so a property they can't access 404s
        # before any tenancy is looked at.
        if not hasattr(self, "_property"):
            self._property = get_object_or_404(
                properties_for_user(self.request.user), pk=self.kwargs["property_id"]
            )
        return self._property

    def get_queryset(self):
        # Every lookup (list and detail) is limited to the authorised property, so a
        # tenancy id under another property's URL 404s.
        return Tenancy.objects.filter(property=self.get_property()).order_by(
            "flat_number", "name", "id"
        )

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "today": self.today}

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        self.today = business_date()

    def filter_queryset(self, queryset):
        if self.action != "list":
            return queryset

        status = self.request.query_params.get("status", "current")
        if status not in TENANCY_STATUSES:
            raise exceptions.ValidationError(
                {"status": f"Use one of: {', '.join(TENANCY_STATUSES)}."}
            )
        queryset = queryset.with_status(status, self.today)

        search = " ".join(self.request.query_params.get("search", "").split())
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(flat_number__icontains=search))
        return queryset
