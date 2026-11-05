from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

BEFORE = [("accounts", "0004_admin_login_attempts")]
AFTER = [("accounts", "0005_google_sign_in")]


class GoogleSignInMigrationTests(TransactionTestCase):
    """accounts.0005 sets phone sign-in identities aside, and its reverse puts them back."""

    def migrate(self, targets):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(targets)
        return executor.loader.project_state(targets).apps

    def tearDown(self):
        # Back to the latest migrations, whatever the test left behind.
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_unlinks_phone_identities_and_can_be_reversed(self):
        User = self.migrate(BEFORE).get_model("accounts", "User")
        User.objects.create(username="owner", firebase_uid="phone-uid", email=" Owner@Example.com")
        User.objects.create(username="admin")

        User = self.migrate(AFTER).get_model("accounts", "User")
        owner = User.objects.get(username="owner")
        self.assertIsNone(owner.firebase_uid)  # the first Google sign-in links them
        self.assertEqual(owner.legacy_phone_firebase_uid, "phone-uid")
        self.assertEqual(owner.email, "owner@example.com")
        self.assertIsNone(User.objects.get(username="admin").legacy_phone_firebase_uid)

        # A Google link made after the deploy is dropped on the way back.
        owner.firebase_uid = "google-uid"
        owner.save()

        User = self.migrate(BEFORE).get_model("accounts", "User")
        self.assertEqual(User.objects.get(username="owner").firebase_uid, "phone-uid")
        self.assertIsNone(User.objects.get(username="admin").firebase_uid)

    def test_people_sharing_an_email_stop_it_before_anything_changes(self):
        User = self.migrate(BEFORE).get_model("accounts", "User")
        first = User.objects.create(username="first", firebase_uid="uid-1", email="Owner@example.com")
        second = User.objects.create(username="second", email="owner@example.com ")
        twin_a = User.objects.create(username="twin-a", email="same@example.com")
        twin_b = User.objects.create(username="twin-b", email="same@example.com")
        User.objects.create(username="admin-one")  # no email: never a clash
        User.objects.create(username="admin-two")

        with self.assertRaises(RuntimeError) as raised:
            self.migrate(AFTER)

        message = str(raised.exception)
        self.assertIn(f"{first.pk}, {second.pk}", message)
        self.assertIn(f"{twin_a.pk}, {twin_b.pk}", message)
        self.assertNotIn("example.com", message)  # deploy logs never get emails
        # Still at 0004, untouched: the phone link and the email as they were.
        User = self.migrate(BEFORE).get_model("accounts", "User")
        kept = User.objects.get(pk=first.pk)
        self.assertEqual((kept.firebase_uid, kept.email), ("uid-1", "Owner@example.com"))

        # Once admin has fixed them, it runs.
        User.objects.filter(pk__in=[second.pk, twin_b.pk]).update(email="")
        User = self.migrate(AFTER).get_model("accounts", "User")
        self.assertEqual(User.objects.get(pk=first.pk).email, "owner@example.com")
