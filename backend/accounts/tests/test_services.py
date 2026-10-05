from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.firebase import FirebasePhoneNumberTakenError, FirebaseUnavailableError
from accounts.services import (
    PhoneNumberInUseError,
    check_firebase_identity,
    link_firebase_identity,
)

NUMBER = "+919000000001"


@mock.patch("accounts.services.set_firebase_phone_number")
@mock.patch("accounts.services.get_or_create_firebase_uid", return_value="uid-1")
class LinkFirebaseIdentityTests(TestCase):
    def setUp(self):
        self.User = get_user_model()

    def test_links_a_new_person_to_their_numbers_identity(self, get_uid, set_phone):
        user = self.User(username="new", phone_number=NUMBER)

        link_firebase_identity(user, previous_phone_number="")

        get_uid.assert_called_once_with(NUMBER)
        self.assertEqual(user.firebase_uid, "uid-1")
        set_phone.assert_not_called()

    def test_leaves_a_person_without_a_number_unlinked(self, get_uid, set_phone):
        user = self.User(username="admin")

        link_firebase_identity(user, previous_phone_number="")

        get_uid.assert_not_called()
        self.assertIsNone(user.firebase_uid)

    def test_refuses_an_identity_that_belongs_to_someone_else(self, get_uid, set_phone):
        self.User.objects.create_user(username="taken", firebase_uid="uid-1")
        user = self.User(username="new", phone_number=NUMBER)

        with self.assertRaises(PhoneNumberInUseError):
            link_firebase_identity(user, previous_phone_number="")
        self.assertIsNone(user.firebase_uid)

    def test_moves_a_linked_identity_to_a_changed_number(self, get_uid, set_phone):
        user = self.User(username="p", firebase_uid="uid-1", phone_number="+919000000002")

        link_firebase_identity(user, previous_phone_number=NUMBER)

        set_phone.assert_called_once_with("uid-1", "+919000000002")
        get_uid.assert_not_called()

    def test_removing_the_number_stops_phone_sign_in(self, get_uid, set_phone):
        user = self.User(username="p", firebase_uid="uid-1", phone_number="")

        link_firebase_identity(user, previous_phone_number=NUMBER)

        set_phone.assert_called_once_with("uid-1", None)

    def test_does_nothing_when_a_linked_number_is_unchanged(self, get_uid, set_phone):
        user = self.User(username="p", firebase_uid="uid-1", phone_number=NUMBER)

        link_firebase_identity(user, previous_phone_number=NUMBER)

        set_phone.assert_not_called()
        get_uid.assert_not_called()

    def test_a_number_taken_in_firebase_is_in_use(self, get_uid, set_phone):
        set_phone.side_effect = FirebasePhoneNumberTakenError("taken")
        user = self.User(username="p", firebase_uid="uid-1", phone_number="+919000000002")

        with self.assertRaises(PhoneNumberInUseError):
            link_firebase_identity(user, previous_phone_number=NUMBER)

    def test_firebase_outages_propagate(self, get_uid, set_phone):
        get_uid.side_effect = FirebaseUnavailableError("down")

        with self.assertRaises(FirebaseUnavailableError):
            link_firebase_identity(self.User(username="n", phone_number=NUMBER), "")


@mock.patch("accounts.services.find_firebase_uid", return_value=None)
class CheckFirebaseIdentityTests(TestCase):
    """Read-only: never creates or changes Firebase identities."""

    def setUp(self):
        self.User = get_user_model()

    def test_a_new_number_is_fine(self, find):
        check_firebase_identity(self.User(username="n", phone_number=NUMBER), "")

        find.assert_called_once_with(NUMBER)

    def test_reusing_an_unclaimed_identity_is_fine(self, find):
        find.return_value = "uid-free"

        check_firebase_identity(self.User(username="n", phone_number=NUMBER), "")

    def test_an_identity_claimed_by_someone_else_is_in_use(self, find):
        self.User.objects.create_user(username="taken", firebase_uid="uid-taken")
        find.return_value = "uid-taken"

        with self.assertRaises(PhoneNumberInUseError):
            check_firebase_identity(self.User(username="n", phone_number=NUMBER), "")

    def test_moving_to_a_number_another_identity_has_is_in_use(self, find):
        find.return_value = "uid-other"
        user = self.User(username="p", firebase_uid="uid-1", phone_number="+919000000002")

        with self.assertRaises(PhoneNumberInUseError):
            check_firebase_identity(user, NUMBER)

    def test_skips_the_lookup_when_nothing_would_change(self, find):
        check_firebase_identity(self.User(username="p", firebase_uid="u", phone_number=NUMBER), NUMBER)
        check_firebase_identity(self.User(username="admin"), "")
        check_firebase_identity(self.User(username="p", firebase_uid="u"), NUMBER)  # removal

        find.assert_not_called()

    def test_outages_propagate(self, find):
        find.side_effect = FirebaseUnavailableError("down")

        with self.assertRaises(FirebaseUnavailableError):
            check_firebase_identity(self.User(username="n", phone_number=NUMBER), "")
