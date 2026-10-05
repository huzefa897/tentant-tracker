import logging

from .firebase import (
    FirebasePhoneNumberTakenError,
    find_firebase_uid,
    get_or_create_firebase_uid,
    revoke_firebase_sessions,
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

    Like the admin's "can sign in", the person needs a mobile number as well as the
    link: one whose number was removed gets NotRegisteredError, and a claim never puts
    a number back. Otherwise the stored number follows the verified claim, so a number
    changed (or removed) in Firebase replaces the stored one; a clash with another
    person's number is logged and skipped.
    """
    try:
        user = User.objects.get(firebase_uid=claims["uid"])
    except User.DoesNotExist:
        raise NotRegisteredError(claims["uid"]) from None

    phone_number = claims.get("phone_number") or ""
    if user.phone_number and user.phone_number != phone_number:
        if phone_number and User.objects.filter(phone_number=phone_number).exclude(pk=user.pk).exists():
            logger.warning("Not syncing phone number for user %s: another person has it", user.pk)
        else:
            user.phone_number = phone_number
            user.save(update_fields=["phone_number"])

    if not user.phone_number:
        raise NotRegisteredError(claims["uid"])

    return user


def check_firebase_identity(user: User, previous_phone_number: str) -> None:
    """Read-only: would link_firebase_identity succeed? For form validation, so a clash
    shows on the form and Firebase isn't changed until everything else is valid.

    Raises PhoneNumberInUseError or FirebaseUnavailableError.
    """
    phone_number = user.phone_number
    if not phone_number or (user.firebase_uid and phone_number == previous_phone_number):
        return

    uid = find_firebase_uid(phone_number)
    if uid is None:
        return

    if user.firebase_uid:
        # Moving to a number another Firebase identity already has.
        if uid != user.firebase_uid:
            raise PhoneNumberInUseError(phone_number)
    elif User.objects.filter(firebase_uid=uid).exclude(pk=user.pk).exists():
        raise PhoneNumberInUseError(phone_number)


def link_firebase_identity(user: User, previous_phone_number: str) -> None:
    """Make the person's Firebase identity match user.phone_number. Changes Firebase, so
    call it as the last step of a save, after all validation (the admin does this inside
    its transaction, so a failure here rolls the database back). Sets user.firebase_uid
    on a new link; the caller saves it.

    - Not linked yet, with a number: register (or reuse) that number's Firebase
      identity and link it, so the person can sign in.
    - Linked, number changed: move the identity to the new number.
    - Linked, number removed: remove the identity's number, so it can't sign in.

    Either change also ends the identity's existing sessions, so whoever is signed in
    (perhaps on a lost phone) has to sign in again with the current number.

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
            revoke_firebase_sessions(user.firebase_uid)
        return

    if not phone_number:
        return

    uid = get_or_create_firebase_uid(phone_number)
    if User.objects.filter(firebase_uid=uid).exclude(pk=user.pk).exists():
        raise PhoneNumberInUseError(phone_number)
    user.firebase_uid = uid
