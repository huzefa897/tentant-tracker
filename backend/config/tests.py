import threading
from unittest import mock

from django.conf import settings
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.cache import cache, caches
from django.core.management import call_command
from django.db import OperationalError, connection
from django.test import (
    Client,
    TestCase,
    TransactionTestCase,
    override_settings,
    skipUnlessDBFeature,
)
from django.urls import path, reverse
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle

from accounts.models import AdminLoginAttempts

from .views import health_check, readiness_check


@api_view(["GET"])
def protected_view(request):
    return Response({"ok": True})


@api_view(["GET", "POST"])
def write_view(request):
    return Response({"ok": True})


urlpatterns = [
    path("protected/", protected_view),
    path("api/protected/", protected_view),
    path("api/v1/health/", health_check),
    path("api/v1/ready/", readiness_check),
    path("write/", write_view),
    path("admin/", admin.site.urls),
]

# A real cache, so the limits count (the test runner otherwise uses a dummy one).
REAL_CACHE = {
    "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
    "health": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "health"},
}


class HealthCheckTests(TestCase):
    def test_returns_ok_without_authentication(self):
        response = APIClient().get("/api/v1/health/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_ignores_tokens_so_firebase_outages_do_not_fail_it(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION="Bearer not-checked")

        self.assertEqual(client.get("/api/v1/health/").status_code, 200)

    def test_rejects_other_methods(self):
        response = APIClient().post("/api/v1/health/")

        self.assertEqual(response.status_code, 405)


class ReadinessCheckTests(TestCase):
    def test_returns_ok_when_the_database_answers(self):
        response = APIClient().get("/api/v1/ready/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_returns_503_without_details_when_the_database_is_unavailable(self):
        error = OperationalError('connection to server at "db" failed: password for "app"')
        with (
            mock.patch("config.views.connection.cursor", side_effect=error),
            self.assertLogs("config.views", "WARNING") as logs,
        ):
            response = APIClient().get("/api/v1/ready/")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "unavailable"})
        # Neither the response nor the log repeats the driver's message.
        self.assertNotIn("password", " ".join(logs.output))

    def test_ignores_tokens_so_firebase_outages_do_not_fail_it(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION="Bearer not-checked")

        self.assertEqual(client.get("/api/v1/ready/").status_code, 200)


def unreachable_counts():
    """A cache whose every call fails like the database cache with PostgreSQL down."""
    broken = mock.Mock()
    broken.get.side_effect = OperationalError("connection refused")
    broken.set.side_effect = OperationalError("connection refused")
    return mock.patch.object(SimpleRateThrottle, "cache", broken)


class RateLimitFailsOpenTests(TestCase):
    """Production keeps the counts in PostgreSQL: with the database down, the limits must step
    aside instead of every request failing. Health and readiness never use these counts (their
    own are in memory), so readiness reports 503 and health 200 without them."""

    def test_readiness_still_reports_the_database_unavailable(self):
        with (
            unreachable_counts(),
            mock.patch("config.views.connection.cursor", side_effect=OperationalError("down")),
            self.assertLogs("config", "WARNING") as logs,
        ):
            response = APIClient().get("/api/v1/ready/")

        self.assertEqual(response.status_code, 503)
        self.assertNotIn("Rate limit not applied", " ".join(logs.output))

    @override_settings(ROOT_URLCONF=__name__)
    def test_requests_go_through_when_the_counts_are_unavailable(self):
        client = APIClient()
        client.force_authenticate(get_user_model().objects.create_user(username="me"))
        with unreachable_counts(), self.assertLogs("config.throttling", "WARNING"):
            self.assertEqual(client.get("/protected/").status_code, 200)
            self.assertEqual(client.post("/write/").status_code, 200)


