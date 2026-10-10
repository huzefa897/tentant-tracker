"""How a bill's figures are worked out. Decimal throughout, never float.

The rule: round electricity to paise, then add it to rent and water. The app's preview
(src/utils/rentCalculations.ts) follows the same rule, but these results are the ones saved
and shown.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Sum

PAISE = Decimal("0.01")
ZERO = Decimal("0.00")


class PaymentStatus:
    UNPAID = "unpaid"
    PARTIALLY_PAID = "partially_paid"
    PAID = "paid"


def to_paise(amount: Decimal) -> Decimal:
    return amount.quantize(PAISE, rounding=ROUND_HALF_UP)


def calculate_electricity(units: Decimal, rate: Decimal) -> Decimal:
    return to_paise(units * rate)


def calculate_total_due(rent: Decimal, units: Decimal, rate: Decimal, water: Decimal) -> Decimal:
    return to_paise(rent + calculate_electricity(units, rate) + water)


def calculate_outstanding(total_due: Decimal, total_paid: Decimal) -> Decimal:
    return to_paise(total_due - total_paid)


def payment_status(total_due: Decimal, total_paid: Decimal) -> str:
    if calculate_outstanding(total_due, total_paid) <= 0:
        return PaymentStatus.PAID
    if total_paid == 0:
        return PaymentStatus.UNPAID
    return PaymentStatus.PARTIALLY_PAID


@dataclass(frozen=True)
class EntryAmounts:
    electricity_amount: Decimal
    # A void bill's charges, kept as history: it owes nothing.
    total_due: Decimal
    total_paid: Decimal
    # Zero for a void bill.
    outstanding_amount: Decimal
    # None for a void bill: it isn't paid or unpaid, it doesn't count.
    payment_status: str | None


def total_paid_for(entry) -> Decimal:
    """The sum of the bill's effective payments (reversed ones don't count): from the
    queryset's `paid_total` annotation (RentEntry.objects.with_amounts()) when present,
    otherwise one aggregate query."""
    paid = getattr(entry, "paid_total", None)
    if paid is None:
        paid = entry.payments.effective().aggregate(total=Sum("amount"))["total"]
    return to_paise(paid or ZERO)


def entry_amounts(entry, total_paid: Decimal | None = None) -> EntryAmounts:
    """Everything derived for one bill, from its stored historical charges and its effective
    payments (summed by total_paid_for unless given). A void bill keeps its total due, to show,
    but owes nothing and has no payment status. Totals across bills leave void ones out."""
    if total_paid is None:
        total_paid = total_paid_for(entry)
    total_due = calculate_total_due(
        entry.rent_amount, entry.electricity_units, entry.electricity_rate, entry.water_amount
    )
    void = entry.status == "void"
    return EntryAmounts(
        electricity_amount=calculate_electricity(entry.electricity_units, entry.electricity_rate),
        total_due=total_due,
        total_paid=to_paise(total_paid),
        outstanding_amount=ZERO if void else calculate_outstanding(total_due, total_paid),
        payment_status=None if void else payment_status(total_due, total_paid),
    )
