from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.firebase import FirebaseUnavailableError
from accounts.services import NotRegisteredError, get_registered_user, unlink_if_email_changed

EMAIL = "owner@example.com"


def google_claims(uid="uid-1", email=EMAIL, **extra):
    """Verified claims of a Google sign-in through Firebase."""
    return {
        "uid": uid,
        "email": email,
        "email_verified": True,
        "firebase": {"sign_in_provider": "google.com"},
        **extra,
    }


class GetRegisteredUserTests(TestCase):
    def setUp(self):
        self.User = get_user_model()

    def invite(self, email=EMAIL, **fields):
        return self.User.objects.create_user(username=f"p-{email}", email=email, **fields)

    def test_first_google_sign_in_links_the_invited_person(self):
        person = self.invite()

        with self.assertLogs("accounts.services", "INFO"):
            self.assertEqual(get_registered_user(google_claims()), person)

        person.refresh_from_db()
        self.assertEqual(person.firebase_uid, "uid-1")

    def test_a_linked_person_is_found_by_uid_alone(self):
        person = self.invite(firebase_uid="uid-1")

        # Even if the Google account's email has since changed.
        self.assertEqual(get_registered_user(google_claims(email="new@example.com")), person)

    def test_matches_the_email_ignoring_case(self):
        person = self.invite()

        with self.assertLogs("accounts.services", "INFO"):
            self.assertEqual(get_registered_user(google_claims(email="Owner@Example.COM")), person)

    def test_an_email_nobody_added_is_refused_and_creates_nothing(self):
        self.invite()

        with self.assertRaises(NotRegisteredError):
            get_registered_user(google_claims(email="stranger@example.com"))

        self.assertEqual(self.User.objects.count(), 1)
        self.assertFalse(self.User.objects.filter(firebase_uid="uid-1").exists())

    def test_never_links_an_unverified_email(self):
        self.invite()

        for claims in [
            google_claims(email_verified=False),
            {**google_claims(), "email_verified": "true"},  # only a real True counts
            {k: v for k, v in google_claims().items() if k != "email_verified"},
        ]:
            with self.subTest(claims=claims), self.assertRaises(NotRegisteredError):
                get_registered_user(claims)

        self.assertIsNone(self.User.objects.get().firebase_uid)

    def test_never_links_a_sign_in_other_than_google(self):
        self.invite()

        for provider in ["password", "phone", "emailLink", None]:
            claims = google_claims(firebase={"sign_in_provider": provider})
            with self.subTest(provider=provider), self.assertRaises(NotRegisteredError):
                get_registered_user(claims)

        self.assertIsNone(self.User.objects.get().firebase_uid)

    def test_never_relinks_a_person_linked_to_another_identity(self):
        self.invite(firebase_uid="uid-original")

        with self.assertRaises(NotRegisteredError):
            get_registered_user(google_claims(uid="uid-other"))

        self.assertEqual(self.User.objects.get().firebase_uid, "uid-original")

    def test_a_person_without_an_email_is_refused_even_when_linked(self):
        # Removing the email in admin ends access, even for an older token.
        self.User.objects.create_user(username="p", firebase_uid="uid-1")

        with self.assertRaises(NotRegisteredError):
            get_registered_user(google_claims())

    def test_claims_without_an_email_are_refused(self):
        self.invite()

        with self.assertRaises(NotRegisteredError):
            get_registered_user(google_claims(email=None))


@mock.patch("accounts.services.revoke_firebase_sessions")
class UnlinkIfEmailChangedTests(TestCase):
    def setUp(self):
        self.User = get_user_model()

    def test_a_changed_email_unlinks_and_signs_the_person_out(self, revoke):
        user = self.User(username="p", firebase_uid="uid-1", email="new@example.com")

        unlink_if_email_changed(user, previous_email=EMAIL)

        revoke.assert_called_once_with("uid-1")
        self.assertIsNone(user.firebase_uid)

    def test_a_removed_email_unlinks_and_signs_the_person_out(self, revoke):
        user = self.User(username="p", firebase_uid="uid-1", email="")

        unlink_if_email_changed(user, previous_email=EMAIL)

        revoke.assert_called_once_with("uid-1")
        self.assertIsNone(user.firebase_uid)

    def test_an_unchanged_email_changes_nothing(self, revoke):
        user = self.User(username="p", firebase_uid="uid-1", email="Owner@Example.com")

        unlink_if_email_changed(user, previous_email=EMAIL)

        revoke.assert_not_called()
        self.assertEqual(user.firebase_uid, "uid-1")

    def test_a_person_never_linked_needs_no_firebase_call(self, revoke):
        unlink_if_email_changed(self.User(username="p", email="new@example.com"), EMAIL)

        revoke.assert_not_called()

    def test_outages_propagate_and_keep_the_link(self, revoke):
        revoke.side_effect = FirebaseUnavailableError("down")
        user = self.User(username="p", firebase_uid="uid-1", email="")

        with self.assertRaises(FirebaseUnavailableError):
            unlink_if_email_changed(user, EMAIL)
        self.assertEqual(user.firebase_uid, "uid-1")
