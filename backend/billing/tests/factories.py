from datetime import date, datetime, time
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.utils import timezone

from properties.models import Property, PropertyMembership, Tenancy


def recorded_on(day: date) -> datetime:
    """When a meter baseline was recorded, at noon at the property on that day: tests set it,
    where admin takes the server's time."""
    return timezone.make_aware(datetime.combine(day, time(12)))


def make_user(username="me", **fields):
    return get_user_model().objects.create_user(username=username, firebase_uid=username, **fields)


def make_property(name="Property A", member=None, role="manager"):
    prop = Property.objects.create(name=name, address="1 Main Road")
    if member is not None:
        PropertyMembership.objects.create(user=member, property=prop, role=role)
    return prop


def make_tenancy(prop, **fields):
    defaults = {
        "name": "Shaik Zahid Ali",
        "flat_number": "202",
        "mobile_number": "+919000000101",
        "rent_amount": Decimal("15000.00"),
        "rent_due_day": 11,
        "electricity_rate": Decimal("6.00"),
        "deposit_amount": Decimal("90000.00"),
        "start_date": date(2026, 1, 1),
    }
    return Tenancy.objects.create(property=prop, **{**defaults, **fields})
