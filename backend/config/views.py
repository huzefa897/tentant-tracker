from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(["GET"])
@authentication_classes([])  # Never depends on Firebase, even if a token is sent.
@permission_classes([AllowAny])
def health_check(request):
    """The app responds. Says nothing about the database."""
    return Response({"status": "ok"})
