"""Converts the owners' Google Sheet, downloaded as .xlsx, into a legacy ledger file
(billing/legacy_ledger.py) for `manage.py import_legacy_ledger`. docs/data-import.md has the
steps; docs/google-sheets-integration.md describes the sheet.

One tab per tenant: details at the top, then a header row starting "Month" and one row per
month. Columns are found by their header label, since their positions differ between tabs.

What it takes, and what it leaves:
- Each month's own charges: rent, units × the tenant's electricity rate, water. Never Total Due
  or Overdue Amount, which add last month's balance (sometimes twice), so debts would be counted
  again. The app derives balances from bills and payments. They're only compared: Total Due
  less last month's Overdue Amount should be the month's own charges, and a tab where it isn't
  gets a warning, since its figures differ from what the owners saw.
- Total Paid and Paid Date as one payment, with the receipt the sheet's script emailed for it
  (RCP-<flat>-<yyyyMM>, issued on the paid date).
- Never Aadhaar numbers, phone numbers or the Email Log.

Anything it can't convert safely is a problem (with the tab and row) to fix in the sheet before
downloading it again. Anything it converted but is worth checking is a warning.
"""

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from billing.calculations import ZERO, calculate_electricity, calculate_total_due
from billing.legacy_ledger import FORMAT, VERSION

SOURCE = "google-sheet"
SKIPPED_TABS = {"readme", "template", "email log"}
PLACEHOLDER_NOTES = {"none", "nil", "n/a", "na", "-"}
TEXT_DATE_FORMATS = ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d", "%d/%m/%y")
# A payment this long after its month starts is unusual enough to check (swapped day and month?).
LATE_PAYMENT = timedelta(days=92)


@dataclass
class Conversion:
    ledger: dict
    problems: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    skipped_tabs: list[str] = field(default_factory=list)

    def totals(self) -> dict[str, str]:
        bills = [bill for tenant in self.ledger["tenants"] for bill in tenant["bills"]]
        payments = [payment for bill in bills for payment in bill["payments"]]
        return {
            "tenants": str(len(self.ledger["tenants"])),
            "bills": str(len(bills)),
            "payments": str(len(payments)),
            "receipts": str(sum(1 for payment in payments if "receipt" in payment)),
            "total billed": str(
                sum(
                    (
                        calculate_total_due(
                            Decimal(b["rentAmount"]),
                            Decimal(b["electricityUnits"]),
                            Decimal(b["electricityRate"]),
                            Decimal(b["waterAmount"]),
                        )
                        for b in bills
                    ),
                    ZERO,
                )
            ),
            "total paid": str(sum((Decimal(p["amount"]) for p in payments), ZERO)),
        }


def _label(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().rstrip(":").strip().lower()


def _blank(value) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _decimal(value, places: int) -> Decimal | None:
    """A cell's number to `places` decimals, or None if it isn't one (or has more places)."""
    if isinstance(value, bool):
        return None
    try:
        # str() of a float is its shortest exact form, so 0.1 stays 0.1.
        number = Decimal(str(value).strip().replace(",", ""))
    except InvalidOperation:
        return None
    if not number.is_finite():
        return None
    rounded = number.quantize(Decimal(1).scaleb(-places))
    return rounded if rounded == number else None


def _rounded(value) -> Decimal | None:
    """A formula's number to the paisa (they can carry float noise), or None if it isn't one."""
    if isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value).strip().replace(",", ""))
    except InvalidOperation:
        return None
    return number.quantize(Decimal("0.01"), ROUND_HALF_UP) if number.is_finite() else None


