import uuid
from datetime import date
from decimal import Decimal

from django.conf import settings
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateRangeField, RangeOperators
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models, transaction
from django.db.models import Func, Q, Value
from django.utils import timezone

from accounts.phone import normalize_phone_number, validate_phone_number


class Property(models.Model):
    """A building. Receipts will snapshot these details when issued."""

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    name = models.CharField(max_length=150)
    address = models.TextField()
    contact_number = models.CharField(
        max_length=20,
        blank=True,
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "properties"

    def __str__(self):
        return self.name


class PropertyMembership(models.Model):
    """A person's role at a property: the only thing that grants property access.
    What each role may do is in properties/roles.py."""

    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        MANAGER = "manager", "Manager"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="property_memberships",
    )
    property = models.ForeignKey(
        Property,
        on_delete=models.PROTECT,
        related_name="memberships",
    )
    role = models.CharField(
        max_length=20,
        choices=Role.choices,
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Inactive memberships keep their history but grant no access.",
    )
    # Who gave this access, for auditing. Kept if that person is later removed.
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        editable=False,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "property"],
                name="unique_user_property_membership",
            ),
        ]

    def __str__(self):
        return f"{self.user} | {self.property} | {self.get_role_display()}"


def business_date() -> date:
    """Today at the property. Every property is in India (settings.TIME_ZONE), so tenancy
    status never depends on the server's or the viewer's time zone."""
    return timezone.localdate()


def normalize_flat_number(value: str) -> str:
    """' g-01 ' -> 'G-01', so the same flat is always written the same way."""
    return " ".join((value or "").split()).upper()


class InclusiveDateRange(Func):
    """daterange(start, end, '[]'): both ends inclusive; a NULL end is open-ended."""

    function = "DATERANGE"
    output_field = DateRangeField()

    def __init__(self, start, end):
        super().__init__(start, end, Value("[]"))


# The database's guarantee that a flat has one occupant at a time, even if two admins save at
# once. clean() checks the same rule first, with a message naming the clashing tenancy.
TENANCY_OVERLAP_CONSTRAINT = "tenancy_no_overlapping_occupancy"


class TenancyQuerySet(models.QuerySet):
    """Status comes from the dates (end date inclusive), never from a stored flag."""

    def upcoming(self, today: date):
        return self.filter(start_date__gt=today)

    def current(self, today: date):
        return self.filter(Q(end_date__isnull=True) | Q(end_date__gte=today), start_date__lte=today)

    def ended(self, today: date):
        return self.filter(end_date__lt=today)

    def with_status(self, status: str, today: date):
        if status == "all":
            return self
        return getattr(self, status)(today)


TENANCY_PROPERTY_LOCKED_MESSAGE = (
    "This tenancy has bills, so it can't move to another property: its bills belong to this one."
)


class TenancyHasBillsError(ValidationError):
    """A tenancy with bills was saved with another property (two admins at once)."""


