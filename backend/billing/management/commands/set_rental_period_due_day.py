import uuid

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from billing.calculations import due_date_for
from billing.models import RentalPeriod
from properties.models import Tenancy

from ._months import parse_month


class Command(BaseCommand):
    help = (
        "Corrects the due day of a tenancy's existing rental periods, e.g. months created from "
        "today's due day that were really due on another (docs/rent-entries.md). Only the "
        "periods in --from/--until change; the tenancy's own due day doesn't. Lists every "
        "period it changes; try it with --dry-run first."
    )

    def add_arguments(self, parser):
        parser.add_argument("--tenancy", required=True, help="The tenancy's id.")
        parser.add_argument("--due-day", required=True, type=int, help="The day (1–31).")
        parser.add_argument("--from", dest="start", help="The first month (YYYY-MM).")
        parser.add_argument("--until", help="The last month (YYYY-MM).")
        parser.add_argument("--dry-run", action="store_true", help="List; save nothing.")

    def handle(self, *args, **options):
        try:
            tenancy = Tenancy.objects.get(pk=uuid.UUID(options["tenancy"]))
        except (ValueError, Tenancy.DoesNotExist):
            raise CommandError(f"No tenancy with the id {options['tenancy']!r}.") from None
        due_day = options["due_day"]
        if not 1 <= due_day <= 31:
            raise CommandError("--due-day takes a day from 1 to 31.")

        periods = RentalPeriod.objects.filter(tenancy=tenancy).order_by("period_month")
        if options["start"]:
            periods = periods.filter(period_month__gte=parse_month("--from", options["start"]))
        if options["until"]:
            periods = periods.filter(period_month__lte=parse_month("--until", options["until"]))

        dry_run = options["dry_run"]
        changed = 0
        with transaction.atomic():
            for period in periods.select_for_update():
                due_date = due_date_for(period.period_month, due_day, period.payment_timing)
                if (period.due_day, period.due_date) == (due_day, due_date):
                    continue
                self.stdout.write(
                    f"Flat {tenancy.flat_number} · {tenancy.name} · {period.period_month:%B %Y}: "
                    f"due {period.due_date:%d %B %Y} → {due_date:%d %B %Y}"
                )
                if not dry_run:
                    period.due_day = due_day
                    period.due_date = due_date
                    period.save(update_fields=["due_day", "due_date"])
                changed += 1

        if changed == 0:
            self.stdout.write("Every matching period is already due on that day.")
        elif dry_run:
            self.stdout.write(f"Would change {changed} period(s). Nothing was saved.")
        else:
            self.stdout.write(self.style.SUCCESS(f"Changed {changed} period(s)."))
