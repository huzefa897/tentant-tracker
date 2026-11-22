"""POST /api/v1/messaging/run/, the scheduler's way in (cron-job.org, hourly)."""

from unittest import mock

from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle

from config.tests import REAL_CACHE
from messaging.models import Message, MessageStatus, MessagingRun, RunTrigger
from messaging.senders import FakeSender, registry
from messaging.tests.test_runner import ZAHID, RunnerTestCase, at, nov

URL = "/api/v1/messaging/run/"
TOKEN = "t" * 40


@override_settings(MESSAGING_RUN_TOKEN=TOKEN)
class RunEndpointTests(RunnerTestCase):
    def setUp(self):
        super().setUp()
        patches = [
            mock.patch.object(registry, "sender_for", return_value=self.sender),
            mock.patch("messaging.views.SystemClock", return_value=at(nov(11))),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def post(self, authorization=f"Bearer {TOKEN}", method="post"):
        client = APIClient()
        if authorization is not None:
            client.credentials(HTTP_AUTHORIZATION=authorization)
        return getattr(client, method)(URL)

    def test_runs_and_answers_with_counts_only(self):
        response = self.post()

        self.assertEqual(response.status_code, 200)
        run = MessagingRun.objects.get()
        self.assertEqual(run.trigger, RunTrigger.SCHEDULE)
        self.assertEqual(
            response.json(),
            {
                "run": str(run.pk),
                "dryRun": False,
                "propertiesChecked": 1,
                "planned": 1,
                "sent": 1,
                "failed": 0,
                "unknown": 0,
                "skipped": 0,
                "errors": 0,
                "stoppedEarly": False,
            },
        )
        self.assertEqual(self.messages().get().status, MessageStatus.SENT)
        self.assertNotIn(ZAHID, response.content.decode())
        self.assertNotIn("Zahid", response.content.decode())

    def test_running_twice_sends_once(self):  # TC-09, through the endpoint
        self.post()
        response = self.post()

        self.assertEqual(response.json()["sent"], 0)
        self.assertEqual(len(self.sender.sent), 1)

    def test_the_scheme_is_case_insensitive(self):  # RFC 9110
        response = self.post(f"bearer {TOKEN}")

        self.assertEqual(response.status_code, 200)

    def test_a_wrong_or_missing_token_runs_nothing(self):
        for authorization in (
            None,
            "Bearer wrong",
            f"Bearer {TOKEN[:-1]}",
            f"Token {TOKEN}",
            TOKEN,
            f"Bearer {TOKEN}x",
        ):
            with self.subTest(authorization=authorization):
                response = self.post(authorization)

                self.assertEqual(response.status_code, 403)
        self.assertFalse(MessagingRun.objects.exists())
        self.assertEqual(self.sender.sent, [])

    def test_a_firebase_token_is_not_used(self):
        with mock.patch("accounts.authentication.verify_firebase_token") as verify:
            response = self.post("Bearer firebase-id-token")

        self.assertEqual(response.status_code, 403)
        verify.assert_not_called()

    @override_settings(MESSAGING_RUN_TOKEN="")
    def test_off_without_a_token(self):
        response = self.post("Bearer ")

        self.assertEqual(response.status_code, 404)
        self.assertFalse(MessagingRun.objects.exists())

    def test_post_only(self):
        response = self.post(method="get")

        self.assertEqual(response.status_code, 405)
        self.assertFalse(MessagingRun.objects.exists())

    def test_stops_starting_messages_once_out_of_time(self):
        with mock.patch("messaging.views.settings.MESSAGING_RUN_TIME_BUDGET", 0):
            response = self.post()

        self.assertTrue(response.json()["stoppedEarly"])
        self.assertEqual(response.json()["sent"], 0)
        self.assertFalse(Message.objects.exists())  # nothing reserved: the next run sends it

        response = self.post()

        self.assertEqual(response.json()["sent"], 1)


@override_settings(MESSAGING_RUN_TOKEN=TOKEN, CACHES=REAL_CACHE)
class RunEndpointRateLimitTests(RunnerTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.addCleanup(cache.clear)
        rates = mock.patch.dict(SimpleRateThrottle.THROTTLE_RATES, {"messaging_run": "2/hour"})
        rates.start()
        self.addCleanup(rates.stop)

    def test_limited_per_address_wrong_tokens_included(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION="Bearer wrong")
        with mock.patch.object(registry, "sender_for", return_value=FakeSender()):
            statuses = [client.post(URL).status_code for _ in range(3)]

        self.assertEqual(statuses, [403, 403, 429])

    def test_the_tokens_own_runs_never_use_up_the_limit(self):  # nor lock the scheduler out
        scheduler, stranger = APIClient(), APIClient()
        scheduler.credentials(HTTP_AUTHORIZATION=f"Bearer {TOKEN}")
        stranger.credentials(HTTP_AUTHORIZATION="Bearer wrong")
        with mock.patch("messaging.views.get_sender", return_value=FakeSender()):
            runs = [scheduler.post(URL).status_code for _ in range(3)]
            guesses = [stranger.post(URL).status_code for _ in range(3)]
            after = scheduler.post(URL).status_code

        self.assertEqual((runs, guesses, after), ([200, 200, 200], [403, 403, 429], 200))
