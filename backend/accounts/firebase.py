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


class FirebasePhoneNumberTakenError(Exception):
    """Another Firebase identity already has this phone number."""


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


def find_firebase_uid(phone_number: str) -> str | None:
    """The UID of the Firebase identity with this E.164 number, or None. Read-only."""
    try:
        initialize_firebase()
        return auth.get_user_by_phone_number(phone_number).uid
    except auth.UserNotFoundError:
        return None
    except (exceptions.FirebaseError, GoogleAuthError, ValueError) as error:
        logger.exception("Firebase identity lookup unavailable")
        raise FirebaseUnavailableError(str(error)) from error


def get_or_create_firebase_uid(phone_number: str) -> str:
    """The UID of the Firebase identity for this E.164 number, creating it if needed.

    Idempotent: a number that has signed in before (or was registered earlier)
    keeps its existing identity.
    """
    try:
        initialize_firebase()
        try:
            return auth.get_user_by_phone_number(phone_number).uid
        except auth.UserNotFoundError:
            try:
                return auth.create_user(phone_number=phone_number).uid
            except auth.PhoneNumberAlreadyExistsError:
                # Created concurrently between the lookup and the create.
                return auth.get_user_by_phone_number(phone_number).uid
    except (exceptions.FirebaseError, GoogleAuthError, ValueError) as error:
        logger.exception("Firebase identity lookup unavailable")
        raise FirebaseUnavailableError(str(error)) from error


def set_firebase_phone_number(uid: str, phone_number: str | None) -> None:
    """Point an existing Firebase identity at a new number, or remove its number (None),
    which stops it signing in by phone."""
    try:
        initialize_firebase()
        auth.update_user(uid, phone_number=phone_number or auth.DELETE_ATTRIBUTE)
    except auth.PhoneNumberAlreadyExistsError as error:
        raise FirebasePhoneNumberTakenError(str(error)) from error
    except (exceptions.FirebaseError, GoogleAuthError, ValueError) as error:
        logger.exception("Firebase phone number update unavailable")
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
