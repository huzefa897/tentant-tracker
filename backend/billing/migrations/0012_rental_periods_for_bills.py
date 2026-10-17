"""Gives every month that already has a bill (void ones too) its rental period.

Bills from before rental periods saved no due date, and neither the Sheet nor the app kept a
history of due days or payment timing, so each period gets the property's timing and the
tenancy's due day as they are when this runs (docs/rent-entries.md). Nothing about the bills,
payments, reversals or receipts changes.
"""

from calendar import monthrange
from datetime import date

from django.db import migrations


def due_date_for(month, due_day, timing):
    # billing/calculations.py due_date_for, copied so this migration never changes with it.
    year, number = month.year, month.month
    if timing == "postpaid":
        year, number = (year + 1, 1) if number == 12 else (year, number + 1)
    return date(year, number, min(due_day, monthrange(year, number)[1]))


def create_periods(apps, schema_editor):
    RentEntry = apps.get_model("billing", "RentEntry")
    RentalPeriod = apps.get_model("billing", "RentalPeriod")
    Tenancy = apps.get_model("properties", "Tenancy")

    months = RentEntry.objects.values_list("tenancy_id", "billing_month").distinct()
    tenancies = Tenancy.objects.select_related("property").in_bulk(
        {tenancy_id for tenancy_id, _ in months}
    )
    periods = []
    for tenancy_id, month in months:
        tenancy = tenancies[tenancy_id]
        timing = tenancy.property.payment_timing
        periods.append(
            RentalPeriod(
                tenancy_id=tenancy_id,
                period_month=month,
                payment_timing=timing,
                due_day=tenancy.rent_due_day,
                due_date=due_date_for(month, tenancy.rent_due_day, timing),
            )
        )
    RentalPeriod.objects.bulk_create(periods, ignore_conflicts=True)


class Migration(migrations.Migration):
    dependencies = [
        ("billing", "0011_rental_periods"),
    ]

    operations = [
        migrations.RunPython(create_periods, migrations.RunPython.noop),
    ]
