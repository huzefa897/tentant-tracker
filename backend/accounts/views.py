from rest_framework.decorators import api_view
from rest_framework.response import Response

from .serializers import MeSerializer


@api_view(["GET"])
def me(request):
    """The signed-in user and the properties they can access (empty: access not configured)."""
    return Response(MeSerializer(request.user).data)
