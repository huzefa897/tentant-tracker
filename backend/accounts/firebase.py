"""The only module that talks to Firebase. Callers get verified claims or one of
the errors below, never firebase_admin types."""

import logging

import firebase_admin
from django.conf import settings
from firebase_admin import auth, credentials, exceptions
from google.auth.exceptions import GoogleAuthError

logger = logging.getLogger(__name__)


class InvalidFirebaseTokenError(Exception):
    """The token is invalid, expired or revoked, or its Firebase user is disabled or deleted."""


class FirebaseUnavailableError(Exception):
    """Firebase could not be reached or used: network, Google outage or misconfiguration."""


def initialize_firebase():
    try:
        return firebase_admin.get_app()
    except ValueError:
        # The key's fields from the environment, else the key file named by
        # GOOGLE_APPLICATION_CREDENTIALS (both loaded from .env; settings.py).
        key = settings.FIREBASE_SERVICE_ACCOUNT_KEY
        return firebase_admin.initialize_app(
            credentials.Certificate(key) if key else None,
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


def revoke_firebase_sessions(uid: str) -> None:
    """End every existing session of a Firebase identity: its refresh tokens stop working,
    and verify_firebase_token (check_revoked) rejects ID tokens issued before now."""
    try:
        initialize_firebase()
        auth.revoke_refresh_tokens(uid)
    except (exceptions.FirebaseError, GoogleAuthError, ValueError) as error:
        logger.exception("Firebase session revocation unavailable")
        raise FirebaseUnavailableError(str(error)) from error
