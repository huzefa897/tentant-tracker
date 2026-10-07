from django.core.management.base import BaseCommand

from billing.summary import ledger_summary


class Command(BaseCommand):
    help = (
        "Prints counts, money totals and checksums of the people, access, bills, payments and "
        "receipts in the database. Two databases holding the same records print the same."
    )

    def handle(self, *args, **options):
        for name, value in ledger_summary():
            self.stdout.write(f"{name}: {value}")
