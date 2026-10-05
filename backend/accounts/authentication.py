from rest_framework import exceptions, status
from rest_framework.authentication import BaseAuthentication, get_authorization_header

from .firebase import FirebaseUnavailableError, InvalidFirebaseTokenError, verify_firebase_token
from .services import NotRegisteredError, get_registered_user


class AuthenticationUnavailable(exceptions.APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "Sign-in could not be verified right now. Try again shortly."
    default_code = "authentication_unavailable"


class NotRegistered(exceptions.APIException):
    """A real Firebase sign-in for a number nobody has added. The code lets the app
    tell this apart from other refusals."""

    status_code = status.HTTP_403_FORBIDDEN
    default_detail = {
        "detail": "This phone number isn't registered. Contact the property owner.",
        "code": "not_registered",
    }
    default_code = "not_registered"


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
