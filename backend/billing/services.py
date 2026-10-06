from django.db import IntegrityError, transaction

from properties.models import Tenancy

from .models import RentEntry, tenancy_covers_month

UNIQUE_MONTH_CONSTRAINT = "unique_tenancy_billing_month"


class DuplicateBillingMonthError(Exception):
    """The tenancy already has a bill for this month."""


class BillingMonthOutsideTenancyError(Exception):
    """No day of the billing month falls within the occupancy."""


def _is_unique_month_violation(error: IntegrityError) -> bool:
    # psycopg reports which constraint failed. Only this one means "duplicate month": any other
    # integrity failure is a real error and must not be reported as a duplicate.
    diag = getattr(error.__cause__, "diag", None)
    return getattr(diag, "constraint_name", None) == UNIQUE_MONTH_CONSTRAINT


def create_rent_entry(*, tenancy: Tenancy, actor, validated_data: dict) -> RentEntry:
    """Creates a bill with the tenancy's current charges copied onto it.

    validated_data: billing_month (first of the month), electricity_units, water_amount,
    and optionally rent_amount (defaults to the tenancy's rent) and notes. The electricity
    rate always comes from the tenancy.
    """
    billing_month = validated_data["billing_month"]

    try:
        with transaction.atomic():
            # Locked and reloaded, so its rent, rate and dates can't change while the bill is
            # created, and simultaneous bills for one tenancy are made one at a time.
            locked = Tenancy.objects.select_for_update().get(pk=tenancy.pk)

            if not tenancy_covers_month(locked, billing_month):
                raise BillingMonthOutsideTenancyError()

            # A readable error for the common case; the unique constraint still decides.
            if RentEntry.objects.filter(tenancy=locked, billing_month=billing_month).exists():
                raise DuplicateBillingMonthError()

            rent_amount = validated_data.get("rent_amount")
            return RentEntry.objects.create(
                tenancy=locked,
                billing_month=billing_month,
                rent_amount=locked.rent_amount if rent_amount is None else rent_amount,
                electricity_units=validated_data["electricity_units"],
                electricity_rate=locked.electricity_rate,
                water_amount=validated_data["water_amount"],
                notes=validated_data.get("notes", ""),
                created_by=actor,
            )
    except IntegrityError as error:
        # Caught outside the failed transaction, which has been rolled back.
        if _is_unique_month_violation(error):
            raise DuplicateBillingMonthError() from error
        raise