class ApiCachingTests(TestCase):
    def test_api_responses_are_never_stored(self):
        response = APIClient().get("/api/v1/health/")

        self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertIn("private", response.headers["Cache-Control"])

    def test_protected_responses_are_never_stored(self):
        response = APIClient().get("/api/v1/me/")

        self.assertEqual(response.status_code, 401)
        self.assertIn("no-store", response.headers["Cache-Control"])

    @override_settings(CACHES=REAL_CACHE)
    def test_rate_limited_responses_are_never_stored(self):
        cache.clear()
        self.addCleanup(cache.clear)
        with mock.patch.dict(SimpleRateThrottle.THROTTLE_RATES, {"address": "1/minute"}):
            APIClient().get("/api/v1/me/")
            response = APIClient().get("/api/v1/me/")

        self.assertEqual(response.status_code, 429)
        self.assertIn("no-store", response.headers["Cache-Control"])

@override_settings(ROOT_URLCONF=__name__)
class DefaultPermissionTests(TestCase):
    def test_endpoints_require_authentication_by_default(self):
        response = APIClient().get("/protected/")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["WWW-Authenticate"], "Bearer")


class CorsTests(TestCase):
    def test_allows_the_configured_vue_origin(self):
        with self.settings(CORS_ALLOWED_ORIGINS=["http://localhost:5173"]):
            response = self.client.get(
                "/api/v1/health/", headers={"Origin": "http://localhost:5173"}
            )

        self.assertEqual(
            response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173"
        )

    def test_ignores_other_origins(self):
        with self.settings(CORS_ALLOWED_ORIGINS=["http://localhost:5173"]):
            response = self.client.get(
                "/api/v1/health/", headers={"Origin": "https://evil.example"}
            )

        self.assertNotIn("Access-Control-Allow-Origin", response.headers)

    def test_admin_sends_no_cors_headers(self):
        with self.settings(CORS_ALLOWED_ORIGINS=["http://localhost:5173"]):
            response = self.client.get(
                reverse("admin:login"), headers={"Origin": "http://localhost:5173"}
            )

        self.assertNotIn("Access-Control-Allow-Origin", response.headers)

    def test_never_allows_credentials(self):
        with self.settings(CORS_ALLOWED_ORIGINS=["http://localhost:5173"]):
            response = self.client.get(
                "/api/v1/health/", headers={"Origin": "http://localhost:5173"}
            )

        self.assertNotIn("Access-Control-Allow-Credentials", response.headers)


@override_settings(ROOT_URLCONF=__name__, CACHES=REAL_CACHE)
class RateLimitTests(TestCase):
    def setUp(self):
        cache.clear()
        rates = mock.patch.dict(
            SimpleRateThrottle.THROTTLE_RATES,
            {"address": "6/minute", "user": "4/minute", "writes": "2/minute"},
        )
        rates.start()
        self.addCleanup(rates.stop)
        self.addCleanup(cache.clear)

    def signed_in(self, username="me"):
        client = APIClient()
        client.force_authenticate(get_user_model().objects.create_user(username=username))
        return client

    def test_limits_api_requests_by_address_before_authentication(self):
        # Requests without a token are counted too, though they never reach the view.
        client = APIClient()
        statuses = [client.get("/api/protected/").status_code for _ in range(7)]

        self.assertEqual(statuses, [401] * 6 + [429])
        self.assertIn("Retry-After", client.get("/api/protected/").headers)

    def test_forged_forwarding_headers_do_not_change_the_address(self):
        client = APIClient()
        statuses = [
            client.get("/api/protected/", headers={"X-Forwarded-For": f"10.0.0.{n}"}).status_code
            for n in range(7)
        ]

        self.assertEqual(statuses, [401] * 6 + [429])

    def test_uses_the_forwarded_address_behind_a_configured_proxy(self):
        client = APIClient()
        with override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 1}):
            for _ in range(6):
                client.get("/api/protected/", headers={"X-Forwarded-For": "10.0.0.1"})
            blocked = client.get("/api/protected/", headers={"X-Forwarded-For": "10.0.0.1"})
            other = client.get("/api/protected/", headers={"X-Forwarded-For": "10.0.0.2"})

        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(other.status_code, 401)

    def test_the_address_limit_only_covers_the_api(self):
        for _ in range(8):
            self.client.get(reverse("admin:login"))

        self.assertEqual(self.client.get(reverse("admin:login")).status_code, 200)

    def test_limits_each_signed_in_person_separately(self):
        me, other = self.signed_in("me"), self.signed_in("other")
        statuses = [me.get("/protected/").status_code for _ in range(5)]

        self.assertEqual(statuses, [200, 200, 200, 200, 429])
        self.assertEqual(other.get("/protected/").status_code, 200)

    def test_limits_writes_more_strictly_than_reads(self):
        client = self.signed_in()
        writes = [client.post("/write/").status_code for _ in range(3)]

        self.assertEqual(writes, [200, 200, 429])
        # Reads still have room under the general limit (one request was refused above).
        self.assertEqual(client.get("/write/").status_code, 200)

    def test_says_when_to_retry(self):
        client = self.signed_in()
        for _ in range(4):
            client.get("/protected/")
        response = client.get("/protected/")

        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response.headers)



