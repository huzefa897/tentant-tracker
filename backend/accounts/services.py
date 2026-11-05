import logging

from django.db import IntegrityError, transaction

from .firebase import revoke_firebase_sessions
from .models import User, normalize_email

logger = logging.getLogger(__name__)

GOOGLE_PROVIDER = "google.com"


class NotRegisteredError(Exception):
    """A verified Firebase identity that no person in the app is linked to or invited as."""


def get_registered_user(claims: dict) -> User:
    """The person behind verified Firebase claims. Never creates one: sign-in is
    invite-only (an admin adds the person with their Google email).

    A person already linked is found by UID only. Otherwise the claims link an invited
    person: one with this email who isn't linked yet, when Google has verified the
    email (see _link_invited_person).

    Like the admin's "can sign in", the person needs an email as well as the link: one
    whose email was removed gets NotRegisteredError.
    """
    uid = claims["uid"]
    user = User.objects.filter(firebase_uid=uid).first() or _link_invited_person(claims)
    if user is None or not user.email:
        raise NotRegisteredError(uid)
    return user


def _link_invited_person(claims: dict) -> User | None:
    """Link the claims' identity to the invited person with their email, or None.

    Only a Google sign-in counts, and only with an email Google has verified, so
    nobody can claim an invite with an address they don't control. People already
    linked to another identity are never relinked.
    """
    provider = (claims.get("firebase") or {}).get("sign_in_provider")
    email = normalize_email(claims.get("email") or "")
    if provider != GOOGLE_PROVIDER or claims.get("email_verified") is not True or not email:
        return None

    uid = claims["uid"]
    try:
        with transaction.atomic():
            user = (
                User.objects.select_for_update()
                .filter(email__iexact=email, firebase_uid__isnull=True)
                .first()
            )
            if user is None:
                # Perhaps a concurrent request for the same sign-in linked them first.
                return User.objects.filter(firebase_uid=uid).first()
            user.firebase_uid = uid
            user.save(update_fields=["firebase_uid"])
    except IntegrityError:
        # The other request's link won the unique constraint.
        return User.objects.filter(firebase_uid=uid).first()

    logger.info("Linked a Google sign-in to user %s", user.pk)
    return user


def unlink_if_email_changed(user: User, previous_email: str) -> None:
    """When a linked person's email changes or is removed, unlink their Google identity
    and end its sessions, so whoever is signed in has to sign in again with the
    current email (or can't, if it was removed). Call it as the last step of a save,
    after all validation (the admin does this inside its transaction, so a Firebase
    failure rolls the database back); the caller saves user.firebase_uid.

    Raises FirebaseUnavailableError if Firebase can't be reached.
    """
    if not user.firebase_uid or normalize_email(user.email) == normalize_email(previous_email):
        return

    revoke_firebase_sessions(user.firebase_uid)
    user.firebase_uid = None
