from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.firebase import FirebaseUnavailableError, InvalidFirebaseTokenError
from properties.models import PropertyMembership

ME_URL = "/api/v1/me/"
CLAIMS = {"uid": "firebase-uid-1", "phone_number": "+910000000001"}


@mock.patch("accounts.authentication.verify_firebase_token")
class FirebaseAuthenticationTests(TestCase):
    def get_me(self, authorization=None):
        client = APIClient()
        if authorization is not None:
            client.credentials(HTTP_AUTHORIZATION=authorization)
        return client.get(ME_URL)

    def test_no_token_is_401_with_bearer_challenge(self, verify):
        response = self.get_me()

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["WWW-Authenticate"], "Bearer")
        verify.assert_not_called()

    def test_malformed_bearer_header_is_401_without_verifying(self, verify):
        for header in ["Bearer", "Bearer one two"]:
            with self.subTest(header):
                self.assertEqual(self.get_me(header).status_code, 401)
        verify.assert_not_called()

    def test_other_schemes_are_not_authenticated(self, verify):
        self.assertEqual(self.get_me("Basic dXNlcjpwYXNz").status_code, 401)
        verify.assert_not_called()

    def test_failed_verification_is_401(self, verify):
        verify.side_effect = InvalidFirebaseTokenError("expired")

        response = self.get_me("Bearer token")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(get_user_model().objects.count(), 0)

    def test_unavailable_verification_is_503_not_401(self, verify):
        verify.side_effect = FirebaseUnavailableError("down")

        self.assertEqual(self.get_me("Bearer token").status_code, 503)

    def test_verifies_the_bearer_token(self, verify):
        verify.return_value = CLAIMS

        self.get_me("Bearer the-id-token")

        verify.assert_called_once_with("the-id-token")

    def test_first_request_creates_one_non_admin_user_without_access(self, verify):
        verify.return_value = CLAIMS

        response = self.get_me("Bearer token")

        self.assertEqual(response.status_code, 200)
        user = get_user_model().objects.get()
        self.assertEqual(user.firebase_uid, "firebase-uid-1")
        self.assertEqual(user.phone_number, "+910000000001")
        self.assertTrue(user.username.startswith("firebase-"))
        self.assertFalse(user.has_usable_password())
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertFalse(PropertyMembership.objects.exists())
        self.assertEqual(response.json()["properties"], [])

    def test_later_requests_reuse_the_user(self, verify):
        verify.return_value = CLAIMS

        first = self.get_me("Bearer token").json()
        second = self.get_me("Bearer token").json()

        self.assertEqual(first["id"], second["id"])
        self.assertEqual(get_user_model().objects.count(), 1)

    def test_identity_without_a_phone_number(self, verify):
        verify.return_value = {"uid": "no-phone"}

        response = self.get_me("Bearer token")

        self.assertEqual(response.json()["phoneNumber"], "")

    def test_inactive_django_user_is_401(self, verify):
        get_user_model().objects.create_user(
            username="blocked", firebase_uid="firebase-uid-1", is_active=False
        )
        verify.return_value = CLAIMS

        self.assertEqual(self.get_me("Bearer token").status_code, 401)
