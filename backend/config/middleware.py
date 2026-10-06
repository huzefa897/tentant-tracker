import hashlib

from django.core.cache import cache
from django.http import HttpResponse
from django.urls import reverse
from rest_framework.throttling import BaseThrottle

# Failed admin logins allowed in the window: per address and username, and per address
# across usernames (guessing many accounts).
FAILURES_PER_USERNAME = 5
FAILURES_PER_ADDRESS = 20
WINDOW_SECONDS = 15 * 60


class AdminLoginThrottleMiddleware:
    """Slows down password guessing on Django admin's login: once an address has failed too
    often, further attempts get 429 until the window passes. A successful login clears that
    username's count. Addresses are read like DRF's throttles (NUM_PROXIES)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method != "POST" or request.path != reverse("admin:login"):
            return self.get_response(request)

        address = BaseThrottle().get_ident(request)
        username = request.POST.get("username", "").strip().lower()
        # Hashed, so any username makes a safe cache key and none is stored as typed.
        user_key = "admin-login:%s" % hashlib.sha256(f"{address}\n{username}".encode()).hexdigest()
        address_key = "admin-login:%s" % hashlib.sha256(address.encode()).hexdigest()
        limits = ((user_key, FAILURES_PER_USERNAME), (address_key, FAILURES_PER_ADDRESS))

        if any(cache.get(key, 0) >= limit for key, limit in limits):
            return HttpResponse(
                "Too many failed sign-in attempts. Try again in 15 minutes.",
                status=429,
                content_type="text/plain",
                headers={"Retry-After": str(WINDOW_SECONDS)},
            )

        response = self.get_response(request)
        # Admin redirects after a successful login and shows the form again after a failure.
        if response.status_code == 302:
            cache.delete(user_key)
        else:
            for key, _ in limits:
                try:
                    cache.incr(key)
                except ValueError:  # No count yet (or it just expired).
                    cache.set(key, 1, WINDOW_SECONDS)
        return response
