import ipaddress

from django.conf import settings
from rest_framework import exceptions, status
from rest_framework.authentication import BaseAuthentication, get_authorization_header

from .firebase import FirebaseUnavailableError, InvalidFirebaseTokenError, verify_firebase_token
from .models import User, normalize_email
from .services import NotRegisteredError, get_registered_user


class AuthenticationUnavailable(exceptions.APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "Sign-in could not be verified right now. Try again shortly."
    default_code = "authentication_unavailable"


class NotRegistered(exceptions.APIException):
    """A real Firebase sign-in for a Google account nobody has added. The code lets
    the app tell this apart from other refusals."""

    status_code = status.HTTP_403_FORBIDDEN
    default_detail = {
        "detail": "This Google account isn't registered. Contact the property owner.",
        "code": "not_registered",
    }
    default_code = "not_registered"


def is_loopback_peer(request) -> bool:
    """Whether the TCP connection came from this machine. REMOTE_ADDR is the socket's peer
    address, set by the server, never by a header the caller sends (nothing in this app rewrites
    it from X-Forwarded-For), so a remote client can't fake it the way it can fake Host."""
    try:
        return ipaddress.ip_address(request.META.get("REMOTE_ADDR", "")).is_loopback
    except ValueError:
        return False


class DevAuthentication(BaseAuthentication):
    """Local development only: `Authorization: Dev <email>` signs in as the existing, active
    person with that email, with no Google or Firebase. It never creates anyone and grants no
    access by itself: property access still comes from memberships.

    The boundary is the connection, not configuration alone: only a request whose TCP peer is
    loopback (127.0.0.0/8 or ::1) is accepted, so even an instance wrongly started with
    DJANGO_ENV=dev and reachable from outside refuses every remote caller, whatever Host header
    they send, and so does a request through a reverse proxy in another container. The
    authenticator is also only installed with DJANGO_ENV=dev (config/settings.py, which refuses
    to start unless DEBUG is on and the hosts are local) and checks the setting on each request.
    """

    keyword = b"dev"

    def authenticate(self, request):
        header = get_authorization_header(request).split()

        if not header or header[0].lower() != self.keyword:
            return None

        if not (settings.DEV_LOGIN and settings.DEBUG):
            raise exceptions.AuthenticationFailed("Dev login is off.")

        if not is_loopback_peer(request):
            raise exceptions.AuthenticationFailed(
                "Dev login only accepts connections from this machine."
            )

        if len(header) != 2:
            raise exceptions.AuthenticationFailed("Invalid Authorization header. Expected 'Dev <email>'.")

        email = normalize_email(header[1].decode(errors="replace"))
        user = User.objects.filter(email__iexact=email).exclude(email="").first() if email else None
        if user is None:
            raise NotRegistered()
        if not user.is_active:
            raise exceptions.AuthenticationFailed("User inactive or deleted.")

        return user, {"uid": user.firebase_uid or "", "email": user.email, "dev": True}

    def authenticate_header(self, request):
        return "Dev"


class FirebaseAuthentication(BaseAuthentication):
    """Authenticates `Authorization: Bearer <Firebase ID token>`.

    Identity comes only from the verified token, never from the request body.
    """

    keyword = b"bearer"

    def authenticate(self, request):
        header = get_authorization_header(request).split()

        if not header:
            return None

        if header[0].lower() != self.keyword:
            # Another scheme: let a later authentication class (if any) handle it.
            return None

        if len(header) != 2:
            raise exceptions.AuthenticationFailed(
                "Invalid Authorization header. Expected 'Bearer <token>'."
            )

        try:
            token = header[1].decode()
        except UnicodeError:
            raise exceptions.AuthenticationFailed("Invalid token.") from None

        try:
            claims = verify_firebase_token(token)
        except InvalidFirebaseTokenError:
            raise exceptions.AuthenticationFailed("Invalid or expired token.") from None
        except FirebaseUnavailableError:
            raise AuthenticationUnavailable() from None

        try:
            user = get_registered_user(claims)
        except NotRegisteredError:
            raise NotRegistered() from None

        if not user.is_active:
            raise exceptions.AuthenticationFailed("User inactive or deleted.")

        return user, claims

    def authenticate_header(self, request):
        # Makes DRF answer unauthenticated requests with 401 + WWW-Authenticate.
        return "Bearer"
