from rest_framework import viewsets

from .queries import properties_for_user
from .serializers import PropertySerializer


class PropertyViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PropertySerializer

    def get_queryset(self):
        # Scoping the queryset (not an object permission) keeps lists filtered and
        # makes other properties 404 rather than 403.
        return properties_for_user(self.request.user)
