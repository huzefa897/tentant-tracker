import uuid

from django.core.management.base import BaseCommand, CommandError

from billing.models import RentalPeriod, RentEntry
from billing.periods import scheduled_months
from properties.models import Property, Tenancy, business_date

from ._months import parse_month


class Command(BaseCommand):
    help = (
        "Lists the months that would show as due or overdue without a bill if the property's "
        "tracking cut-off were --start, or with no cut-off (each tenancy from its first month) "
        "without it (Property.rent_tracking_start, docs/rent-entries.md). Saves nothing. Run "
        "it before importing or changing the cut-off, and mark any month already settled "
        "outside the app as not owed."
    )

    def add_arguments(self, parser):
        parser.add_argument("--property", required=True, help="The property's id.")
        parser.add_argument(
            "--start", help="The cut-off: the first month counted without a bill (YYYY-MM)."
        )

    def handle(self, *args, **options):
        try:
            prop = Property.objects.get(pk=uuid.UUID(options["property"]))
        except (ValueError, Property.DoesNotExist):
            raise CommandError(f"No property with the id {options['property']!r}.") from None
        # An unsaved copy: the stored property doesn't change.
        prop.rent_tracking_start = (
            parse_month("--start", options["start"]) if options["start"] else None
        )
        today = business_date()

        billed = set(
            RentEntry.objects.active()
            .filter(tenancy__property=prop)
            .values_list("tenancy_id", "billing_month")
        )
        not_owed = set(
            RentalPeriod.objects.filter(tenancy__property=prop, not_owed_at__isnull=False)
            .values_list("tenancy_id", "period_month")
        )
        listed = 0
        tenancies = Tenancy.objects.filter(property=prop).order_by("flat_number", "name", "id")
        for tenancy in tenancies:
            for month in scheduled_months(tenancy, prop, today):
                if (tenancy.pk, month) in billed | not_owed:
                    continue
                self.stdout.write(
                    f"Flat {tenancy.flat_number} · {tenancy.name} · {month:%B %Y}: no bill"
                )
                listed += 1

        if listed == 0:
            self.stdout.write("Every month from then has a bill. Nothing would show as unbilled.")
        else:
            self.stdout.write(
                f"{listed} month(s) would show as due or overdue, awaiting a bill. "
                "Nothing was saved."
            )
