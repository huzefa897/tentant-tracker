from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.firebase import FirebaseUnavailableError, InvalidFirebaseTokenError
from properties.models import PropertyMembership

ME_URL = "/api/v1/me/"
CLAIMS = {
    "uid": "firebase-uid-1",
    "email": "owner@example.com",
    "email_verified": True,
    "firebase": {"sign_in_provider": "google.com"},
}


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

    def invite(self, **fields):
        """A person an admin added with the email in CLAIMS (linking is
        accounts/tests/test_services.py)."""
        return get_user_model().objects.create_user(
            **{"username": "invited", "email": CLAIMS["email"], **fields}
        )

    def test_unregistered_account_is_403_and_creates_nothing(self, verify):
        verify.return_value = CLAIMS

        response = self.get_me("Bearer token")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.json(),
            {
                "detail": "This Google account isn't registered. Contact the property owner.",
                "code": "not_registered",
            },
        )
        self.assertFalse(get_user_model().objects.exists())

    def test_invited_person_signs_in_and_is_linked_without_access_being_added(self, verify):
        user = self.invite()
        verify.return_value = CLAIMS

        with self.assertLogs("accounts.services", "INFO"):
            response = self.get_me("Bearer token")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], user.id)
        self.assertEqual(response.json()["email"], CLAIMS["email"])
        self.assertEqual(response.json()["properties"], [])
        self.assertFalse(PropertyMembership.objects.exists())
        self.assertEqual(get_user_model().objects.get().firebase_uid, CLAIMS["uid"])

    def test_an_email_removed_in_admin_ends_access_even_with_an_older_token(self, verify):
        self.invite(firebase_uid=CLAIMS["uid"], email="")
        verify.return_value = CLAIMS

        response = self.get_me("Bearer token")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "not_registered")

    def test_inactive_django_user_is_401(self, verify):
        self.invite(firebase_uid=CLAIMS["uid"], is_active=False)
        verify.return_value = CLAIMS

        self.assertEqual(self.get_me("Bearer token").status_code, 401)
