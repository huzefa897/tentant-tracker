import uuid
from calendar import monthrange
from datetime import date

from django.conf import settings
from django.db import models
from django.db.models import Q

from properties.models import Tenancy


def month_end(billing_month: date) -> date:
    return billing_month.replace(day=monthrange(billing_month.year, billing_month.month)[1])


def tenancy_covers_month(tenancy: Tenancy, billing_month: date) -> bool:
    """Whether any day of the month falls within the occupancy (end date inclusive). A
    tenancy starting on 20 September may have a September bill; its rent isn't prorated."""
    return tenancy.start_date <= month_end(billing_month) and (
        tenancy.end_date is None or tenancy.end_date >= billing_month
    )


class RentEntry(models.Model):
    """The charges of one tenancy's bill for one month.

    Rent and electricity rate are copied from the tenancy when the bill is created: they're
    historical values, so changing the tenancy later never changes a saved bill. Totals, paid,
    outstanding and status are derived (billing/calculations.py), never stored.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # PROTECT: removing an occupant must never erase their billing history.
    tenancy = models.ForeignKey(
        Tenancy,
        on_delete=models.PROTECT,
        related_name="rent_entries",
    )
    billing_month = models.DateField(help_text="The first day of the billed month.")
    rent_amount = models.DecimalField(max_digits=10, decimal_places=2)
    electricity_units = models.DecimalField(max_digits=10, decimal_places=3)
    electricity_rate = models.DecimalField(max_digits=8, decimal_places=2)
    water_amount = models.DecimalField(max_digits=10, decimal_places=2)
    # A bounded column (varchar), so the database enforces the 500-character limit too.
    notes = models.CharField(max_length=500, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "rent entries"
        ordering = ("-billing_month", "-created_at")
        # The API validates first for readable errors; these protect the stored data,
        # including against concurrent requests.
        constraints = [
            models.UniqueConstraint(
                fields=["tenancy", "billing_month"],
                name="unique_tenancy_billing_month",
                violation_error_message="An entry already exists for this tenancy and month.",
            ),
            models.CheckConstraint(
                condition=Q(rent_amount__gt=0),
                name="rent_entry_rent_amount_positive",
            ),
            models.CheckConstraint(
                condition=Q(electricity_units__gte=0),
                name="rent_entry_electricity_units_not_negative",
            ),
            models.CheckConstraint(
                condition=Q(electricity_rate__gte=0),
                name="rent_entry_electricity_rate_not_negative",
            ),
            models.CheckConstraint(
                condition=Q(water_amount__gte=0),
                name="rent_entry_water_amount_not_negative",
            ),
            models.CheckConstraint(
                condition=Q(billing_month__day=1),
                name="rent_entry_billing_month_first_day",
            ),
        ]

    def __str__(self):
        return f"{self.tenancy} — {self.billing_month:%B %Y}"
