import logging

from django.core.cache import caches
from django.db import DatabaseError
from django.http import JsonResponse
from rest_framework import throttling
from rest_framework.permissions import SAFE_METHODS

logger = logging.getLogger(__name__)


class FailOpenMixin:
    """If the counts can't be read (production keeps them in PostgreSQL, DJANGO_SHARED_CACHE:
    the database is down, or `createcachetable` wasn't run), let the request through rather
    than fail it: a rate limit must never take the app down, and readiness must still report
    the database as unavailable instead of every request erroring."""

    def allow_request(self, request, view):
        try:
            return super().allow_request(request, view)
        except DatabaseError as error:
            logger.warning("Rate limit not applied: counts unavailable (%s)", type(error).__name__)
            return True


class UserRateThrottle(FailOpenMixin, throttling.UserRateThrottle):
    """Every API request per signed-in person (per address when signed out)."""


class WriteRateThrottle(FailOpenMixin, throttling.UserRateThrottle):
    """A stricter limit on writes (creating bills, recording payments), per person. Reads only
    count against the general user limit."""

    scope = "writes"

    def allow_request(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return super().allow_request(request, view)


class AddressRateThrottle(FailOpenMixin, throttling.SimpleRateThrottle):
    """Every API request from one address, signed in or not."""

    scope = "address"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class HealthCheckRateThrottle(throttling.SimpleRateThrottle):
    """The public health and readiness checks, per address: a stricter limit of their own,
    counted in this process's memory (the "health" cache), never in the shared PostgreSQL
    cache, so pinging them in a flood costs no database work. Each Gunicorn worker counts
    separately, so the effective limit is up to WEB_CONCURRENCY times the rate."""

    scope = "health"

    @property
    def cache(self):
        return caches["health"]

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


# Public, unauthenticated paths limited by HealthCheckRateThrottle instead of the address limit.
HEALTH_CHECK_PATHS = frozenset({"/api/v1/health/", "/api/v1/ready/"})


class ApiRateLimitMiddleware:
    """Limits all API requests per address before authentication. DRF checks its throttles
    after authentication and permissions, so without this a request with no or a bad token
    would get its 401 without ever being counted. Signed-in limits per person stay in DRF."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/api/"):
            if request.path in HEALTH_CHECK_PATHS:
                throttle = HealthCheckRateThrottle()
            else:
                throttle = AddressRateThrottle()
            if not throttle.allow_request(request, None):
                wait = throttle.wait()
                response = JsonResponse(
                    {"detail": "Too many requests. Try again shortly."}, status=429
                )
                if wait is not None:
                    response.headers["Retry-After"] = str(max(1, round(wait)))
                return response
        return self.get_response(request)
