from unittest import mock

from django.test import SimpleTestCase, override_settings
from firebase_admin import auth, exceptions
from google.auth.exceptions import DefaultCredentialsError

from accounts.firebase import (
    FirebaseUnavailableError,
    InvalidFirebaseTokenError,
    verify_firebase_token,
)


@override_settings(FIREBASE_PROJECT_ID="test-project")
@mock.patch("accounts.firebase.initialize_firebase")
@mock.patch("accounts.firebase.auth.verify_id_token")
class VerifyFirebaseTokenTests(SimpleTestCase):
    def test_returns_verified_claims_and_checks_revocation(self, verify, _init):
        verify.return_value = {"uid": "uid-1"}

        self.assertEqual(verify_firebase_token("token"), {"uid": "uid-1"})
        verify.assert_called_once_with("token", check_revoked=True)

    def test_rejected_tokens_raise_invalid_token(self, verify, _init):
        rejections = [
            auth.InvalidIdTokenError("bad signature"),
            auth.ExpiredIdTokenError("expired", cause=None),
            auth.RevokedIdTokenError("revoked"),
            auth.UserDisabledError("disabled"),
            auth.UserNotFoundError("deleted"),
        ]
        for error in rejections:
            with self.subTest(type(error).__name__):
                verify.side_effect = error

                with self.assertRaises(InvalidFirebaseTokenError):
                    verify_firebase_token("token")

    def test_service_failures_raise_unavailable_not_invalid(self, verify, _init):
        failures = [
            auth.CertificateFetchError("no certificates", cause=None),
            exceptions.UnavailableError("Firebase down"),
            exceptions.DeadlineExceededError("timeout"),
            DefaultCredentialsError("no credentials"),
            ValueError("project ID required"),
        ]
        for error in failures:
            with self.subTest(type(error).__name__):
                verify.side_effect = error

                with self.assertLogs("accounts.firebase", "ERROR"):
                    with self.assertRaises(FirebaseUnavailableError):
                        verify_firebase_token("token")