def _date(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        for text_format in TEXT_DATE_FORMATS:
            try:
                return datetime.strptime(value.strip(), text_format).date()
            except ValueError:
                continue
    return None


def _flat(value) -> str:
    """'202' for 202, 202.0 or ' 202.0 '."""
    number = _decimal(value, 0) if not isinstance(value, str) else None
    text = str(number) if number is not None else str(value or "").strip()
    return text[:-2] if text.endswith(".0") else text


def _notes(value) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return "" if text.lower() in PLACEHOLDER_NOTES else text[:500]


class _Tab:
    def __init__(self, sheet, conversion: Conversion, today: date):
        self.sheet = sheet
        self.name = sheet.title.strip()
        self.conversion = conversion
        self.today = today
        self.rows = [list(row) for row in sheet.iter_rows(values_only=True)]
        self.failed = False
        # (row, month, the Sheet's own charges, the ledger's) where they differ.
        self.mismatches: list[tuple[int, date, Decimal, Decimal]] = []

    def problem(self, row: int | None, message: str):
        self.failed = True
        where = f"{self.name!r}" + (f" row {row}" if row else "")
        self.conversion.problems.append(f"{where}: {message}")

    def warning(self, row: int | None, message: str):
        where = f"{self.name!r}" + (f" row {row}" if row else "")
        self.conversion.warnings.append(f"{where}: {message}")

    def header_row(self) -> int | None:
        for index, row in enumerate(self.rows):
            if row and _label(row[0]) == "month":
                return index
        return None

    def details(self, header: int) -> dict[str, object]:
        """The details above the header: each known label's value is the first filled cell to
        its right. Labels not listed here (Aadhaar above all) are never read."""
        wanted = {
            "name of tenant": "name",
            "rent amount": "rent",
            "flat number": "flat",
            "electricity per unit cost": "rate",
        }
        found = {}
        for row in self.rows[:header]:
            for column, cell in enumerate(row):
                key = wanted.get(_label(cell))
                if key and key not in found:
                    found[key] = next((v for v in row[column + 1 :] if not _blank(v)), None)
        return found

    def convert(self) -> dict | None:
        header = self.header_row()
        if header is None:
            self.conversion.skipped_tabs.append(self.name)
            return None
        details = self.details(header)
        rate = _decimal(details.get("rate"), 2)
        if rate is None or rate < 0:
            self.problem(None, "Electricity Per Unit Cost isn't a number with up to 2 decimals")
            rate = ZERO
        flat = _flat(details.get("flat"))
        if not flat:
            self.warning(None, "no Flat Number, so its receipts can't keep their references")

        columns = {_label(name): index for index, name in enumerate(self.rows[header])}
        for required in ("rent amount", "units used", "total paid", "paid date"):
            if required not in columns:
                self.problem(header + 1, f"no {required.title()!r} column")
        if self.failed:
            return None

        bills, months = [], set()
        for index in range(header + 1, len(self.rows)):
            bill = self.convert_row(index + 1, self.rows[index], columns, rate, flat, months)
            if bill:
                bills.append(bill)
                previous = self.rows[index - 1] if index - 1 > header else None
                self.compare_with_sheet(index + 1, self.rows[index], previous, columns, bill)
        self.report_mismatches()
        name = str(details.get("name") or "").strip()
        return {"sourceId": self.name, "name": name, "bills": bills}

    def convert_row(self, number, row, columns, rate, flat, months) -> dict | None:
        def cell(label):
            column = columns.get(label)
            return row[column] if column is not None and column < len(row) else None

        if _blank(row[0] if row else None):
            return None
        month = _date(row[0])
        if month is None:
            self.problem(number, f"Month {row[0]!r} isn't a date")
            return None
        month = month.replace(day=1)
        if month > self.today.replace(day=1):
            self.warning(number, f"{month:%B %Y} is in the future; left out")
            return None
        if _blank(cell("units used")) and _blank(cell("total paid")):
            self.warning(number, f"{month:%B %Y} has no units or payment yet; left out")
            return None
        if month in months:
            self.problem(number, f"{month:%B %Y} appears twice")
            return None
        months.add(month)

        rent = _decimal(cell("rent amount"), 2)
        if rent is None or rent <= 0:
            self.problem(number, f"Rent Amount {cell('rent amount')!r} isn't more than 0")
            return None
        units = ZERO if _blank(cell("units used")) else _decimal(cell("units used"), 3)
        if units is None or units < 0:
            self.problem(number, f"Units Used {cell('units used')!r} isn't a number of units")
            return None
        if _blank(cell("units used")):
            self.warning(number, f"{month:%B %Y} has a payment but no units; imported as 0 units")
        water = ZERO if _blank(cell("water bill")) else _decimal(cell("water bill"), 2)
        if water is None or water < 0:
            self.problem(number, f"Water Bill {cell('water bill')!r} isn't an amount")
            return None

        bill_rate = rate
        charge = _decimal(cell("electricity charge"), 2)
        if charge is not None and units > 0 and charge != calculate_electricity(units, rate):
            # Typed over: keep the row's charge if a 2-decimal rate gives exactly it.
            derived = (charge / units).quantize(Decimal("0.01"))
            if calculate_electricity(units, derived) == charge:
                bill_rate = derived
                self.warning(number, f"electricity charged at {derived}/unit, not {rate}")
            else:
                self.problem(
                    number, f"Electricity Charge {charge} isn't Units Used × a rate; correct it"
                )
                return None

        bill_id = f"{self.name}/{month:%Y-%m}"
        bill = {
            "sourceId": bill_id,
            "billingMonth": f"{month:%Y-%m}",
            "rentAmount": str(rent),
            "electricityUnits": str(units),
            "electricityRate": str(bill_rate),
            "waterAmount": str(water),
            "notes": _notes(cell("notes")),
            "payments": [],
        }
        payment = self.convert_payment(number, month, cell, bill, flat)
        if payment is False:
            return None
        if payment:
            bill["payments"].append(payment)
        return bill

    def compare_with_sheet(self, number, row, previous, columns, bill):
        """Notes the month if the Sheet's Total Due, less last month's Overdue Amount (what it
        carried forward), isn't the bill's own charges. Rows without those figures are skipped."""
        due_column, overdue_column = columns.get("total due"), columns.get("overdue amount")
        if due_column is None or overdue_column is None or due_column >= len(row):
            return
        sheet_due = _rounded(row[due_column])
        carried = previous[overdue_column] if previous and overdue_column < len(previous) else None
        carried = ZERO if _blank(carried) else _rounded(carried)
        if sheet_due is None or carried is None:
            return
        own = calculate_total_due(
            Decimal(bill["rentAmount"]),
            Decimal(bill["electricityUnits"]),
            Decimal(bill["electricityRate"]),
            Decimal(bill["waterAmount"]),
        )
        if sheet_due - carried != own:
            month = date.fromisoformat(f"{bill['billingMonth']}-01")
            self.mismatches.append((number, month, sheet_due - carried, own))

    def report_mismatches(self):
        if not self.mismatches:
            return
        number, month, sheet, own = self.mismatches[0]
        rows = ", ".join(str(row) for row, *_ in self.mismatches)
        self.warning(
            None,
            f"{len(self.mismatches)} month(s) where Total Due, less last month's Overdue "
            f"Amount, isn't the month's own charges (rows {rows}); e.g. {month:%B %Y} shows "
            f"{sheet}, the ledger bills {own}. The ledger's figures are what's imported: check "
            "them against the Sheet",
        )

    def convert_payment(self, number, month, cell, bill, flat) -> dict | None | bool:
        """The month's payment, None if there's none, or False after a problem."""
        paid_cell, date_cell = cell("total paid"), cell("paid date")
        paid = ZERO if _blank(paid_cell) else _decimal(paid_cell, 2)
        if paid is None or paid < 0:
            self.problem(number, f"Total Paid {paid_cell!r} isn't an amount")
            return False
        if paid == 0:
            if not _blank(date_cell):
                self.warning(number, f"{month:%B %Y} has a Paid Date but nothing paid; ignored")
            return None
        paid_date = _date(date_cell)
        if paid_date is None:
            self.problem(number, f"{paid} paid, but Paid Date {date_cell!r} isn't a date")
            return False
        if paid_date > self.today:
            self.problem(number, f"Paid Date {paid_date} is in the future")
            return False
        if paid_date < month or paid_date - month > LATE_PAYMENT:
            self.warning(
                number,
                f"{month:%B %Y} paid on {paid_date:%d %b %Y}; check the day and month "
                "aren't swapped",
            )
        due = calculate_total_due(
            Decimal(bill["rentAmount"]),
            Decimal(bill["electricityUnits"]),
            Decimal(bill["electricityRate"]),
            Decimal(bill["waterAmount"]),
        )
        if paid > due:
            self.problem(
                number,
                f"{paid} paid but {month:%B %Y}'s own charges are {due}. The app keeps each "
                "payment on its month's bill: move the part that paid other months to those "
                "months' Total Paid",
            )
            return False
        payment = {
            "sourceId": f"{bill['sourceId']}/payment",
            "amount": str(paid),
            "paidDate": paid_date.isoformat(),
            "notes": "",
        }
        if flat:
            payment["receipt"] = {
                "reference": f"RCP-{flat}-{month:%Y%m}",
                "issuedDate": paid_date.isoformat(),
            }
        return payment


def convert_workbook(workbook, *, today: date) -> Conversion:
    """The ledger in a workbook loaded with openpyxl (data_only=True, for formulas' values)."""
    conversion = Conversion(
        ledger={"format": FORMAT, "version": VERSION, "source": SOURCE, "tenants": []}
    )
    for sheet in workbook.worksheets:
        if _label(sheet.title) in SKIPPED_TABS:
            conversion.skipped_tabs.append(sheet.title)
            continue
        tenant = _Tab(sheet, conversion, today).convert()
        if tenant is not None:
            conversion.ledger["tenants"].append(tenant)
    return conversion
