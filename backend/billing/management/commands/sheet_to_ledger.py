import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from billing.sheet_ledger import convert_workbook
from properties.models import business_date


class Command(BaseCommand):
    help = (
        "Converts the owners' Google Sheet, downloaded as .xlsx, into a ledger file for "
        "import_legacy_ledger (docs/data-import.md). Needs the dev packages (openpyxl)."
    )

    def add_arguments(self, parser):
        parser.add_argument("workbook", help="The .xlsx from Google Sheets (File > Download).")
        parser.add_argument("--output", required=True, help="The ledger JSON file to write.")
        parser.add_argument(
            "--mapping-template",
            help="Also write a mapping file listing every tenant tab, to fill in with tenancy "
            "ids (never overwrites an existing one).",
        )
        parser.add_argument("--force", action="store_true", help="Overwrite --output.")

    def handle(self, *args, **options):
        try:
            import openpyxl
        except ImportError:
            raise CommandError("Needs openpyxl: run `pipenv install --dev`.") from None

        output = Path(options["output"])
        if output.exists() and not options["force"]:
            raise CommandError(f"{output} exists; pass --force to replace it.")
        try:
            # data_only: the values formulas showed when the file was saved, not the formulas.
            workbook = openpyxl.load_workbook(options["workbook"], data_only=True)
        except (OSError, ValueError, KeyError) as error:
            raise CommandError(f"Couldn't open {options['workbook']}: {error}") from None

        conversion = convert_workbook(workbook, today=business_date())

        if conversion.skipped_tabs:
            self.stdout.write(f"Skipped tabs: {', '.join(conversion.skipped_tabs)}")
        for name, value in conversion.totals().items():
            self.stdout.write(f"  {name:14}{value:>14}")
        if conversion.warnings:
            self.stdout.write(f"\nCheck these ({len(conversion.warnings)}):")
            for warning in conversion.warnings:
                self.stdout.write(f"  - {warning}")
        if conversion.problems:
            self.stderr.write(f"\nProblems ({len(conversion.problems)}):")
            for problem in conversion.problems:
                self.stderr.write(f"  - {problem}")
            raise CommandError(
                "Nothing was written. Fix these in the sheet, download it again and rerun."
            )

        output.write_text(json.dumps(conversion.ledger, indent=2, ensure_ascii=False) + "\n")
        self.stdout.write(self.style.SUCCESS(f"\nWrote {output}."))
        template = options["mapping_template"]
        if template and not Path(template).exists():
            mapping = {tenant["sourceId"]: "" for tenant in conversion.ledger["tenants"]}
            Path(template).write_text(json.dumps(mapping, indent=2, ensure_ascii=False) + "\n")
            self.stdout.write(f"Wrote {template}: fill in each tab's tenancy id.")
        self.stdout.write(
            "It holds tenants' names and payments: keep it outside the repository, never "
            "commit it."
        )
