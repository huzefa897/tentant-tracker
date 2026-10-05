from unittest import mock

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.test import TestCase
from django.urls import reverse

from accounts.firebase import FirebaseUnavailableError
from properties.models import Property, PropertyMembership


class UserModelTests(TestCase):
    def setUp(self):
        self.User = get_user_model()

    def test_is_the_configured_user_model(self):
        self.assertEqual(self.User._meta.label, "accounts.User")

    def test_several_people_can_exist_without_a_firebase_uid_or_number(self):
        self.User.objects.create_user(username="admin-one")
        self.User.objects.create_user(username="admin-two")

        self.assertEqual(self.User.objects.filter(firebase_uid__isnull=True, phone_number="").count(), 2)

    def test_firebase_uid_is_unique(self):
        self.User.objects.create_user(username="one", firebase_uid="uid-1")

        with self.assertRaises(IntegrityError):
            self.User.objects.create_user(username="two", firebase_uid="uid-1")

    def test_mobile_number_is_unique(self):
        self.User.objects.create_user(username="one", phone_number="+919000000001")

        with self.assertRaises(IntegrityError):
            self.User.objects.create_user(username="two", phone_number="+919000000001")

    def test_clean_normalizes_and_validates_the_number(self):
        user = self.User(username="p", phone_number="+91 90000-00001")
        user.full_clean(exclude=["password"])
        self.assertEqual(user.phone_number, "+919000000001")

        with self.assertRaises(ValidationError):
            self.User(username="q", phone_number="+447911123456").full_clean(exclude=["password"])

    def test_is_shown_by_name_and_mobile_number_or_username(self):
        self.assertEqual(
            str(self.User(username="x", name="Huzefa Saleem", phone_number="+918977867546")),
            "Huzefa Saleem — +91 89778 67546",
        )
        self.assertEqual(str(self.User(username="x", phone_number="+918977867546")), "+91 89778 67546")
        self.assertEqual(str(self.User(username="x", name="Huzefa Saleem")), "Huzefa Saleem")
        self.assertEqual(str(self.User(username="admin")), "admin")

    def test_name_is_optional_and_tidied(self):
        user = self.User(username="p", name="  Huzefa   Saleem ")
        user.full_clean(exclude=["password"])

        self.assertEqual(user.name, "Huzefa Saleem")
        self.User(username="q").full_clean(exclude=["password"])


