from unittest import mock

from django.test import SimpleTestCase, override_settings
from firebase_admin import auth, exceptions
from google.auth.exceptions import DefaultCredentialsError

from accounts.firebase import (
    FirebasePhoneNumberTakenError,
    FirebaseUnavailableError,
    InvalidFirebaseTokenError,
    get_or_create_firebase_uid,
    set_firebase_phone_number,
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


def firebase_user(uid):
    return mock.Mock(uid=uid)


@mock.patch("accounts.firebase.initialize_firebase")
class GetOrCreateFirebaseUidTests(SimpleTestCase):
    @mock.patch("accounts.firebase.auth.create_user")
    @mock.patch("accounts.firebase.auth.get_user_by_phone_number")
    def test_reuses_an_existing_identity(self, get_user, create_user, _init):
        get_user.return_value = firebase_user("existing")

        self.assertEqual(get_or_create_firebase_uid("+919000000001"), "existing")
        create_user.assert_not_called()

    @mock.patch("accounts.firebase.auth.create_user")
    @mock.patch("accounts.firebase.auth.get_user_by_phone_number")
    def test_creates_an_identity_for_a_new_number(self, get_user, create_user, _init):
        get_user.side_effect = auth.UserNotFoundError("none")
        create_user.return_value = firebase_user("created")

        self.assertEqual(get_or_create_firebase_uid("+919000000001"), "created")
        create_user.assert_called_once_with(phone_number="+919000000001")

    @mock.patch("accounts.firebase.auth.create_user")
    @mock.patch("accounts.firebase.auth.get_user_by_phone_number")
    def test_a_concurrent_create_reuses_the_winner(self, get_user, create_user, _init):
        get_user.side_effect = [auth.UserNotFoundError("none"), firebase_user("winner")]
        create_user.side_effect = auth.PhoneNumberAlreadyExistsError("exists", None, None)

        self.assertEqual(get_or_create_firebase_uid("+919000000001"), "winner")

    @mock.patch("accounts.firebase.auth.get_user_by_phone_number")
    def test_outages_raise_unavailable(self, get_user, _init):
        get_user.side_effect = exceptions.UnavailableError("down")

        with self.assertLogs("accounts.firebase", "ERROR"):
            with self.assertRaises(FirebaseUnavailableError):
                get_or_create_firebase_uid("+919000000001")


@mock.patch("accounts.firebase.initialize_firebase")
@mock.patch("accounts.firebase.auth.update_user")
class SetFirebasePhoneNumberTests(SimpleTestCase):
    def test_sets_a_new_number(self, update_user, _init):
        set_firebase_phone_number("uid-1", "+919000000002")

        update_user.assert_called_once_with("uid-1", phone_number="+919000000002")

    def test_removes_the_number(self, update_user, _init):
        set_firebase_phone_number("uid-1", None)

        update_user.assert_called_once_with("uid-1", phone_number=auth.DELETE_ATTRIBUTE)

    def test_a_taken_number_is_reported(self, update_user, _init):
        update_user.side_effect = auth.PhoneNumberAlreadyExistsError("taken", None, None)

        with self.assertRaises(FirebasePhoneNumberTakenError):
            set_firebase_phone_number("uid-1", "+919000000002")

    def test_outages_raise_unavailable(self, update_user, _init):
        update_user.side_effect = exceptions.UnavailableError("down")

        with self.assertLogs("accounts.firebase", "ERROR"):
            with self.assertRaises(FirebaseUnavailableError):
                set_firebase_phone_number("uid-1", "+919000000002")
