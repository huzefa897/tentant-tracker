"""Fills a local database with fictional data so the app has something to show.

    pipenv run python manage.py seed_dev_data --email you@gmail.com

Two properties, ~14 tenancies (current, ended and upcoming; some with a meter, some typed
units), a year of bills, and payments and receipts that leave a realistic mix of paid, part
paid and overdue. Everything goes through the same services as the API, so every rule holds.
Safe to run again: whatever already exists is skipped, and keys are derived from the data, so
a rerun never double-records a payment.

Development only (DJANGO_DEBUG=True). The names and numbers are fictional: never message them.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Sum
from django.utils import timezone

from accounts.models import User
from billing.calculations import calculate_total_due
from billing.models import Payment, RentEntry, month_end
from billing.services import create_rent_entry, issue_payment_receipt, record_payment
from properties.models import (
    PaymentTiming,
    Property,
    PropertyMembership,
    Tenancy,
    business_date,
)

SEED_NAMESPACE = uuid.UUID("5eed5eed-5eed-5eed-5eed-5eed5eed5eed")

PROPERTIES = (
    {
        "name": "Demo Towers",
        "address": "12 Sample Road, Test Nagar, Hyderabad 500001",
        "contact_number": "+919000000001",
        "payment_timing": PaymentTiming.POSTPAID,
    },
    {
        "name": "Sample Residency",
        "address": "7 Example Lane, Dummy Colony, Hyderabad 500002",
        "contact_number": "+919000000002",
        "payment_timing": PaymentTiming.PREPAID,
    },
)

# How a tenancy's bills end up, newest last:
PAID = "paid"  # every bill paid in full, each with a receipt
OVERDUE = "overdue"  # paid up to two months ago; the last two bills unpaid
PARTIAL = "partial"  # paid up to last month; the latest bill part paid
CURRENT = "current"  # all paid, plus this month's bill, unpaid
NONE = "none"  # no bills (an upcoming tenancy)


@dataclass(frozen=True)
class Seed:
    prop: int  # index into PROPERTIES
    name: str
    flat: str
    rent: int
    due_day: int
    rate: int  # electricity, per unit
    months_ago: int  # tenancy starts on the 1st, this many months ago (negative: upcoming)
    ended_months_ago: int | None = None  # ends on the last day of that month
    meter: bool = False  # electricity from meter readings instead of typed units
    outcome: str = PAID


TENANCIES = (
    Seed(0, "Arjun Verma", "101", 12000, 5, 7, 11, meter=True, outcome=PAID),
    Seed(0, "Sana Qureshi", "102", 14000, 10, 7, 9, outcome=OVERDUE),
    Seed(0, "Rahul Menon", "201", 16500, 5, 8, 8, meter=True, outcome=PARTIAL),
    Seed(0, "Fatima Sheikh", "202", 15000, 11, 8, 6, outcome=CURRENT),
    Seed(0, "Vikram Rao", "301", 18000, 10, 8, 12, meter=True, outcome=OVERDUE),
    Seed(0, "Priya Nair", "302", 17500, 1, 8, 4, outcome=PAID),
    Seed(0, "Imran Khan", "103", 11000, 5, 7, 14, 3, outcome=PAID),  # moved out
    Seed(0, "Neha Kapoor", "203", 15500, 5, 8, -1, outcome=NONE),  # starts next month
    Seed(1, "Karthik Reddy", "1A", 9000, 1, 6, 10, outcome=PAID),
    Seed(1, "Ayesha Siddiqui", "1B", 9500, 1, 6, 7, meter=True, outcome=CURRENT),
    Seed(1, "Rohan Das", "2A", 10500, 3, 6, 5, outcome=PARTIAL),
    Seed(1, "Meera Iyer", "2B", 10000, 3, 6, 3, outcome=OVERDUE),
    Seed(1, "Salman Pasha", "3A", 12500, 3, 7, 13, 6, meter=True, outcome=PAID),  # moved out
    Seed(1, "Divya Joshi", "3B", 11500, 3, 7, 2, outcome=PAID),
)

WATER = (Decimal("0"), Decimal("200"), Decimal("250"))


def add_months(day: date, months: int) -> date:
    index = day.year * 12 + day.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


def key(*parts) -> uuid.UUID:
    return uuid.uuid5(SEED_NAMESPACE, ":".join(str(part) for part in parts))


class Command(BaseCommand):
    help = "Fill a local database with fictional properties, tenancies, bills, payments and receipts."

    def add_arguments(self, parser):
        parser.add_argument(
            "--email",
            required=True,
            help="Your Google account's email: made an owner of both properties (and an admin, if "
            "this creates the person) "
            "so you can sign in and see the data.",
        )
        parser.add_argument(
            "--password",
            help="Optional, for a person this command creates: their password for /admin/. "
            "Ignored for an existing person, whose password and permissions stay as they are.",
        )

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Development only: set DJANGO_DEBUG=True.")

        self.today = business_date()
        owner = self._owner(options["email"], options.get("password"))
        manager = self._person("dev-manager@example.test", "Dev Manager", "+919000000090")

        properties = []
        for fields in PROPERTIES:
            prop, _ = Property.objects.get_or_create(name=fields["name"], defaults=fields)
            for person, role in (
                (owner, PropertyMembership.Role.OWNER),
                (manager, PropertyMembership.Role.MANAGER),
            ):
                # The seed's own properties: a membership ended or changed since the last run is
                # put back, so "both properties are yours" stays true.
                PropertyMembership.objects.update_or_create(
                    user=person,
                    property=prop,
                    defaults={"role": role, "is_active": True},
                    create_defaults={"role": role, "is_active": True, "granted_by": owner},
                )
            properties.append(prop)

        bills = payments = receipts = 0
        for number, seed in enumerate(TENANCIES, start=1):
            tenancy = self._tenancy(properties[seed.prop], seed, number)
            counts = self._bills(tenancy, seed, owner)
            bills, payments, receipts = (a + b for a, b in zip((bills, payments, receipts), counts))

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {len(PROPERTIES)} properties, {len(TENANCIES)} tenancies; "
                f"added {bills} bills, {payments} payments, {receipts} receipts."
            )
        )
        self.stdout.write(f"Sign in with {owner.email}; both properties are yours.")

    def _person(self, email: str, name: str, phone: str = "") -> User:
        person, created = User.objects.get_or_create(
            email=email,
            defaults={"username": email, "name": name, "phone_number": phone},
        )
        if created:
            person.set_unusable_password()
            person.save()
        return person

    def _owner(self, email: str, password: str | None) -> User:
        email = email.strip().lower()
        owner = User.objects.filter(email__iexact=email).first()
        if owner is not None:
            # An existing person (real data, say) keeps their permissions and password, and just
            # gets owner memberships of the seeded properties.
            if password:
                self.stderr.write(
                    f"Ignored --password: {email} already exists, so their password is unchanged."
                )
            return owner

        owner = User(username=email, email=email, name="Dev Owner")
        owner.is_staff = owner.is_superuser = True
        if password:
            owner.set_password(password)
        else:
            owner.set_unusable_password()
        owner.save()
        return owner

    def _tenancy(self, prop: Property, seed: Seed, number: int) -> Tenancy:
        existing = Tenancy.objects.filter(property=prop, flat_number=seed.flat, name=seed.name)
        if existing.exists():
            return existing.get()

        start = add_months(self.today.replace(day=1), -seed.months_ago)
        fields = {
            "property": prop,
            "name": seed.name,
            "flat_number": seed.flat,
            "mobile_number": f"+9190000{number:05d}",
            "rent_amount": Decimal(seed.rent),
            "rent_due_day": seed.due_day,
            "electricity_rate": Decimal(seed.rate),
            "deposit_amount": Decimal(seed.rent * 6),
            "start_date": start,
            "end_date": (
                month_end(add_months(self.today.replace(day=1), -seed.ended_months_ago))
                if seed.ended_months_ago is not None
                else None
            ),
        }
        if seed.meter:
            fields["meter_baseline_reading"] = Decimal(100 + number * 40)
            # The day the meter starts: the tenancy's first day.
            fields["meter_baseline_recorded_at"] = timezone.make_aware(
                datetime.combine(start, time(12, 0))
            )
        tenancy = Tenancy(**fields)
        tenancy.full_clean()
        tenancy.save()
        return tenancy

    def _months(self, tenancy: Tenancy, seed: Seed) -> list[date]:
        """The months to bill: from the tenancy's first up to last month (this month too for
        CURRENT), or up to the month it ended."""
        if seed.outcome == NONE:
            return []
        last = add_months(self.today.replace(day=1), 0 if seed.outcome == CURRENT else -1)
        if tenancy.end_date is not None:
            last = min(last, tenancy.end_date.replace(day=1))
        months, month = [], tenancy.start_date.replace(day=1)
        while month <= last:
            months.append(month)
            month = add_months(month, 1)
        return months

    def _bills(self, tenancy: Tenancy, seed: Seed, owner: User) -> tuple[int, int, int]:
        months = self._months(tenancy, seed)
        # Months at the end that stay unpaid or part paid.
        unpaid = {OVERDUE: 2, CURRENT: 1, PARTIAL: 1}.get(seed.outcome, 0)
        reading = tenancy.meter_baseline_reading
        bills = payments = receipts = 0

        for index, month in enumerate(months):
            data = {"billing_month": month, "water_amount": WATER[index % len(WATER)]}
            if seed.meter:
                reading += Decimal(60 + (index * 37) % 90)
                data["closing_reading"] = {
                    "reading": reading,
                    "read_on": min(month_end(month), tenancy.end_date or self.today, self.today),
                }
                units = None
            else:
                units = Decimal(80 + (index * 29) % 120)
                data["electricity_units"] = units

            if RentEntry.objects.active().filter(tenancy=tenancy, billing_month=month).exists():
                entry = RentEntry.objects.active().get(tenancy=tenancy, billing_month=month)
                # A meter bill continues from its closing reading; any other kind (say, recreated
                # by hand with electricity left off) leaves the running reading as it is.
                if entry.closing_reading_id is not None:
                    reading = entry.closing_reading.reading
            else:
                entry = create_rent_entry(
                    tenancy=tenancy,
                    actor=owner,
                    validated_data=data,
                    creation_key=key("bill", tenancy.pk, month),
                ).entry
                bills += 1

            units = entry.electricity_units
            total = calculate_total_due(
                entry.rent_amount, units, entry.electricity_rate, entry.water_amount
            )
            paid = Payment.objects.filter(entry=entry).effective().aggregate(
                total=Sum("amount")
            )["total"] or Decimal("0")
            from_end = len(months) - index  # 1 for the newest bill
            if from_end <= unpaid:
                # Unpaid, or for PARTIAL half paid; a rerun leaves it as it is.
                if seed.outcome != PARTIAL or paid:
                    continue
                target = (total / 2).quantize(Decimal("0.01"))
            else:
                # Settled in full: a bill part paid on an earlier run (it was the newest then)
                # gets the rest now.
                target = total

            if paid < target:
                paid_date = min(month + timedelta(days=seed.due_day + 2), self.today)
                if tenancy.end_date is not None:
                    paid_date = min(paid_date, tenancy.end_date)
                record_payment(
                    entry_id=entry.pk,
                    actor=owner,
                    # One key per payment: the first, then the top-up on a later run.
                    idempotency_key=key("payment", entry.pk, *(["rest"] if paid else [])),
                    validated_data={"amount": target - paid, "paid_date": paid_date, "notes": ""},
                )
                payments += 1

            if target == total:
                for payment in Payment.objects.filter(entry=entry, receipt__isnull=True).effective():
                    issue_payment_receipt(payment_id=payment.pk, actor=owner)
                    receipts += 1

        return bills, payments, receipts
