from django.core.management.base import BaseCommand

from messaging.clock import SystemClock
from messaging.models import RunTrigger
from messaging.runner import MessageRunner
from messaging.senders import get_sender


class Command(BaseCommand):
    help = (
        "Sends the messages due now: Rent Due Reminders for each property whose send time has "
        "come (docs/messaging.md). Safe to run again: nothing is sent twice. Without a "
        "provider configured it sends nothing and lists what it would send."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help=(
                "List what would be sent, and send or reserve nothing. The run is recorded, and "
                "rental periods that are due are created, as every run and the dashboard do."
            ),
        )

    def handle(self, *args, dry_run=False, **options):
        sender = get_sender()
        result = MessageRunner(
            sender, SystemClock(), trigger=RunTrigger.COMMAND, dry_run=dry_run
        ).run()
        run = result.run
        if run.dry_run:
            why = "dry run" if dry_run else "no provider configured"
            self.stdout.write(f"Nothing sent ({why}). Would send {run.planned}:")
        # Flats and months only: no names or numbers, since this output can end up in logs.
        for planned in result.planned:
            months = ", ".join(
                f"{r.period_month:%B %Y} ({r.stage.label})" for r in planned.reminders
            )
            self.stdout.write(f"  Flat {planned.tenancy.flat_number} ({planned.tenancy.pk}): {months}")
        self.stdout.write(
            f"Properties checked {run.properties_checked}; sent {run.sent}, failed {run.failed}, "
            f"unknown {run.unknown}, skipped {run.skipped}."
        )
        if run.errors:
            self.stderr.write(f"Errors:\n{run.errors}")
