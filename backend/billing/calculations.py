"""How a bill's figures are worked out. Decimal throughout, never float.

The rule: round electricity to paise, then add it to rent and water. The app's preview
(src/utils/rentCalculations.ts) follows the same rule, but these results are the ones saved
and shown.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

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
    total_due: Decimal
    total_paid: Decimal
    outstanding_amount: Decimal
    payment_status: str


def entry_amounts(entry, total_paid: Decimal = ZERO) -> EntryAmounts:
    """Everything derived for one bill, from its stored historical charges.

    Payments arrive in BE Phase 5; until then nothing has been paid against any bill.
    """
    total_due = calculate_total_due(
        entry.rent_amount, entry.electricity_units, entry.electricity_rate, entry.water_amount
    )
    return EntryAmounts(
        electricity_amount=calculate_electricity(entry.electricity_units, entry.electricity_rate),
        total_due=total_due,
        total_paid=to_paise(total_paid),
        outstanding_amount=calculate_outstanding(total_due, total_paid),
        payment_status=payment_status(total_due, total_paid),
    )