class Tenancy(models.Model):
    """One occupancy of a flat: a flat has a new tenancy (and id) for each occupant, and
    bills will belong to the tenancy. Tenants don't sign in; this only describes them."""

    class Status(models.TextChoices):
        UPCOMING = "upcoming", "Upcoming"
        CURRENT = "current", "Current"
        ENDED = "ended", "Ended"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    property = models.ForeignKey(
        Property,
        on_delete=models.PROTECT,
        related_name="tenancies",
    )
    name = models.CharField(max_length=150)
    flat_number = models.CharField(
        max_length=20,
        help_text="As written on the door, e.g. 202 or G-01.",
    )
    mobile_number = models.CharField(
        max_length=20,
        validators=[validate_phone_number],
        help_text="With its country code, e.g. +91 83414 13827.",
    )
    rent_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
        help_text="Current monthly rent (₹).",
    )
    rent_due_day = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(28)],
        help_text="Day of the month rent is due (1–28).",
    )
    electricity_rate = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
        help_text="Current price per unit (₹).",
    )
    deposit_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
        help_text="Deposit held (₹).",
    )
    start_date = models.DateField()
    end_date = models.DateField(
        null=True,
        blank=True,
        help_text="Last day of the occupancy. Leave empty while it continues.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = TenancyQuerySet.as_manager()

    class Meta:
        verbose_name_plural = "tenancies"
        ordering = ("flat_number", "name", "id")
        # The validators above give friendly messages; these protect the stored data.
        constraints = [
            models.CheckConstraint(
                condition=Q(rent_amount__gt=0),
                name="tenancy_rent_amount_positive",
                violation_error_message="Rent must be more than zero.",
            ),
            models.CheckConstraint(
                condition=Q(rent_due_day__gte=1, rent_due_day__lte=28),
                name="tenancy_rent_due_day_1_to_28",
                violation_error_message="The rent due day must be between 1 and 28.",
            ),
            models.CheckConstraint(
                condition=Q(electricity_rate__gte=0),
                name="tenancy_electricity_rate_not_negative",
                violation_error_message="The electricity rate can't be negative.",
            ),
            models.CheckConstraint(
                condition=Q(deposit_amount__gte=0),
                name="tenancy_deposit_amount_not_negative",
                violation_error_message="The deposit can't be negative.",
            ),
            models.CheckConstraint(
                condition=Q(end_date__isnull=True) | Q(end_date__gte=models.F("start_date")),
                name="tenancy_end_date_not_before_start_date",
                violation_error_message="The end date can't be before the start date.",
            ),
            # Needs the btree_gist extension (migration 0004) for the = comparisons.
            ExclusionConstraint(
                name=TENANCY_OVERLAP_CONSTRAINT,
                expressions=[
                    ("property", RangeOperators.EQUAL),
                    ("flat_number", RangeOperators.EQUAL),
                    (InclusiveDateRange("start_date", "end_date"), RangeOperators.OVERLAPS),
                ],
                violation_error_message="This flat already has a tenancy in this period.",
            ),
        ]

    def __str__(self):
        return f"{self.name} — Flat {self.flat_number}"

    def status_on(self, today: date) -> str:
        if self.start_date > today:
            return self.Status.UPCOMING
        if self.end_date is not None and self.end_date < today:
            return self.Status.ENDED
        return self.Status.CURRENT

    def get_status_display_on(self, today: date) -> str:
        return self.Status(self.status_on(today)).label

    def clean_fields(self, exclude=None):
        # Before field validation, so "+91 83414 13827" validates as "+918341413827".
        self.name = " ".join((self.name or "").split())
        self.flat_number = normalize_flat_number(self.flat_number)
        self.mobile_number = normalize_phone_number(self.mobile_number)
        super().clean_fields(exclude=exclude)

    def get_constraints(self):
        # clean() reports overlaps with the clashing tenancy's details, so model validation
        # skips the exclusion constraint rather than repeat a vaguer message. The database
        # still enforces it.
        return [
            (model, [c for c in constraints if c.name != TENANCY_OVERLAP_CONSTRAINT])
            for model, constraints in super().get_constraints()
        ]

    def clean(self):
        super().clean()
        if self.end_date and self.start_date and self.end_date < self.start_date:
            raise ValidationError({"end_date": "The end date can't be before the start date."})
        self._check_no_overlap()
        if self.moves_property_with_bills():
            raise ValidationError({"property": TENANCY_PROPERTY_LOCKED_MESSAGE})

    def save(self, *args, **kwargs):
        # Bills are scoped through their tenancy's property, so moving a tenancy that has bills
        # would show them to the new property's members and hide them from the old one's. The
        # row is locked first, like create_rent_entry does, so a bill can't be added between
        # this check and the save.
        with transaction.atomic():
            if self.moves_property_with_bills(lock=True):
                raise TenancyHasBillsError({"property": TENANCY_PROPERTY_LOCKED_MESSAGE})
            super().save(*args, **kwargs)

    def moves_property_with_bills(self, *, lock=False) -> bool:
        """Whether this saved tenancy has bills and now names another property."""
        if self._state.adding:
            return False
        stored = Tenancy.objects.filter(pk=self.pk)
        if lock:
            stored = stored.select_for_update()
        stored_property_id = stored.values_list("property_id", flat=True).first()
        return (
            stored_property_id is not None
            and stored_property_id != self.property_id
            and self.rent_entries.exists()
        )

    def _check_no_overlap(self):
        """A flat has one occupant at a time. Both end dates are inclusive, so a tenancy can
        start the day after the previous one ends, not on the same day.

        Two simultaneous saves can both pass this check; the exclusion constraint then
        rejects the second in the database.
        """
        if not (self.property_id and self.flat_number and self.start_date):
            return

        overlapping = Tenancy.objects.filter(
            property_id=self.property_id,
            flat_number=self.flat_number,
        ).filter(Q(end_date__isnull=True) | Q(end_date__gte=self.start_date))
        if self.end_date:
            overlapping = overlapping.filter(start_date__lte=self.end_date)
        other = overlapping.exclude(pk=self.pk).order_by("start_date").first()

        if other:
            until = other.end_date.isoformat() if other.end_date else "now"
            raise ValidationError(
                f"Flat {self.flat_number} already has a tenancy in this period: "
                f"{other.name}, {other.start_date.isoformat()} to {until}."
            )
