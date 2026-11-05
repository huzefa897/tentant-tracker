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
