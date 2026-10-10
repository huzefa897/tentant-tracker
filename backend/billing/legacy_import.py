"""Imports a legacy ledger (billing/legacy_ledger.py) into the database, once.

Everything happens in one transaction with the mapped tenancies locked: either the whole ledger
is imported, or (any record rejected, reconciliation failing, or a dry run) nothing is.

- Each source record is tracked in LegacyRecord with a fingerprint of what was imported, so a
  rerun reports it as already imported, and a record that changed since is rejected.
- A month that already has a bill not imported from this source is rejected, never merged.
- Bills keep their historical rent and rate. Payments keep their dates. Receipts keep their
  original references; their snapshot is built from the imported records, as at the time they
  were issued.
- After importing, the source and the database are reconciled: counts, totals and every bill's
  outstanding must match, or nothing is kept. Every payment on the source's bills counts, so a
  bill with a payment recorded in the app (possibly the same money the source lists) fails it.
"""

import hashlib
import json
import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, time
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction
from django.db.models import Max, Sum

from properties.models import Property, Tenancy

from .calculations import ZERO, entry_amounts
from .legacy_ledger import RECEIPT_SUFFIX, Ledger, LedgerBill, LedgerPayment
from .models import LegacyRecord, Payment, Receipt, RentEntry, tenancy_covers_month
from .services import receipt_problem, receipt_snapshot

# Imported payments' idempotency keys are derived from their source ids, so they're stable.
PAYMENT_KEY_NAMESPACE = uuid.UUID("5b0d6a43-9a5e-4a8b-8c43-6f1d1f1c5e21")
Kind = LegacyRecord.Kind


@dataclass
class ImportReport:
    dry_run: bool
    created: Counter = field(default_factory=Counter)
    already: Counter = field(default_factory=Counter)
    rejected: list[str] = field(default_factory=list)
    # (check, in the source, in the database)
    reconciliation: list[tuple[str, str, str]] = field(default_factory=list)

    @property
    def reconciled(self) -> bool:
        return all(source == database for _, source, database in self.reconciliation)

    @property
    def saved(self) -> bool:
        return not self.dry_run and not self.rejected and self.reconciled


def _fingerprint(values: dict) -> str:
    return hashlib.sha256(json.dumps(values, sort_keys=True, default=str).encode()).hexdigest()


def _previous_month(month):
    if month.month == 1:
        return month.replace(year=month.year - 1, month=12)
    return month.replace(month=month.month - 1)


