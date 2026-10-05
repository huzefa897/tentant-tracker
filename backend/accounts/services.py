import uuid

from django.contrib.auth.hashers import make_password

from .models import User


def get_or_create_firebase_user(claims: dict) -> User:
    """Return the local user for verified Firebase claims, creating it on first sign-in.

    New users get an internal username and an unusable password, are never staff,
    and have no property memberships: access is granted separately by an admin.
    get_or_create on the unique firebase_uid makes concurrent first requests safe.
    The phone number always follows the verified claim, so a number changed in
    Firebase replaces the stored one on the next request.
    """
    phone_number = claims.get("phone_number") or ""
    user, created = User.objects.get_or_create(
        firebase_uid=claims["uid"],
        defaults={
            "username": f"firebase-{uuid.uuid4().hex}",
            "phone_number": phone_number,
            # make_password(None) is an unusable password, like set_unusable_password().
            "password": make_password(None),
        },
    )
    if not created and user.phone_number != phone_number:
        user.phone_number = phone_number
        user.save(update_fields=["phone_number"])
    return user
