from unittest import mock

from django.test import SimpleTestCase, override_settings
from firebase_admin import auth, exceptions
from google.auth.exceptions import DefaultCredentialsError

from accounts.firebase import (
    FirebaseUnavailableError,
    InvalidFirebaseTokenError,
    initialize_firebase,
    revoke_firebase_sessions,
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


@mock.patch("accounts.firebase.initialize_firebase")
@mock.patch("accounts.firebase.auth.revoke_refresh_tokens")
class RevokeFirebaseSessionsTests(SimpleTestCase):
    def test_revokes_the_identitys_refresh_tokens(self, revoke, _init):
        revoke_firebase_sessions("uid-1")

        revoke.assert_called_once_with("uid-1")

    def test_outages_raise_unavailable(self, revoke, _init):
        revoke.side_effect = exceptions.UnavailableError("down")

        with self.assertLogs("accounts.firebase", "ERROR"):
            with self.assertRaises(FirebaseUnavailableError):
                revoke_firebase_sessions("uid-1")


SERVICE_ACCOUNT_KEY = {
    "type": "service_account",
    "project_id": "test-project",
    "private_key_id": "key-id",
    "private_key": "-----BEGIN PRIVATE KEY-----\nnot a real key\n-----END PRIVATE KEY-----\n",
    "client_email": "app@test-project.iam.gserviceaccount.com",
    "client_id": "1",
    "token_uri": "https://oauth2.googleapis.com/token",
}


@override_settings(FIREBASE_PROJECT_ID="test-project")
@mock.patch("accounts.firebase.firebase_admin.initialize_app")
@mock.patch("accounts.firebase.firebase_admin.get_app", side_effect=ValueError)
class InitializeFirebaseTests(SimpleTestCase):
    @override_settings(FIREBASE_SERVICE_ACCOUNT_KEY=SERVICE_ACCOUNT_KEY)
    @mock.patch("accounts.firebase.credentials.Certificate")
    def test_uses_the_keys_fields_when_set(self, certificate, _get_app, initialize_app):
        initialize_firebase()

        certificate.assert_called_once_with(SERVICE_ACCOUNT_KEY)
        initialize_app.assert_called_once_with(
            certificate.return_value, options={"projectId": "test-project"}
        )

    @override_settings(FIREBASE_SERVICE_ACCOUNT_KEY=None)
    def test_otherwise_uses_the_key_file(self, _get_app, initialize_app):
        initialize_firebase()

        # None: the Admin SDK reads GOOGLE_APPLICATION_CREDENTIALS.
        initialize_app.assert_called_once_with(None, options={"projectId": "test-project"})

    @override_settings(FIREBASE_SERVICE_ACCOUNT_KEY=SERVICE_ACCOUNT_KEY)
    def test_an_unusable_key_makes_firebase_unavailable(self, _get_app, initialize_app):
        with self.assertLogs("accounts.firebase", "ERROR"):
            with self.assertRaises(FirebaseUnavailableError):
                verify_firebase_token("token")

        initialize_app.assert_not_called()
