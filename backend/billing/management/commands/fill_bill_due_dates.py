import uuid
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from billing.models import RentEntry, bill_due
from billing.serializers import MONTH_PATTERN


def _month(value: str) -> date:
    match = MONTH_PATTERN.match(value)
    if not match or not 1 <= int(match[2]) <= 12:
        raise CommandError(f"--until takes a month as YYYY-MM, not {value!r}.")
    return date(int(match[1]), int(match[2]), 1)


def _tenancy_id(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise CommandError(f"--tenancy takes a tenancy id, not {value!r}.") from None


class Command(BaseCommand):
    help = (
        "Gives bills from before due dates their payment timing and due date: the property's "
        "timing and the tenancy's due day as they are now (docs/rent-entries.md). Only bills "
        "without one are changed. Lists every bill it changes; try it with --dry-run first."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List the due dates it would give, and save nothing.",
        )
        parser.add_argument(
            "--tenancy",
            help="Only this tenancy's bills (its id), e.g. to fill its months from before a "
            "due-day change with the old day set on the tenancy for the run.",
        )
        parser.add_argument(
            "--until",
            help="Only bills for this month (YYYY-MM) or earlier.",
        )

    def handle(self, *args, **options):
        bills = (
            RentEntry.objects.filter(due_date__isnull=True)
            .select_related("tenancy__property")
            .order_by(
                "tenancy__property__name", "tenancy__flat_number", "tenancy_id", "billing_month"
            )
        )
        if options["tenancy"]:
            bills = bills.filter(tenancy_id=_tenancy_id(options["tenancy"]))
        if options["until"]:
            bills = bills.filter(billing_month__lte=_month(options["until"]))

        dry_run = options["dry_run"]
        filled = 0
        with transaction.atomic():
            for bill in bills.select_for_update(of=("self",)):
                tenancy = bill.tenancy
                timing, due_date = bill_due(tenancy, bill.billing_month)
                self.stdout.write(
                    f"{tenancy.property.name} · Flat {tenancy.flat_number} · {tenancy.name} · "
                    f"{bill.billing_month:%B %Y}{' (void)' if bill.status == 'void' else ''}: "
                    f"{timing}, due day {tenancy.rent_due_day} → due {due_date:%d %B %Y}"
                )
                if not dry_run:
                    bill.payment_timing = timing
                    bill.due_date = due_date
                    bill.save(update_fields=["payment_timing", "due_date"])
                filled += 1

        if filled == 0:
            self.stdout.write("Every matching bill already has a due date.")
        elif dry_run:
            self.stdout.write(f"Would give {filled} bill(s) a due date. Nothing was saved.")
        else:
            self.stdout.write(self.style.SUCCESS(f"Gave {filled} bill(s) a due date."))
