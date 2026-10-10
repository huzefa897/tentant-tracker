import json
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from billing.legacy_import import import_ledger
from billing.legacy_ledger import LedgerError, parse_ledger, parse_mapping
from properties.models import business_date


def _read_json(path: str, what: str):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise CommandError(f"The {what} {path} doesn't exist.") from None
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CommandError(f"The {what} {path} isn't valid JSON: {error}") from None


class Command(BaseCommand):
    help = (
        "Imports bills, payments and receipts from a legacy ledger file (docs/data-import.md). "
        "All or nothing; rerunning it creates nothing twice. Try it with --dry-run first."
    )

    def add_arguments(self, parser):
        parser.add_argument("ledger", help="The ledger JSON file (e.g. from sheet_to_ledger).")
        parser.add_argument(
            "--mapping",
            required=True,
            help='JSON file mapping each ledger tenant\'s sourceId to a tenancy id: {"Tenant A": '
            '"<tenancy uuid>"}. Never matched by name.',
        )
        parser.add_argument(
            "--imported-by",
            required=True,
            help="Username recorded as creating the imported records (e.g. the owner's).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Check and reconcile everything, then save nothing.",
        )

    def handle(self, *args, **options):
        try:
            ledger = parse_ledger(_read_json(options["ledger"], "ledger"), today=business_date())
            mapping = parse_mapping(_read_json(options["mapping"], "mapping file"))
        except LedgerError as error:
            for problem in error.problems:
                self.stderr.write(f"  - {problem}")
            raise CommandError(
                f"The files have {len(error.problems)} problem(s); nothing was imported."
            ) from None

        user = get_user_model().objects.filter(username=options["imported_by"]).first()
        if user is None:
            raise CommandError(f"There's no user {options['imported_by']!r}.")

        report = import_ledger(ledger, mapping, imported_by=user, dry_run=options["dry_run"])

        self.stdout.write(f"{'':10}{'created':>10}{'already imported':>20}")
        for kind in ("bill", "payment", "receipt"):
            self.stdout.write(
                f"{kind + 's':10}{report.created[kind]:>10}{report.already[kind]:>20}"
            )
        if report.reconciliation:
            self.stdout.write("\nReconciliation (source / database):")
            for check, source, database in report.reconciliation:
                mark = "ok" if source == database else "MISMATCH"
                self.stdout.write(f"  {check:32}{source:>14} / {database:<14} {mark}")
        if report.rejected:
            self.stderr.write(f"\nRejected ({len(report.rejected)}):")
            for message in report.rejected:
                self.stderr.write(f"  - {message}")
            raise CommandError("Nothing was imported. Fix the problems above and run it again.")
        if not report.reconciled:
            raise CommandError("The database doesn't match the source; nothing was imported.")
        if report.dry_run:
            self.stdout.write(self.style.WARNING("\nDry run: nothing was saved."))
        else:
            self.stdout.write(self.style.SUCCESS("\nImported."))
