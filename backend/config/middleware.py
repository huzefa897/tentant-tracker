import hashlib
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.http import HttpResponse
from django.urls import reverse
from django.utils import timezone
from rest_framework.throttling import BaseThrottle

from accounts.models import AdminLoginAttempts

# Admin login attempts allowed in the window: per address and username, and per address
# across usernames (guessing many accounts). Successful logins don't count.
FAILURES_PER_USERNAME = 5
FAILURES_PER_ADDRESS = 20
WINDOW = timedelta(minutes=15)


def reserve_attempt(limits) -> bool:
    """Counts an attempt against every (key, limit) before the password is checked, or returns
    False if any key is already at its limit. Rows are locked in key order, so simultaneous
    attempts queue rather than all seeing a count below the limit."""
    now = timezone.now()
    with transaction.atomic():
        AdminLoginAttempts.objects.filter(window_ends__lte=now).delete()
        rows = []
        for key, limit in sorted(limits):
            row, _ = AdminLoginAttempts.objects.select_for_update().get_or_create(
                key=key, defaults={"window_ends": now + WINDOW}
            )
            if row.attempts >= limit:
                return False
            rows.append(row)
        for row in rows:
            row.attempts += 1
            row.save(update_fields=["attempts"])
    return True


class AdminLoginThrottleMiddleware:
    """Slows down password guessing on Django admin's login: once an address has failed too
    often, further attempts get 429 until the window passes. Each attempt is reserved before
    the password is checked; a successful login clears that username's count and gives the
    address its attempt back. Addresses are read like DRF's throttles (NUM_PROXIES)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method != "POST" or request.path != reverse("admin:login"):
            return self.get_response(request)

        address = BaseThrottle().get_ident(request)
        username = request.POST.get("username", "").strip().lower()
        # Hashed, so any username makes a safe key and none is stored as typed.
        user_key = hashlib.sha256(f"{address}\n{username}".encode()).hexdigest()
        address_key = hashlib.sha256(address.encode()).hexdigest()

        if not reserve_attempt(
            ((user_key, FAILURES_PER_USERNAME), (address_key, FAILURES_PER_ADDRESS))
        ):
            return HttpResponse(
                "Too many failed sign-in attempts. Try again in 15 minutes.",
                status=429,
                content_type="text/plain",
                headers={"Retry-After": str(int(WINDOW.total_seconds()))},
            )

        response = self.get_response(request)
        # Admin redirects after a successful login and shows the form again after a failure,
        # which stays counted.
        if response.status_code == 302:
            AdminLoginAttempts.objects.filter(key=user_key).delete()
            AdminLoginAttempts.objects.filter(key=address_key, attempts__gt=0).update(
                attempts=F("attempts") - 1
            )
        return response
