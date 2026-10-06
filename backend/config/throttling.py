from django.http import JsonResponse
from rest_framework.permissions import SAFE_METHODS
from rest_framework.throttling import SimpleRateThrottle, UserRateThrottle


class WriteRateThrottle(UserRateThrottle):
    """A stricter limit on writes (creating bills, later payments), per person. Reads only
    count against the general user limit."""

    scope = "writes"

    def allow_request(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return super().allow_request(request, view)


class AddressRateThrottle(SimpleRateThrottle):
    """Every API request from one address, signed in or not."""

    scope = "address"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class ApiRateLimitMiddleware:
    """Limits all API requests per address before authentication. DRF checks its throttles
    after authentication and permissions, so without this a request with no or a bad token
    would get its 401 without ever being counted. Signed-in limits per person stay in DRF."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/api/"):
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