class _Importer:
    def __init__(
        self, ledger: Ledger, mapping: dict[str, uuid.UUID], imported_by, dry_run, property_id
    ):
        self.ledger = ledger
        self.mapping = mapping
        self.property_id = property_id
        self.imported_by = imported_by
        self.report = ImportReport(dry_run=dry_run)
        # Bill source id → the database bill, for reconciliation.
        self.entries: dict[str, RentEntry] = {}

    def sid(self, source_id: str) -> str:
        return f"{self.ledger.source}:{source_id}"

    def reject(self, message: str):
        self.report.rejected.append(message)

    def existing(self, source_id: str, kind: str, fingerprint: str, label: str):
        """The object already imported from this source record, None if it's new, or False
        (after rejecting it) if it was imported differently."""
        record = LegacyRecord.objects.filter(source_id=source_id).first()
        if record is None:
            return None
        if record.kind != kind or record.fingerprint != fingerprint:
            self.reject(f"{label}: changed since it was imported on {record.imported_at:%d %b %Y}")
            return False
        model = {Kind.BILL: RentEntry, Kind.PAYMENT: Payment, Kind.RECEIPT: Receipt}[kind]
        found = model.objects.filter(pk=record.object_id).first()
        if found is None:
            self.reject(f"{label}: was imported, but its {kind} is no longer in the database")
            return False
        self.report.already[kind] += 1
        return found

    def record(self, source_id: str, kind: str, obj, fingerprint: str):
        LegacyRecord.objects.create(
            source_id=source_id,
            kind=kind,
            object_id=obj.pk,
            fingerprint=fingerprint,
            imported_by=self.imported_by,
        )
        self.report.created[kind] += 1

    def run(self):
        tenancies = self.lock_tenancies()
        if tenancies is None:
            return
        # Each tenancy's months oldest first, whatever order the file lists them in: a receipt's
        # previous_month_outstanding reads last month's bill and payments, so they must be here.
        bills = sorted(
            ((tenancies[tenant.source_id], bill) for tenant, bill in self.ledger.bills()),
            key=lambda pair: (pair[0].pk, pair[1].billing_month),
        )
        for tenancy, bill in bills:
            self.import_bill(tenancy, bill)
        if not self.report.rejected:
            self.reconcile()

    def lock_tenancies(self) -> dict | None:
        missing = [t.source_id for t in self.ledger.tenants if t.source_id not in self.mapping]
        for tenant_id in missing:
            self.reject(f"tenant {tenant_id!r}: not in the mapping file")
        ids = {self.mapping[t.source_id] for t in self.ledger.tenants if t.source_id not in missing}
        # Locked (in id order) until the import commits, like bill creation does.
        locked = Tenancy.objects.select_for_update().filter(pk__in=ids).order_by("pk")
        found = {tenancy.pk: tenancy for tenancy in locked}
        tenancies = {}
        months: dict[tuple, str] = {}
        for tenant in self.ledger.tenants:
            if tenant.source_id not in self.mapping:
                continue
            tenancy = found.get(self.mapping[tenant.source_id])
            if tenancy is None:
                self.reject(
                    f"tenant {tenant.source_id!r}: tenancy {self.mapping[tenant.source_id]} "
                    "doesn't exist"
                )
                continue
            # Read under the lock, so a tenancy moved since the mapping was checked (admin
            # signs it at Check and imports up to an hour later) can't take its bills and
            # receipts to another property, and can't move until this commits.
            if self.property_id is not None and tenancy.property_id != self.property_id:
                self.reject(
                    f"tenant {tenant.source_id!r}: tenancy {tenancy.pk} isn't one of this "
                    "property's tenancies any more"
                )
                continue
            tenancies[tenant.source_id] = tenancy
            for bill in tenant.bills:
                # Two ledger tenants mapped to one tenancy can't both have a month.
                key = (tenancy.pk, bill.billing_month)
                if key in months:
                    self.reject(
                        f"bill {bill.source_id!r}: {bill.billing_month:%Y-%m} is also in "
                        f"{months[key]!r}, mapped to the same tenancy"
                    )
                months[key] = bill.source_id
        return None if self.report.rejected else tenancies

    def import_bill(self, tenancy: Tenancy, bill: LedgerBill):
        label = f"bill {bill.source_id!r}"
        source_id = self.sid(bill.source_id)
        fingerprint = _fingerprint(
            {
                "tenancy": tenancy.pk,
                "billingMonth": bill.billing_month,
                "rent": bill.rent_amount,
                "units": bill.electricity_units,
                "rate": bill.electricity_rate,
                "water": bill.water_amount,
                "notes": bill.notes,
            }
        )
        entry = self.existing(source_id, Kind.BILL, fingerprint, label)
        if entry is False:
            return
        if entry is None:
            if not tenancy_covers_month(tenancy, bill.billing_month):
                self.reject(f"{label}: {bill.billing_month:%Y-%m} is outside the tenancy's dates")
                return
            if (
                RentEntry.objects.active()
                .filter(tenancy=tenancy, billing_month=bill.billing_month)
                .exists()
            ):
                self.reject(
                    f"{label}: the tenancy already has a {bill.billing_month:%B %Y} bill that "
                    "wasn't imported from this source; remove one of them first"
                )
                return
            entry = RentEntry.objects.create(
                tenancy=tenancy,
                billing_month=bill.billing_month,
                rent_amount=bill.rent_amount,
                electricity_units=bill.electricity_units,
                electricity_rate=bill.electricity_rate,
                water_amount=bill.water_amount,
                notes=bill.notes,
                created_by=self.imported_by,
            )
            self.record(source_id, Kind.BILL, entry, fingerprint)
        self.entries[bill.source_id] = entry
        # Oldest first, so the receipts' "paid so far" follows the order they were paid in.
        for payment in bill.payments:
            self.import_payment(entry, bill, payment)

    def import_payment(self, entry: RentEntry, bill: LedgerBill, payment: LedgerPayment):
        label = f"payment {payment.source_id!r}"
        source_id = self.sid(payment.source_id)
        fingerprint = _fingerprint(
            {
                "bill": self.sid(bill.source_id),
                "amount": payment.amount,
                "paidDate": payment.paid_date,
                "notes": payment.notes,
            }
        )
        recorded = self.existing(source_id, Kind.PAYMENT, fingerprint, label)
        if recorded is False:
            return
        if recorded is None:
            key = uuid.uuid5(PAYMENT_KEY_NAMESPACE, source_id)
            if Payment.objects.filter(idempotency_key=key).exists():
                self.reject(f"{label}: a payment with its key exists, but no import record")
                return
            # Locked like record_payment does, so the sequence and the balance can't race an
            # app payment on the same bill. Payments recorded in the app since an earlier
            # import count towards the balance too.
            entry = RentEntry.objects.select_for_update().get(pk=entry.pk)
            if entry.status == RentEntry.Status.VOID:
                self.reject(f"{label}: its bill was voided in the app since it was imported")
                return
            outstanding = entry_amounts(entry).outstanding_amount
            if payment.amount > outstanding:
                self.reject(
                    f"{label}: {payment.amount} is more than the bill's outstanding {outstanding}"
                )
                return
            last = entry.payments.aggregate(last=Max("sequence"))["last"] or 0
            recorded = Payment.objects.create(
                entry=entry,
                # Oldest paid first (the ledger's order), so receipts total them in that order.
                sequence=last + 1,
                amount=payment.amount,
                paid_date=payment.paid_date,
                notes=payment.notes,
                idempotency_key=key,
                created_by=self.imported_by,
            )
            self.record(source_id, Kind.PAYMENT, recorded, fingerprint)
        if payment.receipt is not None:
            self.import_receipt(recorded, payment)

    def import_receipt(self, payment: Payment, source: LedgerPayment):
        receipt = source.receipt
        label = f"receipt {receipt.reference!r}"
        source_id = self.sid(source.source_id + RECEIPT_SUFFIX)
        fingerprint = _fingerprint(
            {
                "payment": self.sid(source.source_id),
                "reference": receipt.reference,
                "issuedDate": receipt.issued_date,
            }
        )
        found = self.existing(source_id, Kind.RECEIPT, fingerprint, label)
        if found is not None:
            return
        issued = Receipt.objects.filter(payment=payment).first()
        if issued is not None:
            self.reject(f"{label}: the payment already has receipt {issued.reference}")
            return
        # Read again, as when the app issues one: the tenancy is locked for the whole import,
        # and the property's lock numbers its references one at a time, so the app can't take
        # this one meanwhile and the receipt copies the details as they are now.
        entry = payment.entry
        tenancy = Tenancy.objects.get(pk=entry.tenancy_id)
        prop = Property.objects.select_for_update(no_key=True).get(pk=tenancy.property_id)
        if Receipt.objects.filter(property=prop, reference=receipt.reference).exists():
            self.reject(f"{label}: another receipt of this property already has this reference")
            return
        problem = receipt_problem(payment, tenancy, prop)
        if problem is not None:
            self.reject(f"{label}: {problem}")
            return
        created = Receipt.objects.create(
            property=prop,
            # The original reference, never a new one: it's the receipt already handed out.
            reference=receipt.reference,
            issued_by=self.imported_by,
            issued_at=datetime.combine(receipt.issued_date, time(), ZoneInfo(settings.TIME_ZONE)),
            issued_date=receipt.issued_date,
            **receipt_snapshot(
                payment,
                entry,
                tenancy,
                prop,
                self.imported_by,
                previous_outstanding=self.previous_outstanding(entry, receipt.issued_date),
            ),
        )
        self.record(source_id, Kind.RECEIPT, created, fingerprint)

    def previous_outstanding(self, entry: RentEntry, issued_date) -> Decimal:
        """What the previous month's bill still owed on the day the receipt was issued."""
        previous = (
            RentEntry.objects.active()
            .filter(tenancy=entry.tenancy, billing_month=_previous_month(entry.billing_month))
            .first()
        )
        if previous is None:
            return ZERO
        paid = previous.payments.effective().filter(paid_date__lte=issued_date).aggregate(
            total=Sum("amount")
        )["total"]
        return max(entry_amounts(previous, total_paid=paid or ZERO).outstanding_amount, ZERO)

    def reconcile(self):
        """Compares what the source holds with what the database now holds for it."""
        bills = [bill for _, bill in self.ledger.bills()]
        payment_ids = [self.sid(p.source_id) for bill in bills for p in bill.payments]
        receipt_ids = [
            self.sid(p.source_id + RECEIPT_SUFFIX)
            for bill in bills
            for p in bill.payments
            if p.receipt
        ]
        imported_payments = Payment.objects.filter(
            pk__in=LegacyRecord.objects.filter(
                source_id__in=payment_ids, kind=Kind.PAYMENT
            ).values("object_id")
        )
        # The database side counts every payment on these bills, not only the imported ones: a
        # payment recorded in the app since an earlier import may be the same money the source
        # lists, and a rerun mustn't add it again and still call the bill reconciled.
        amounts = {source_id: entry_amounts(entry) for source_id, entry in self.entries.items()}
        not_from_source = sorted(
            {
                source_id
                for source_id, entry in self.entries.items()
                if entry.payments.exclude(pk__in=imported_payments.values("pk")).exists()
            }
        )

        source_outstanding = {b.source_id: b.total_due - b.total_paid for b in bills}
        database_outstanding = {
            source_id: amount.total_due - amount.total_paid for source_id, amount in amounts.items()
        }
        mismatched = [
            source_id
            for source_id, amount in source_outstanding.items()
            if database_outstanding.get(source_id) != amount
        ]
        self.report.reconciliation = [
            ("bills", str(len(bills)), str(len(self.entries))),
            ("payments", str(len(payment_ids)), str(imported_payments.count())),
            (
                "receipts",
                str(len(receipt_ids)),
                str(LegacyRecord.objects.filter(source_id__in=receipt_ids).count()),
            ),
            (
                "bills with payments not from this source",
                "0",
                str(len(not_from_source))
                + (f" ({', '.join(not_from_source)})" if not_from_source else ""),
            ),
            (
                "total billed",
                str(sum((b.total_due for b in bills), ZERO)),
                str(sum((a.total_due for a in amounts.values()), ZERO)),
            ),
            (
                "total paid",
                str(sum((b.total_paid for b in bills), ZERO)),
                str(sum((a.total_paid for a in amounts.values()), ZERO)),
            ),
            (
                "bills whose outstanding differs",
                "0",
                str(len(mismatched)) + (f" ({', '.join(mismatched)})" if mismatched else ""),
            ),
        ]


def import_ledger(
    ledger: Ledger, mapping: dict, *, imported_by, dry_run: bool, property_id=None
) -> ImportReport:
    """Imports the ledger in one transaction, or nothing: see the module docstring. With
    property_id (admin's import, from one property's page), every mapped tenancy must belong
    to that property when the import runs."""
    importer = _Importer(ledger, mapping, imported_by, dry_run, property_id)
    with transaction.atomic():
        importer.run()
        if not importer.report.saved:
            transaction.set_rollback(True)
    return importer.report
