from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

from .phone import format_phone_number, normalize_phone_number, validate_phone_number


def normalize_email(value: str) -> str:
    """Emails are compared ignoring case (Google's are case-insensitive), so store them
    lowercased and trimmed."""
    return (value or "").strip().lower()


class User(AbstractUser):
    """A person. Admin portal access (is_staff/is_superuser, password login) and app
    sign-in (Google, through Firebase) are separate permissions on the same person;
    property access comes only from PropertyMembership.

    App sign-in is invite-only: an admin adds the person with their Google email, and
    their first Google sign-in with that verified email links its Firebase identity
    (firebase_uid) to them (accounts/services.py). Any other Google account is refused
    and creates nothing.
    """

    # Null, not blank, so several admins can exist without breaking uniqueness.
    firebase_uid = models.CharField(
        max_length=128,
        unique=True,
        null=True,
        blank=True,
        editable=False,
        verbose_name="Firebase UID",
    )

    # Temporary: the phone sign-in identity each person had before the move to Google
    # sign-in (migration 0005), kept so that migration can be reversed. Drop it once
    # everyone has signed in with Google.
    legacy_phone_firebase_uid = models.CharField(
        max_length=128, null=True, blank=True, editable=False
    )

    email = models.EmailField(
        "Google email",
        blank=True,
        help_text="The Google account this person signs in to the app with.",
    )

    # One field rather than first/last name, which fit many names poorly. Optional:
    # it only helps admins recognise people.
    name = models.CharField(max_length=150, blank=True)

    phone_number = models.CharField(
        max_length=20,
        blank=True,
        validators=[validate_phone_number],
        verbose_name="mobile number",
        help_text="With country code, e.g. +91 83414 13827. For contact only: sign-in uses the Google email.",
    )

    class Meta(AbstractUser.Meta):
        verbose_name = "person"
        verbose_name_plural = "people"
        constraints = [
            models.UniqueConstraint(
                fields=["phone_number"],
                condition=~Q(phone_number=""),
                name="unique_user_phone_number",
                violation_error_message="Another person already has this mobile number.",
            ),
            models.UniqueConstraint(
                Lower("email"),
                condition=~Q(email=""),
                name="unique_user_email",
                violation_error_message="Another person already has this email.",
            ),
        ]

    def clean_fields(self, exclude=None):
        # Before field validation, so "+91 89778 67546" validates as "+918977867546".
        self.phone_number = normalize_phone_number(self.phone_number)
        self.name = " ".join(self.name.split())
        self.email = normalize_email(self.email)
        super().clean_fields(exclude=exclude)

    @property
    def display_name(self) -> str:
        """'Huzefa Saleem — +91 89778 67546', or whichever of the two is set, else the
        email, else the username."""
        phone = format_phone_number(self.phone_number) if self.phone_number else ""
        return (
            " — ".join(part for part in (self.name.strip(), phone) if part)
            or self.email
            or self.username
        )

    def __str__(self):
        return self.display_name


class AdminLoginAttempts(models.Model):
    """Admin login attempts in the current window for one key (a hash of an address, or of an
    address and username): config/middleware.py AdminLoginThrottleMiddleware. Kept in
    PostgreSQL and counted under a row lock, so every process shares one exact count."""

    key = models.CharField(max_length=64, primary_key=True)
    attempts = models.PositiveIntegerField(default=0)
    window_ends = models.DateTimeField(db_index=True)

    class Meta:
        verbose_name_plural = "admin login attempts"
