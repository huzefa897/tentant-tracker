from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import TestCase
from django.urls import reverse


class UserModelTests(TestCase):
    def test_is_the_configured_user_model(self):
        self.assertEqual(get_user_model()._meta.label, "accounts.User")

    def test_several_users_can_exist_without_a_firebase_uid(self):
        User = get_user_model()
        User.objects.create_user(username="admin-one", password="x")
        User.objects.create_user(username="admin-two", password="x")

        self.assertEqual(User.objects.filter(firebase_uid__isnull=True).count(), 2)

    def test_firebase_uid_is_unique(self):
        User = get_user_model()
        User.objects.create_user(username="one", firebase_uid="uid-1")

        with self.assertRaises(IntegrityError):
            User.objects.create_user(username="two", firebase_uid="uid-1")


class UserAdminTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_superuser(
            username="admin", password="pass", phone_number="+910000000000"
        )
        self.client.force_login(self.admin)

    def test_lists_users(self):
        response = self.client.get(reverse("admin:accounts_user_changelist"))

        self.assertContains(response, "admin")
        self.assertContains(response, "+910000000000")

    def test_change_form_shows_firebase_identity_fields(self):
        response = self.client.get(
            reverse("admin:accounts_user_change", args=[self.admin.pk])
        )

        self.assertContains(response, "Firebase identity")
        self.assertContains(response, 'name="firebase_uid"')
        self.assertContains(response, 'name="phone_number"')
