import os
import subprocess
import sys
from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework import exceptions
from rest_framework.test import APIClient, APIRequestFactory

from accounts.authentication import DevAuthentication, NotRegistered

BACKEND = Path(__file__).resolve().parents[2]


def authenticate(header):
    extra = {} if header is None else {"HTTP_AUTHORIZATION": header}
    return DevAuthentication().authenticate(APIRequestFactory().get("/api/v1/me/", **extra))


@override_settings(DEV_LOGIN=True, DEBUG=True)
class DevAuthenticationTests(TestCase):
    def setUp(self):
        self.person = get_user_model().objects.create_user(
            username="p", email="person@example.test", name="Person"
        )

    def test_signs_in_as_the_person_with_that_email_ignoring_case(self):
        user, claims = authenticate("Dev  Person@Example.test")

        self.assertEqual(user, self.person)
        self.assertTrue(claims["dev"])

    def test_other_schemes_and_no_header_are_left_to_the_other_classes(self):
        self.assertIsNone(authenticate(None))
        self.assertIsNone(authenticate("Bearer some-token"))

    def test_an_email_nobody_added_is_not_registered_and_creates_nobody(self):
        with self.assertRaises(NotRegistered):
            authenticate("Dev stranger@example.test")
        self.assertEqual(get_user_model().objects.count(), 1)

    def test_a_malformed_header_is_refused(self):
        with self.assertRaises(exceptions.AuthenticationFailed):
            authenticate("Dev")
        with self.assertRaises(exceptions.AuthenticationFailed):
            authenticate("Dev a@example.test extra")

    def test_an_inactive_person_is_refused(self):
        self.person.is_active = False
        self.person.save()

        with self.assertRaises(exceptions.AuthenticationFailed):
            authenticate("Dev person@example.test")

    @override_settings(DEV_LOGIN=False)
    def test_refused_when_dev_login_is_off(self):
        with self.assertRaises(exceptions.AuthenticationFailed):
            authenticate("Dev person@example.test")

    @override_settings(DEBUG=False)
    def test_refused_when_debug_is_off(self):
        with self.assertRaises(exceptions.AuthenticationFailed):
            authenticate("Dev person@example.test")


class DevLoginIsOffByDefaultTests(TestCase):
    def test_the_api_does_not_accept_a_dev_header(self):
        get_user_model().objects.create_user(username="p", email="person@example.test")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION="Dev person@example.test")

        self.assertEqual(client.get("/api/v1/me/").status_code, 401)


class DevLoginSettingsGuardTests(SimpleTestCase):
    """config/settings.py refuses to start with dev login in the wrong environment."""

    def load_settings(self, **env):
        base = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith("DJANGO_") or key == "DJANGO_SETTINGS_MODULE"
        }
        base.setdefault("DJANGO_SECRET_KEY", "test-only-secret")
        return subprocess.run(
            [sys.executable, "-c", "import config.settings"],
            cwd=BACKEND,
            env={**base, **env},
            capture_output=True,
            text=True,
        )

    def test_starts_with_debug_and_local_hosts(self):
        result = self.load_settings(
            DJANGO_ENV="dev", DJANGO_DEBUG="true", DJANGO_ALLOWED_HOSTS="localhost,127.0.0.1,backend"
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_refuses_without_debug(self):
        result = self.load_settings(
            DJANGO_ENV="dev", DJANGO_DEBUG="false", DJANGO_ALLOWED_HOSTS="localhost"
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DJANGO_ENV=dev", result.stderr)

    def test_refuses_a_public_host(self):
        result = self.load_settings(
            DJANGO_ENV="dev", DJANGO_DEBUG="true", DJANGO_ALLOWED_HOSTS="localhost,rent.example.com"
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("rent.example.com", result.stderr)

    def test_other_environments_are_unaffected(self):
        # Empty rather than unset, so a developer's backend/.env (loaded by settings) can't set it.
        result = self.load_settings(DJANGO_ENV="", DJANGO_ALLOWED_HOSTS="rent.example.com")
        self.assertEqual(result.returncode, 0, result.stderr)
