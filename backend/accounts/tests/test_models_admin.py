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

    def test_email_is_unique_ignoring_case_but_optional(self):
        self.User.objects.create_user(username="one", email="owner@example.com")
        self.User.objects.create_user(username="admin-one")
        self.User.objects.create_user(username="admin-two")

        with self.assertRaises(IntegrityError):
            self.User.objects.create_user(username="two", email="OWNER@example.com")

    def test_clean_lowercases_and_trims_the_email(self):
        user = self.User(username="p", email="  Owner@Example.COM ")
        user.full_clean(exclude=["password"])

        self.assertEqual(user.email, "owner@example.com")

    def test_is_shown_by_name_and_mobile_number_or_username(self):
        self.assertEqual(
            str(self.User(username="x", name="Huzefa Saleem", phone_number="+918977867546")),
            "Huzefa Saleem — +91 89778 67546",
        )
        self.assertEqual(str(self.User(username="x", phone_number="+918977867546")), "+91 89778 67546")
        self.assertEqual(str(self.User(username="x", name="Huzefa Saleem")), "Huzefa Saleem")
        self.assertEqual(str(self.User(username="x", email="o@example.com")), "o@example.com")
        self.assertEqual(str(self.User(username="admin")), "admin")

    def test_name_is_optional_and_tidied(self):
        user = self.User(username="p", name="  Huzefa   Saleem ")
        user.full_clean(exclude=["password"])

        self.assertEqual(user.name, "Huzefa Saleem")
        self.User(username="q").full_clean(exclude=["password"])


CHANGE_FORM = {
    "name": "",
    "phone_number": "",
    "is_active": "on",
    "username": "p",
    "date_joined_0": "2026-10-05",
    "date_joined_1": "10:00:00",
    "property_memberships-TOTAL_FORMS": "0",
    "property_memberships-INITIAL_FORMS": "0",
}