SHARED_CACHE = {
    "default": {"BACKEND": "django.core.cache.backends.db.DatabaseCache", "LOCATION": "django_cache"},
    "health": REAL_CACHE["health"],
}


@override_settings(ROOT_URLCONF=__name__, CACHES=SHARED_CACHE)
class SharedCacheRateLimitTests(TestCase):
    """DJANGO_SHARED_CACHE keeps the counts in PostgreSQL, shared by every process."""

    def setUp(self):
        call_command("createcachetable", verbosity=0)
        rates = mock.patch.dict(SimpleRateThrottle.THROTTLE_RATES, {"address": "2/minute"})
        rates.start()
        self.addCleanup(rates.stop)

    def test_limits_requests_with_the_database_cache(self):
        client = APIClient()
        statuses = [client.get("/api/protected/").status_code for _ in range(3)]

        self.assertEqual(statuses, [401, 401, 429])


@override_settings(ROOT_URLCONF=__name__, CACHES=SHARED_CACHE)
class HealthCheckRateLimitTests(TestCase):
    """The public checks have their own per-address limit, counted in memory: with the shared
    (PostgreSQL) cache on, a flood of pings still costs the database nothing."""

    def setUp(self):
        call_command("createcachetable", verbosity=0)
        caches["health"].clear()
        rates = mock.patch.dict(
            SimpleRateThrottle.THROTTLE_RATES, {"address": "2/minute", "health": "3/minute"}
        )
        rates.start()
        self.addCleanup(rates.stop)
        self.addCleanup(caches["health"].clear)

    def test_limits_each_check_per_address(self):
        client = APIClient()
        statuses = [client.get("/api/v1/health/").status_code for _ in range(4)]

        self.assertEqual(statuses, [200, 200, 200, 429])
        refused = client.get("/api/v1/ready/")
        self.assertEqual(refused.status_code, 429)
        self.assertIn("Retry-After", refused.headers)

    def test_counts_other_addresses_separately(self):
        for _ in range(3):
            APIClient().get("/api/v1/health/", REMOTE_ADDR="10.0.0.1")

        response = APIClient().get("/api/v1/health/", REMOTE_ADDR="10.0.0.2")

        self.assertEqual(response.status_code, 200)

    def test_health_pings_never_query_the_database(self):
        client = APIClient()
        with self.assertNumQueries(0):
            for _ in range(5):  # Allowed and refused alike.
                client.get("/api/v1/health/")

    def test_readiness_only_queries_its_own_check(self):
        with self.assertNumQueries(1):
            response = APIClient().get("/api/v1/ready/")

        self.assertEqual(response.status_code, 200)

    def test_is_separate_from_the_api_limit(self):
        # One address uses up the API's limit: the checks still answer it.
        busy_api = APIClient(REMOTE_ADDR="10.0.0.1")
        for _ in range(2):
            busy_api.get("/api/protected/")
        self.assertEqual(busy_api.get("/api/protected/").status_code, 429)
        self.assertEqual(busy_api.get("/api/v1/health/").status_code, 200)

        # Another uses up the checks' limit: the API still answers it.
        busy_checks = APIClient(REMOTE_ADDR="10.0.0.2")
        for _ in range(3):
            busy_checks.get("/api/v1/health/")
        self.assertEqual(busy_checks.get("/api/v1/health/").status_code, 429)
        self.assertEqual(busy_checks.get("/api/protected/").status_code, 401)

