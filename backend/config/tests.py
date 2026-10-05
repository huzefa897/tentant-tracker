from django.test import TestCase, override_settings
from django.urls import path
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework.test import APIClient


@api_view(["GET"])
def protected_view(request):
    return Response({"ok": True})


urlpatterns = [
    path("protected/", protected_view),
]


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
