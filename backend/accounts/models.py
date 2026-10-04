from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """App user. Roles belong on property membership, not here.

    firebase_uid is null for local Django admins (username/password login);
    Firebase-backed users get one in BE Phase 2. Null, not blank, so several
    admins can exist without breaking the unique constraint.
    """

    firebase_uid = models.CharField(
        max_length=128,
        unique=True,
        null=True,
        blank=True,
    )

    phone_number = models.CharField(
        max_length=20,
        blank=True,
    )
