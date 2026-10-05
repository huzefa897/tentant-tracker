import logging

from .firebase import (
    FirebasePhoneNumberTakenError,
    get_or_create_firebase_uid,
    set_firebase_phone_number,
)
from .models import User

logger = logging.getLogger(__name__)


class NotRegisteredError(Exception):
    """A verified Firebase identity that no person in the app is linked to."""


class PhoneNumberInUseError(Exception):
    """The number's Firebase identity already belongs to another person."""


def get_registered_user(claims: dict) -> User:
    """The person linked to verified Firebase claims. Never creates one: sign-in is
    invite-only (see link_firebase_identity).

    The stored number follows the verified claim, so a number changed in Firebase
    replaces the stored one; a clash with another person's number is logged and skipped.
    """
    try:
        user = User.objects.get(firebase_uid=claims["uid"])
    except User.DoesNotExist:
        raise NotRegisteredError(claims["uid"]) from None

    phone_number = claims.get("phone_number") or ""
    if user.phone_number != phone_number:
        if phone_number and User.objects.filter(phone_number=phone_number).exclude(pk=user.pk).exists():
            logger.warning("Not syncing phone number for user %s: another person has it", user.pk)
        else:
            user.phone_number = phone_number
            user.save(update_fields=["phone_number"])

    return user


def link_firebase_identity(user: User, previous_phone_number: str) -> None:
    """Make the person's Firebase identity match user.phone_number. Call before saving.

    - Not linked yet, with a number: register (or reuse) that number's Firebase
      identity and link it, so the person can sign in.
    - Linked, number changed: move the identity to the new number.
    - Linked, number removed: remove the identity's number, so it can't sign in.

    Raises PhoneNumberInUseError if the identity belongs to someone else, and
    FirebaseUnavailableError if Firebase can't be reached (nothing is saved then).
    """
    phone_number = user.phone_number

    if user.firebase_uid:
        if phone_number != previous_phone_number:
            try:
                set_firebase_phone_number(user.firebase_uid, phone_number or None)
            except FirebasePhoneNumberTakenError:
                raise PhoneNumberInUseError(phone_number) from None
        return

    if not phone_number:
        return

    uid = get_or_create_firebase_uid(phone_number)
    if User.objects.filter(firebase_uid=uid).exclude(pk=user.pk).exists():
        raise PhoneNumberInUseError(phone_number)
    user.firebase_uid = uid