# Firebase is never called: ending sessions when an email changes is mocked.
@mock.patch("accounts.services.revoke_firebase_sessions")
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

    def change(self, person, **data):
        url = reverse("admin:accounts_user_change", args=[person.pk])
        return self.client.post(url, {**CHANGE_FORM, "username": person.username, **data})

    def test_groups_are_hidden(self, _revoke):
        self.assertFalse(admin.site.is_registered(Group))

    def test_list_shows_people_by_name_and_number_with_their_properties(self, _revoke):
        person = self.User.objects.create_user(
            username="firebase-abc",
            firebase_uid="uid-1",
            name="Huzefa Saleem",
            email="h@example.com",
            phone_number="+918977867546",
        )
        PropertyMembership.objects.create(user=person, property=self.tower, role="owner")

        response = self.client.get(reverse("admin:accounts_user_changelist"))

        self.assertContains(response, "Huzefa Saleem — +91 89778 67546")
        self.assertContains(response, "Tower (Owner)")
        self.assertNotContains(response, "firebase-abc")

    def test_people_can_be_found_by_name(self, _revoke):
        found = self.User.objects.create_user(username="a", name="Huzefa Saleem")
        other = self.User.objects.create_user(username="b", name="Someone Else")

        response = self.client.get(reverse("admin:accounts_user_changelist"), {"q": "huzefa"})

        self.assertIn(found, response.context["cl"].result_list)
        self.assertNotIn(other, response.context["cl"].result_list)

    def test_filters_by_app_sign_in(self, _revoke):
        linked = self.User.objects.create_user(username="l", email="l@example.com", firebase_uid="u")
        waiting = self.User.objects.create_user(username="w", email="w@example.com")
        no_email = self.User.objects.create_user(username="n")
        url = reverse("admin:accounts_user_changelist")

        for value, expected in [
            ("yes", {linked, waiting}),
            ("waiting", {waiting}),
            ("no", {no_email, self.admin}),
        ]:
            with self.subTest(value=value):
                response = self.client.get(url, {"app_sign_in": value})
                self.assertEqual(set(response.context["cl"].result_list), expected)

    def test_filters_people_waiting_for_access(self, _revoke):
        waiting = self.User.objects.create_user(username="w", email="w@example.com")
        member = self.User.objects.create_user(username="m", email="m@example.com")
        PropertyMembership.objects.create(user=member, property=self.tower, role="manager")

        response = self.client.get(reverse("admin:accounts_user_changelist"), {"property_access": "no"})

        self.assertIn(waiting, response.context["cl"].result_list)
        self.assertNotIn(member, response.context["cl"].result_list)

    def test_adding_a_person_invites_their_google_email(self, revoke):
        response = self.add(name="New Manager", email=" New@Example.com", phone_number="+91 90000 00001")

        person = self.User.objects.get(email="new@example.com")
        self.assertRedirects(response, reverse("admin:accounts_user_change", args=[person.pk]))
        self.assertIsNone(person.firebase_uid)  # linked at their first sign-in
        self.assertEqual(person.name, "New Manager")
        self.assertEqual(person.phone_number, "+919000000001")
        self.assertFalse(person.has_usable_password())
        self.assertFalse(person.is_staff)
        self.assertFalse(PropertyMembership.objects.filter(user=person).exists())
        revoke.assert_not_called()

    def test_adding_needs_a_valid_unique_email(self, _revoke):
        self.User.objects.create_user(username="x", email="taken@example.com")

        for email in ["", "not-an-email", "TAKEN@example.com"]:
            with self.subTest(email=email):
                self.assertEqual(self.add(email=email).status_code, 200)
        self.assertEqual(self.User.objects.count(), 2)

    def test_the_mobile_number_is_optional_but_validated(self, _revoke):
        self.assertEqual(self.add(email="a@example.com", phone_number="+447911123456").status_code, 200)
        self.assertEqual(self.add(email="a@example.com").status_code, 302)

    def test_change_page_sections_and_property_access(self, _revoke):
        person = self.User.objects.create_user(username="p", firebase_uid="uid-1", email="p@example.com")

        response = self.client.get(reverse("admin:accounts_user_change", args=[person.pk]))

        for text in ["Profile", "Admin portal access", "Technical", "Property access"]:
            self.assertContains(response, text)
        self.assertContains(response, 'name="name"')
        self.assertContains(response, 'name="email"')
        self.assertContains(response, 'name="phone_number"')
        self.assertNotContains(response, 'name="firebase_uid"')  # read-only reference
        self.assertNotContains(response, 'name="first_name"')

    def test_changing_the_email_unlinks_google_and_signs_the_person_out(self, revoke):
        person = self.User.objects.create_user(username="p", firebase_uid="uid-1", email="p@example.com")

        response = self.change(person, name="Renamed Person", email="new@example.com")

        self.assertEqual(response.status_code, 302)
        revoke.assert_called_once_with("uid-1")
        person.refresh_from_db()
        self.assertEqual(person.email, "new@example.com")
        self.assertEqual(person.name, "Renamed Person")
        self.assertIsNone(person.firebase_uid)

    def test_other_changes_keep_the_google_link(self, revoke):
        person = self.User.objects.create_user(username="p", firebase_uid="uid-1", email="p@example.com")

        self.assertEqual(self.change(person, email="P@example.com", name="Renamed").status_code, 302)

        revoke.assert_not_called()
        person.refresh_from_db()
        self.assertEqual(person.firebase_uid, "uid-1")

    def test_a_firebase_failure_while_saving_rolls_everything_back(self, revoke):
        revoke.side_effect = FirebaseUnavailableError("down")
        person = self.User.objects.create_user(username="p", firebase_uid="uid-1", email="p@example.com")

        response = self.change(person, email="", name="Renamed")

        self.assertEqual(response.status_code, 302)
        messages = [str(m) for m in response.wsgi_request._messages]
        self.assertTrue(any("Couldn't reach Firebase" in m for m in messages))
        person.refresh_from_db()
        self.assertEqual((person.email, person.name, person.firebase_uid), ("p@example.com", "", "uid-1"))

    def test_an_invalid_property_access_row_leaves_firebase_untouched(self, revoke):
        person = self.User.objects.create_user(username="p", firebase_uid="uid-1", email="p@example.com")

        response = self.change(
            person,
            email="new@example.com",
            **{
                "property_memberships-TOTAL_FORMS": "1",
                "property_memberships-0-property": str(self.tower.pk),
                "property_memberships-0-role": "",  # missing role: the row is invalid
            },
        )

        self.assertEqual(response.status_code, 200)
        revoke.assert_not_called()
        person.refresh_from_db()
        self.assertEqual(person.email, "p@example.com")

    def test_granting_access_on_the_person_page_records_who_granted_it(self, _revoke):
        person = self.User.objects.create_user(username="p", firebase_uid="uid-1", email="p@example.com")

        response = self.change(
            person,
            email="p@example.com",
            **{
                "property_memberships-TOTAL_FORMS": "1",
                "property_memberships-0-property": str(self.tower.pk),
                "property_memberships-0-role": "manager",
                "property_memberships-0-is_active": "on",
            },
        )

        self.assertEqual(response.status_code, 302)
        membership = PropertyMembership.objects.get(user=person)
        self.assertEqual(membership.role, "manager")
        self.assertEqual(membership.granted_by, self.admin)
