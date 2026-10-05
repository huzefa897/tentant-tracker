"""The only module that talks to Firebase. Callers get verified claims or one of
the errors below, never firebase_admin types."""

import logging

import firebase_admin
from django.conf import settings
from firebase_admin import auth, exceptions
from google.auth.exceptions import GoogleAuthError

logger = logging.getLogger(__name__)


class InvalidFirebaseTokenError(Exception):
    """The token is invalid, expired or revoked, or its Firebase user is disabled or deleted."""


class FirebaseUnavailableError(Exception):
    """Firebase could not verify the token: network, Google outage or misconfiguration."""


def initialize_firebase():
    try:
        return firebase_admin.get_app()
    except ValueError:
        # Credentials come from GOOGLE_APPLICATION_CREDENTIALS (loaded from .env).
        return firebase_admin.initialize_app(
            options={
                "projectId": settings.FIREBASE_PROJECT_ID,
            },
        )


def verify_firebase_token(token: str) -> dict:
    """Return the verified claims of a Firebase ID token.

    check_revoked also rejects revoked sessions and disabled users, at the cost
    of a request to Firebase per call.
    """
    try:
        initialize_firebase()
        return auth.verify_id_token(token, check_revoked=True)
    except (
        auth.InvalidIdTokenError,  # Includes expired and revoked tokens.
        auth.UserDisabledError,
        auth.UserNotFoundError,
    ) as error:
        raise InvalidFirebaseTokenError(str(error)) from error
    except (exceptions.FirebaseError, GoogleAuthError, ValueError) as error:
        # ValueError: missing project ID (the token itself is checked before this call).
        logger.exception("Firebase token verification unavailable")
        raise FirebaseUnavailableError(str(error)) from error
