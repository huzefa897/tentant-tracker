from decimal import Decimal
from types import SimpleNamespace

from django.test import SimpleTestCase

from billing.calculations import (
    calculate_electricity,
    calculate_outstanding,
    calculate_total_due,
    entry_amounts,
    payment_status,
)

D = Decimal


class CalculationTests(SimpleTestCase):
    def test_electricity_is_units_times_rate(self):
        self.assertEqual(calculate_electricity(D("75.000"), D("6.00")), D("450.00"))

    def test_electricity_rounds_to_paise(self):
        self.assertEqual(calculate_electricity(D("1.125"), D("6.00")), D("6.75"))
        # Half a paisa rounds up, never to even: 0.025 → 0.03 and 0.225 → 0.23.
        self.assertEqual(calculate_electricity(D("0.125"), D("0.20")), D("0.03"))
        self.assertEqual(calculate_electricity(D("1.125"), D("0.20")), D("0.23"))
        self.assertEqual(calculate_electricity(D("0.124"), D("0.20")), D("0.02"))
        self.assertEqual(calculate_electricity(D("0.001"), D("4.99")), D("0.00"))

    def test_total_due_adds_rent_rounded_electricity_and_water(self):
        self.assertEqual(
            calculate_total_due(D("15000.00"), D("75.000"), D("6.00"), D("300.00")),
            D("15750.00"),
        )
        # Electricity is rounded to paise before it's added: 0.125 × 0.20 = 0.025 → 0.03.
        self.assertEqual(
            calculate_total_due(D("100.00"), D("0.125"), D("0.20"), D("0.50")), D("100.53")
        )

    def test_zero_consumption_and_water(self):
        self.assertEqual(calculate_total_due(D("8000"), D("0"), D("6"), D("0")), D("8000.00"))

    def test_outstanding_and_status(self):
        self.assertEqual(calculate_outstanding(D("15750.00"), D("0.00")), D("15750.00"))
        self.assertEqual(payment_status(D("15750.00"), D("0.00")), "unpaid")
        self.assertEqual(payment_status(D("15750.00"), D("750.00")), "partially_paid")
        self.assertEqual(payment_status(D("15750.00"), D("15750.00")), "paid")

    def test_entry_amounts_for_an_unpaid_bill(self):
        entry = SimpleNamespace(
            rent_amount=D("15000.00"),
            electricity_units=D("75.000"),
            electricity_rate=D("6.00"),
            water_amount=D("300.00"),
        )

        amounts = entry_amounts(entry)

        self.assertEqual(amounts.electricity_amount, D("450.00"))
        self.assertEqual(amounts.total_due, D("15750.00"))
        self.assertEqual(amounts.total_paid, D("0.00"))
        self.assertEqual(amounts.outstanding_amount, D("15750.00"))
        self.assertEqual(amounts.payment_status, "unpaid")
