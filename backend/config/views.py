import logging

from django.db import DatabaseError, connection
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

logger = logging.getLogger(__name__)


@api_view(["GET"])
@authentication_classes([])  # Never depends on Firebase, even if a token is sent.
@permission_classes([AllowAny])
def health_check(request):
    """The app responds. Says nothing about the database."""
    return Response({"status": "ok"})


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def readiness_check(request):
    """The app can serve requests: it reaches the database. 503 otherwise, saying no more, so
    nothing about the connection (host, user, error) is ever exposed."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except DatabaseError as error:
        # The type only: driver messages can name the host and user.
        logger.warning("Readiness check failed: database unavailable (%s)", type(error).__name__)
        return Response({"status": "unavailable"}, status=503)
    return Response({"status": "ok"})
