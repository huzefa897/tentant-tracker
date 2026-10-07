"""The legacy ledger file: bills, payments and receipts from an old system, ready to import
(billing/legacy_import.py, `manage.py import_legacy_ledger`). docs/data-import.md describes it.

    {
      "format": "rent-tracker-ledger",
      "version": 1,
      "source": "google-sheet",
      "tenants": [{
        "sourceId": "Tenant A",
        "name": "Tenant A",
        "bills": [{
          "sourceId": "Tenant A/2026-08",
          "billingMonth": "2026-08",
          "rentAmount": "15000.00",
          "electricityUnits": "75.000",
          "electricityRate": "6.00",
          "waterAmount": "300.00",
          "notes": "",
          "payments": [{
            "sourceId": "Tenant A/2026-08/payment",
            "amount": "15750.00",
            "paidDate": "2026-08-16",
            "notes": "",
            "receipt": {"reference": "RCP-202-202608", "issuedDate": "2026-08-16"}
          }]
        }]
      }]
    }

Money and units are strings, so nothing passes through floating point. Parsing checks the whole
file and reports every problem at once; nothing touches the database.
"""

import re
import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation

from billing.calculations import ZERO, calculate_total_due

FORMAT = "rent-tracker-ledger"
VERSION = 1
NOTES_MAX_LENGTH = 500
# LegacyRecord.source_id holds "<source>:<id>"; receipts add RECEIPT_SUFFIX.
SOURCE_ID_MAX_LENGTH = 200
RECEIPT_SUFFIX = "#receipt"
MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class LedgerError(Exception):
    def __init__(self, problems: list[str]):
        super().__init__(f"{len(problems)} problem(s) in the ledger")
        self.problems = problems


@dataclass(frozen=True)
class LedgerReceipt:
    reference: str
    issued_date: date


@dataclass(frozen=True)
class LedgerPayment:
    source_id: str
    amount: Decimal
    paid_date: date
    notes: str
    receipt: LedgerReceipt | None


@dataclass(frozen=True)
class LedgerBill:
    source_id: str
    billing_month: date
    rent_amount: Decimal
    electricity_units: Decimal
    electricity_rate: Decimal
    water_amount: Decimal
    notes: str
    payments: tuple[LedgerPayment, ...]

    @property
    def total_due(self) -> Decimal:
        return calculate_total_due(
            self.rent_amount, self.electricity_units, self.electricity_rate, self.water_amount
        )

    @property
    def total_paid(self) -> Decimal:
        return sum((payment.amount for payment in self.payments), ZERO)


@dataclass(frozen=True)
class LedgerTenant:
    source_id: str
    name: str
    bills: tuple[LedgerBill, ...]


@dataclass(frozen=True)
class Ledger:
    source: str
    tenants: tuple[LedgerTenant, ...]

    def bills(self):
        for tenant in self.tenants:
            for bill in tenant.bills:
                yield tenant, bill


class _Reader:
    """Reads values out of the JSON, noting each problem with where it is."""

    def __init__(self):
        self.problems: list[str] = []

    def problem(self, where: str, message: str):
        self.problems.append(f"{where}: {message}")

    def text(self, data: dict, key: str, where: str, *, required=True, max_length=None) -> str:
        value = data.get(key, "" if not required else None)
        if not isinstance(value, str):
            self.problem(where, f"{key} must be text")
            return ""
        value = value.strip()
        if required and not value:
            self.problem(where, f"{key} is empty")
        if max_length is not None and len(value) > max_length:
            self.problem(where, f"{key} is longer than {max_length} characters")
        return value

    def decimal(
        self, data: dict, key: str, where: str, *, places: int, digits: int, positive=False
    ) -> Decimal:
        value = data.get(key)
        # Strings only: a JSON number may already have been rounded by whatever wrote it.
        if not isinstance(value, str):
            self.problem(where, f'{key} must be a decimal in quotes, e.g. "1500.00"')
            return ZERO
        try:
            number = Decimal(value.strip())
        except InvalidOperation:
            self.problem(where, f"{key} {value!r} isn't a number")
            return ZERO
        if not number.is_finite():
            self.problem(where, f"{key} {value!r} isn't a number")
            return ZERO
        if -number.as_tuple().exponent > places:
            self.problem(where, f"{key} {value} has more than {places} decimal places")
        if number.quantize(Decimal(1).scaleb(-places)).adjusted() >= digits - places:
            self.problem(where, f"{key} {value} is too large")
        if positive and number <= 0:
            self.problem(where, f"{key} must be more than 0")
        elif number < 0:
            self.problem(where, f"{key} can't be negative")
        return number.quantize(Decimal(1).scaleb(-places))

    def day(self, data: dict, key: str, where: str) -> date | None:
        value = data.get(key)
        if isinstance(value, str) and DAY.match(value):
            try:
                return date.fromisoformat(value)
            except ValueError:
                pass
        self.problem(where, f"{key} {value!r} isn't a date like 2026-08-16")
        return None

    def items(self, data: dict, key: str, where: str, *, required=True) -> list:
        value = data.get(key, None if required else [])
        if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
            self.problem(where, f"{key} must be a list of objects")
            return []
        return value