class AdminLoginThrottleTests(TestCase):
    def setUp(self):
        get_user_model().objects.create_superuser(username="admin", password="right-pass-123")
        self.url = reverse("admin:login")

    def login(self, password, username="admin"):
        return self.client.post(self.url, {"username": username, "password": password})

    def test_blocks_an_address_after_five_failures_for_a_username(self):
        for _ in range(5):
            self.assertEqual(self.login("wrong").status_code, 200)

        response = self.login("right-pass-123")

        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response.headers)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_blocks_an_address_guessing_many_usernames(self):
        for number in range(20):
            self.login("wrong", username=f"guess-{number}")

        self.assertEqual(self.login("right-pass-123").status_code, 429)

    def test_a_successful_login_clears_the_count(self):
        for _ in range(4):
            self.login("wrong")
        self.assertEqual(self.login("right-pass-123").status_code, 302)
        self.client.logout()

        for _ in range(4):
            self.assertEqual(self.login("wrong").status_code, 200)

    def test_blocked_attempts_with_new_usernames_add_no_rows(self):
        for number in range(20):
            self.login("wrong", username=f"guess-{number}")
        rows = AdminLoginAttempts.objects.count()

        for number in range(20):
            self.assertEqual(self.login("wrong", username=f"new-{number}").status_code, 429)

        self.assertEqual(AdminLoginAttempts.objects.count(), rows)

    def test_forged_forwarding_headers_do_not_change_the_address(self):
        for number in range(5):
            self.client.post(
                self.url,
                {"username": "admin", "password": "wrong"},
                headers={"X-Forwarded-For": f"10.0.0.{number}"},
            )

        self.assertEqual(self.login("right-pass-123").status_code, 429)

    def test_a_successful_login_does_not_count_against_the_address(self):
        for number in range(19):
            self.login("wrong", username=f"guess-{number}")
        self.assertEqual(self.login("right-pass-123").status_code, 302)
        self.client.logout()

        self.assertEqual(self.login("wrong", username="guess-last").status_code, 200)
        self.assertEqual(self.login("right-pass-123").status_code, 429)

    def test_only_admin_login_posts_are_counted(self):
        for _ in range(10):
            self.client.get(self.url)

        self.assertEqual(self.login("right-pass-123").status_code, 302)


@skipUnlessDBFeature("has_select_for_update")
class ConcurrentAdminLoginThrottleTests(TransactionTestCase):
    """Real transactions on separate connections (PostgreSQL), as simultaneous requests from
    several worker processes would be."""

    def test_a_burst_of_guesses_gets_no_more_than_the_limit(self):
        get_user_model().objects.create_superuser(username="admin", password="right-pass-123")
        url = reverse("admin:login")
        barrier = threading.Barrier(10)
        statuses = []
        lock = threading.Lock()

        def guess():
            try:
                barrier.wait()
                status = Client().post(url, {"username": "admin", "password": "wrong"}).status_code
            except Exception as error:  # noqa: BLE001 - reported by the assertion below
                status = repr(error)
            finally:
                connection.close()
            with lock:
                statuses.append(status)

        threads = [threading.Thread(target=guess) for _ in range(10)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)

        self.assertEqual(sorted(statuses, key=str), [200] * 5 + [429] * 5)

class SecuritySettingsTests(TestCase):
    def test_responses_carry_the_security_headers(self):
        response = self.client.get("/api/v1/health/")

        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.headers["Referrer-Policy"], "same-origin")
        self.assertEqual(response.headers["Cross-Origin-Opener-Policy"], "same-origin")
        self.assertEqual(response.headers["X-Frame-Options"], "DENY")

    def test_staff_passwords_are_hashed_with_argon2(self):
        user = get_user_model().objects.create_superuser(username="admin", password="pass-123")

        self.assertTrue(user.password.startswith("argon2"))
        self.assertTrue(user.check_password("pass-123"))

    def test_admin_is_served_at_the_configured_path(self):
        self.assertEqual(reverse("admin:index"), f"/{settings.ADMIN_PATH}")