# Firebase is never called: the read-only lookup (validation) and the changes (save)
# are all mocked. find_firebase_uid and revoke_firebase_sessions are patched with new= so
# their mocks aren't passed in.
@mock.patch("accounts.services.find_firebase_uid", new=mock.Mock(return_value=None))
@mock.patch("accounts.services.revoke_firebase_sessions", new=mock.Mock())
@mock.patch("accounts.services.set_firebase_phone_number")
@mock.patch("accounts.services.get_or_create_firebase_uid", return_value="uid-new")
class PersonAdminTests(TestCase):
    def setUp(self):
        self.User = get_user_model()
        self.admin = self.User.objects.create_superuser(username="admin", password="pass")
        self.client.force_login(self.admin)
        self.tower = Property.objects.create(name="Tower", address="A")

    def add(self, **data):
        return self.client.post(
            reverse("admin:accounts_user_add"), {"name": "", "phone_number": "", "email": "", **data}
        )

    def test_groups_are_hidden(self, *_):
        self.assertFalse(admin.site.is_registered(Group))

    def test_list_shows_people_by_name_and_number_with_their_properties(self, *_):
        person = self.User.objects.create_user(
            username="firebase-abc",
            firebase_uid="uid-1",
            name="Huzefa Saleem",
            phone_number="+918977867546",
        )
        PropertyMembership.objects.create(user=person, property=self.tower, role="owner")

        response = self.client.get(reverse("admin:accounts_user_changelist"))

        self.assertContains(response, "Huzefa Saleem — +91 89778 67546")
        self.assertContains(response, "Tower (Owner)")
        self.assertNotContains(response, "firebase-abc")

    def test_people_can_be_found_by_name(self, *_):
        found = self.User.objects.create_user(username="a", name="Huzefa Saleem")
        other = self.User.objects.create_user(username="b", name="Someone Else")

        response = self.client.get(reverse("admin:accounts_user_changelist"), {"q": "huzefa"})

        self.assertIn(found, response.context["cl"].result_list)
        self.assertNotIn(other, response.context["cl"].result_list)

    def test_filters_people_waiting_for_access(self, *_):
        waiting = self.User.objects.create_user(username="w", phone_number="+919000000001")
        member = self.User.objects.create_user(username="m", phone_number="+919000000002")
        PropertyMembership.objects.create(user=member, property=self.tower, role="manager")

        response = self.client.get(reverse("admin:accounts_user_changelist"), {"property_access": "no"})

        self.assertIn(waiting, response.context["cl"].result_list)
        self.assertNotIn(member, response.context["cl"].result_list)

    def test_adding_a_person_registers_their_number_for_app_sign_in(self, get_uid, _set):
        response = self.add(name="New Manager", phone_number="+91 90000 00001")

        person = self.User.objects.get(phone_number="+919000000001")
        self.assertRedirects(response, reverse("admin:accounts_user_change", args=[person.pk]))
        get_uid.assert_called_once_with("+919000000001")
        self.assertEqual(person.firebase_uid, "uid-new")
        self.assertEqual(person.name, "New Manager")
        self.assertFalse(person.has_usable_password())
        self.assertFalse(person.is_staff)
        self.assertFalse(PropertyMembership.objects.filter(user=person).exists())

    def test_adding_needs_a_valid_unique_number(self, get_uid, _set):
        self.User.objects.create_user(username="x", phone_number="+919000000001")

        for number in ["", "+447911123456", "+919000000001"]:
            with self.subTest(number=number):
                self.assertEqual(self.add(phone_number=number).status_code, 200)
        get_uid.assert_not_called()
        self.assertEqual(self.User.objects.count(), 2)

    def test_adding_refuses_a_sign_in_that_belongs_to_someone_else(self, get_uid, _set):
        self.User.objects.create_user(username="x", firebase_uid="uid-taken")

        with mock.patch("accounts.services.find_firebase_uid", return_value="uid-taken"):
            response = self.add(phone_number="+919000000001")

        self.assertContains(response, "already belongs to another person")
        get_uid.assert_not_called()  # caught while validating, before Firebase changes
        self.assertFalse(self.User.objects.filter(phone_number="+919000000001").exists())

    def test_a_firebase_outage_while_validating_saves_nothing(self, get_uid, _set):
        with mock.patch(
            "accounts.services.find_firebase_uid", side_effect=FirebaseUnavailableError("down")
        ):
            response = self.add(phone_number="+919000000001")

        self.assertContains(response, "Couldn&#x27;t reach Firebase")
        get_uid.assert_not_called()
        self.assertFalse(self.User.objects.filter(phone_number="+919000000001").exists())

    def test_a_firebase_failure_while_saving_rolls_everything_back(self, get_uid, _set):
        get_uid.side_effect = FirebaseUnavailableError("down")
        url = reverse("admin:accounts_user_add")

        response = self.add(phone_number="+919000000001")

        self.assertRedirects(response, url, fetch_redirect_response=False)
        self.assertFalse(self.User.objects.filter(phone_number="+919000000001").exists())
        messages = [str(m) for m in response.wsgi_request._messages]
        self.assertTrue(any("Couldn't reach Firebase" in m for m in messages))

    def test_change_page_sections_and_property_access(self, *_):
        person = self.User.objects.create_user(
            username="p", firebase_uid="uid-1", phone_number="+919000000001"
        )

        response = self.client.get(reverse("admin:accounts_user_change", args=[person.pk]))

        for text in ["Profile", "Admin portal access", "Technical", "Property access"]:
            self.assertContains(response, text)
        self.assertContains(response, 'name="name"')
        self.assertContains(response, 'name="phone_number"')
        self.assertNotContains(response, 'name="firebase_uid"')  # read-only reference
        self.assertNotContains(response, 'name="first_name"')

    def test_changing_the_number_moves_app_sign_in(self, _get, set_phone):
        person = self.User.objects.create_user(
            username="p", firebase_uid="uid-1", phone_number="+919000000001"
        )
        url = reverse("admin:accounts_user_change", args=[person.pk])
        data = {
            "name": "Renamed Person",
            "phone_number": "+919000000002",
            "email": "",
            "is_active": "on",
            "username": "p",
            "date_joined_0": "2026-10-05",
            "date_joined_1": "10:00:00",
            "property_memberships-TOTAL_FORMS": "0",
            "property_memberships-INITIAL_FORMS": "0",
        }

        response = self.client.post(url, data)

        self.assertEqual(response.status_code, 302)
        set_phone.assert_called_once_with("uid-1", "+919000000002")
        person.refresh_from_db()
        self.assertEqual(person.phone_number, "+919000000002")
        self.assertEqual(person.name, "Renamed Person")

    def test_an_invalid_property_access_row_leaves_firebase_untouched(self, _get, set_phone):
        person = self.User.objects.create_user(
            username="p", firebase_uid="uid-1", phone_number="+919000000001"
        )
        url = reverse("admin:accounts_user_change", args=[person.pk])
        data = {
            "phone_number": "+919000000002",
            "email": "",
            "is_active": "on",
            "username": "p",
            "date_joined_0": "2026-10-05",
            "date_joined_1": "10:00:00",
            "property_memberships-TOTAL_FORMS": "1",
            "property_memberships-INITIAL_FORMS": "0",
            "property_memberships-0-property": str(self.tower.pk),
            "property_memberships-0-role": "",  # missing role: the row is invalid
        }

        response = self.client.post(url, data)

        self.assertEqual(response.status_code, 200)
        set_phone.assert_not_called()
        person.refresh_from_db()
        self.assertEqual(person.phone_number, "+919000000001")

    def test_granting_access_on_the_person_page_records_who_granted_it(self, *_):
        person = self.User.objects.create_user(
            username="p", firebase_uid="uid-1", phone_number="+919000000001"
        )
        url = reverse("admin:accounts_user_change", args=[person.pk])
        data = {
            "phone_number": "+919000000001",
            "email": "",
            "is_active": "on",
            "username": "p",
            "date_joined_0": "2026-10-05",
            "date_joined_1": "10:00:00",
            "property_memberships-TOTAL_FORMS": "1",
            "property_memberships-INITIAL_FORMS": "0",
            "property_memberships-0-property": str(self.tower.pk),
            "property_memberships-0-role": "manager",
            "property_memberships-0-is_active": "on",
        }

        self.assertEqual(self.client.post(url, data).status_code, 302)

        membership = PropertyMembership.objects.get(user=person)
        self.assertEqual(membership.role, "manager")
        self.assertEqual(membership.granted_by, self.admin)