def parse_ledger(data, *, today: date) -> Ledger:
    """The ledger in `data` (parsed JSON), or LedgerError listing every problem in it. Paid and
    issued dates may not be after `today` (the property's date)."""
    reader = _Reader()
    if not isinstance(data, dict):
        raise LedgerError(["The file must hold one JSON object"])
    if data.get("format") != FORMAT or data.get("version") != VERSION:
        raise LedgerError([f'Not a ledger file: expected "format": "{FORMAT}", "version": 1'])
    source = reader.text(data, "source", "file", max_length=40)
    if source and not re.fullmatch(r"[a-z0-9-]+", source):
        reader.problem("file", "source must be lowercase letters, digits and hyphens")

    seen_ids: set[str] = set()
    seen_references: set[str] = set()

    def source_id(item: dict, where: str) -> str:
        value = reader.text(item, "sourceId", where, max_length=SOURCE_ID_MAX_LENGTH)
        if value in seen_ids:
            reader.problem(where, f"sourceId {value!r} is used more than once")
        seen_ids.add(value)
        return value

    def parse_receipt(payment_data: dict, where: str, paid_date) -> LedgerReceipt | None:
        receipt_data = payment_data.get("receipt")
        if receipt_data is None:
            return None
        if not isinstance(receipt_data, dict):
            reader.problem(where, "receipt must be an object")
            return None
        reference = reader.text(receipt_data, "reference", where, max_length=50)
        if reference in seen_references:
            reader.problem(where, f"receipt {reference!r} is used more than once")
        seen_references.add(reference)
        issued = reader.day(receipt_data, "issuedDate", where)
        if issued is None:
            return None
        if issued > today:
            reader.problem(where, f"receipt issuedDate {issued} is in the future")
        if paid_date and issued < paid_date:
            reader.problem(where, "the receipt was issued before the payment")
        return LedgerReceipt(reference=reference, issued_date=issued)

    def parse_payment(payment_data: dict, where: str) -> LedgerPayment:
        payment_id = source_id(payment_data, where)
        where = f"payment {payment_id!r}"
        paid_date = reader.day(payment_data, "paidDate", where)
        if paid_date and paid_date > today:
            reader.problem(where, f"paidDate {paid_date} is in the future")
        return LedgerPayment(
            source_id=payment_id,
            amount=reader.decimal(
                payment_data, "amount", where, places=2, digits=10, positive=True
            ),
            paid_date=paid_date or today,
            notes=reader.text(
                payment_data, "notes", where, required=False, max_length=NOTES_MAX_LENGTH
            ),
            receipt=parse_receipt(payment_data, where, paid_date),
        )

    def parse_bill(bill_data: dict, where: str, months: set) -> LedgerBill:
        bill_id = source_id(bill_data, where)
        where = f"bill {bill_id!r}"
        month_text = bill_data.get("billingMonth")
        billing_month = None
        if isinstance(month_text, str) and MONTH.match(month_text):
            billing_month = date.fromisoformat(f"{month_text}-01")
            if billing_month in months:
                reader.problem(where, f"{month_text} appears twice for this tenant")
            months.add(billing_month)
        else:
            reader.problem(where, "billingMonth must be a month like 2026-08")

        payments = [
            parse_payment(payment_data, f"{where} payment {number}")
            for number, payment_data in enumerate(
                reader.items(bill_data, "payments", where, required=False), start=1
            )
        ]
        bill = LedgerBill(
            source_id=bill_id,
            billing_month=billing_month or today.replace(day=1),
            rent_amount=reader.decimal(
                bill_data, "rentAmount", where, places=2, digits=10, positive=True
            ),
            electricity_units=reader.decimal(
                bill_data, "electricityUnits", where, places=3, digits=10
            ),
            electricity_rate=reader.decimal(
                bill_data, "electricityRate", where, places=2, digits=8
            ),
            water_amount=reader.decimal(bill_data, "waterAmount", where, places=2, digits=10),
            notes=reader.text(
                bill_data, "notes", where, required=False, max_length=NOTES_MAX_LENGTH
            ),
            payments=tuple(sorted(payments, key=lambda payment: payment.paid_date)),
        )
        # The app keeps each payment on its own bill: they can't add up to more than it.
        if bill.total_paid > bill.total_due:
            reader.problem(
                where,
                f"payments total {bill.total_paid} but the bill is {bill.total_due}; split "
                "payments that covered other months onto those months' bills",
            )
        return bill

    tenants = []
    for number, tenant_data in enumerate(reader.items(data, "tenants", "file"), start=1):
        tenant_id = source_id(tenant_data, f"tenant {number}")
        where = f"tenant {tenant_id!r}"
        months: set[date] = set()
        bills = [
            parse_bill(bill_data, f"{where} bill {b}", months)
            for b, bill_data in enumerate(reader.items(tenant_data, "bills", where), start=1)
        ]
        tenants.append(
            LedgerTenant(
                source_id=tenant_id,
                name=reader.text(tenant_data, "name", where, required=False, max_length=150),
                bills=tuple(bills),
            )
        )

    if reader.problems:
        raise LedgerError(reader.problems)
    return Ledger(source=source, tenants=tuple(tenants))


def parse_mapping(data) -> dict[str, uuid.UUID]:
    """The mapping file: each ledger tenant's sourceId → the tenancy's id in this database."""
    if not isinstance(data, dict):
        raise LedgerError(
            ['The mapping file must be one JSON object: {"<tenant sourceId>": "<tenancy id>"}']
        )
    mapping, problems = {}, []
    for tenant_id, tenancy_id in data.items():
        try:
            mapping[tenant_id] = uuid.UUID(str(tenancy_id))
        except ValueError:
            problems.append(f"mapping {tenant_id!r}: {tenancy_id!r} isn't a tenancy id")
    if problems:
        raise LedgerError(problems)
    return mapping
