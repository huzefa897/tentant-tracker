from datetime import date
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from properties.models import Property, Tenancy

# Fictional people and numbers, for development only. Never message these numbers.
DEV_TENANCIES = (
    {
        "name": "Shaik Zahid Ali",
        "flat_number": "202",
        "mobile_number": "+919000000101",
        "rent_amount": Decimal("15000.00"),
        "rent_due_day": 11,
        "electricity_rate": Decimal("6.00"),
        "deposit_amount": Decimal("90000.00"),
        "start_date": date(2026, 1, 1),
    },
    {
        "name": "Mohammed Yusuf",
        "flat_number": "301",
        "mobile_number": "+919000000102",
        "rent_amount": Decimal("18000.00"),
        "rent_due_day": 10,
        "electricity_rate": Decimal("6.00"),
        "deposit_amount": Decimal("100000.00"),
        "start_date": date(2025, 6, 1),
    },
    {
        "name": "Ali Hussain",
        "flat_number": "102",
        "mobile_number": "+919000000103",
        "rent_amount": Decimal("14000.00"),
        "rent_due_day": 5,
        "electricity_rate": Decimal("6.00"),
        "deposit_amount": Decimal("80000.00"),
        "start_date": date(2026, 3, 15),
    },
)


class Command(BaseCommand):
    help = "Add three fictional current tenancies to a property (development only)."

    def add_arguments(self, parser):
        parser.add_argument("property", help="The property's name or id.")

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Development only: set DJANGO_DEBUG=True.")

        try:
            prop = Property.objects.get(name=options["property"])
        except Property.DoesNotExist:
            try:
                prop = Property.objects.get(pk=options["property"])
            except (Property.DoesNotExist, ValidationError) as error:  # Not a name, nor a valid id.
                raise CommandError(f"No property named or with id {options['property']!r}.") from error

        for fields in DEV_TENANCIES:
            tenancy = Tenancy(property=prop, **fields)
            if Tenancy.objects.filter(property=prop, flat_number=fields["flat_number"]).exists():
                self.stdout.write(f"Skipped Flat {fields['flat_number']}: it already has a tenancy.")
                continue
            tenancy.full_clean()
            tenancy.save()
            self.stdout.write(self.style.SUCCESS(f"Added {tenancy}."))
