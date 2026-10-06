from unittest import mock

from django.conf import settings
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import path, reverse
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle


@api_view(["GET"])
def protected_view(request):
    return Response({"ok": True})


@api_view(["GET", "POST"])
def write_view(request):
    return Response({"ok": True})


urlpatterns = [
    path("protected/", protected_view),
    path("api/protected/", protected_view),
    path("write/", write_view),
    path("admin/", admin.site.urls),
]

# A real cache, so the limits count (the test runner otherwise uses a dummy one).
REAL_CACHE = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


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


@override_settings(CACHES=REAL_CACHE)
class AdminLoginThrottleTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
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

    def test_only_admin_login_posts_are_counted(self):
        for _ in range(10):
            self.client.get(self.url)

        self.assertEqual(self.login("right-pass-123").status_code, 302)


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
