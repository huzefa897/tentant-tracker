from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.firebase import FirebasePhoneNumberTakenError, FirebaseUnavailableError
from accounts.services import PhoneNumberInUseError, link_firebase_identity

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
