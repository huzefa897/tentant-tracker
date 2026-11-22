import json
import logging

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, override_settings

from messaging.senders import (
    DisabledSender,
    FakeSender,
    SendOutcome,
    SendResult,
    TextBeeSender,
    get_sender,
)
from messaging.senders.http import HttpResponse

TO = "+919000000101"
BODY = "Hi Yusuf, your rent for November 2026 is now due."
KEY = "test-key-not-real"


class FakePost:
    """Stands in for the HTTP call: answers as told, or raises, and records each request."""

    def __init__(self, status=200, body=b"", raises=None):
        self.answer = HttpResponse(status, body)
        self.raises = raises
        self.requests = []

    def __call__(self, url, headers, body, timeout):
        self.requests.append((url, headers, json.loads(body), timeout))
        if self.raises:
            raise self.raises
        return self.answer


class SenderContract:
    """What every provider's sender must do (docs/messaging.md, Providers). A provider's test
    case mixes this in and says how to build its sender and its answers."""

    def make(self, post: FakePost):
        raise NotImplementedError

    def accepted(self) -> FakePost:
        raise NotImplementedError

    def refused(self) -> FakePost:
        raise NotImplementedError

    def send(self, post):
        logs = []
        handler = logging.Handler()
        handler.emit = lambda record: logs.append(record.getMessage())
        root = logging.getLogger("messaging")
        root.addHandler(handler)
        try:
            result = self.make(post).send(TO, BODY)
        finally:
            root.removeHandler(handler)
        logged = "\n".join(logs)
        for private in (TO, BODY, KEY):
            self.assertNotIn(private, logged)  # nothing logged but ids and statuses
            self.assertNotIn(private, result.reason)
        return result

    def test_accepted_is_sent_with_the_providers_id(self):
        result = self.send(self.accepted())

        self.assertEqual(result.outcome, SendOutcome.SENT)
        self.assertTrue(result.provider_message_id)

    def test_refused_is_failed_with_a_reason(self):  # TC-11
        result = self.send(self.refused())

        self.assertEqual(result.outcome, SendOutcome.FAILED)
        self.assertTrue(result.reason)

    def test_a_timeout_is_unknown_never_failed(self):  # TC-12: it may have gone
        result = self.send(FakePost(raises=TimeoutError()))

        self.assertEqual(result.outcome, SendOutcome.UNKNOWN)

    def test_a_dropped_connection_is_unknown(self):
        result = self.send(FakePost(raises=ConnectionResetError()))

        self.assertEqual(result.outcome, SendOutcome.UNKNOWN)

    def test_an_unreadable_answer_is_unknown(self):
        result = self.send(FakePost(200, b"<html>gateway</html>"))

        self.assertEqual(result.outcome, SendOutcome.UNKNOWN)

    def test_a_server_error_is_unknown(self):
        result = self.send(FakePost(502, b"Bad gateway"))

        self.assertEqual(result.outcome, SendOutcome.UNKNOWN)


def textbee_answer(**data):
    return json.dumps({"data": data}).encode()


class TextBeeSenderTests(SenderContract, SimpleTestCase):
    def make(self, post):
        return TextBeeSender(KEY, "device-1", post=post)

    def accepted(self):
        return FakePost(200, textbee_answer(success=True, smsBatchId="batch-1", recipientCount=1))

    def refused(self):
        return FakePost(400, json.dumps({"error": f"Invalid recipient {TO}"}).encode())

    def test_sends_one_sms_to_the_device(self):
        post = self.accepted()

        result = self.send(post)

        self.assertEqual(result.provider_message_id, "batch-1")
        ((url, headers, body, timeout),) = post.requests
        self.assertEqual(url, "https://api.textbee.dev/api/v1/gateway/send-sms")
        self.assertEqual(headers["x-api-key"], KEY)
        self.assertEqual(body, {"recipients": [TO], "message": BODY, "deviceId": "device-1"})
        self.assertEqual(timeout, 10.0)

    def test_each_refusal_says_why(self):
        for status, words in [
            (401, "API key"),
            (403, "account"),
            (404, "device"),
            (429, "plan limit"),
            (422, "refused"),
        ]:
            with self.subTest(status=status):
                result = self.send(FakePost(status, b'{"message": "no"}'))

                self.assertEqual(result.outcome, SendOutcome.FAILED)
                self.assertIn(words, result.reason)

    def test_not_successful_is_failed(self):
        result = self.send(FakePost(200, textbee_answer(success=False, message="No device")))

        self.assertEqual(result.outcome, SendOutcome.FAILED)

    def test_dispatched_at_once_is_sent(self):  # the 200 with counts instead of a batch
        result = self.send(FakePost(200, textbee_answer(successCount=1, failureCount=0)))

        self.assertEqual(result, SendResult(SendOutcome.SENT))

    def test_failed_to_dispatch_is_failed(self):  # so it can be tried again
        result = self.send(FakePost(200, textbee_answer(successCount=0, failureCount=1)))

        self.assertEqual(result.outcome, SendOutcome.FAILED)
        self.assertIn("phone", result.reason)

    def test_counts_that_dont_fit_one_recipient_are_unknown(self):
        for data in [
            {"successCount": 1, "failureCount": 1},
            {"successCount": 0, "failureCount": 0},
            {"successCount": 2, "failureCount": 0},
            {"successCount": True, "failureCount": False},
            {"successCount": "1", "failureCount": "0"},
            {"successCount": 1},
        ]:
            with self.subTest(data=data):
                result = self.send(FakePost(200, textbee_answer(**data)))

                self.assertEqual(result.outcome, SendOutcome.UNKNOWN)

    def test_accepted_without_a_batch_id_is_still_sent(self):
        result = self.send(FakePost(200, textbee_answer(success=True)))

        self.assertEqual(result, SendResult(SendOutcome.SENT))

    def test_needs_a_key_a_device_and_https(self):
        for args, kwargs in [
            (("", "device-1"), {}),
            ((KEY, ""), {}),
            ((KEY, "device-1"), {"base_url": "http://api.textbee.dev/api/v1"}),
        ]:
            with self.subTest(args=args, kwargs=kwargs), self.assertRaises(ImproperlyConfigured):
                TextBeeSender(*args, **kwargs)

    def test_never_shows_its_key(self):
        self.assertNotIn(KEY, repr(self.make(FakePost())))


class GetSenderTests(SimpleTestCase):
    @override_settings(MESSAGING_PROVIDER="")
    def test_no_provider_sends_nothing(self):  # TC-16
        sender = get_sender()

        self.assertIsInstance(sender, DisabledSender)
        self.assertFalse(sender.can_send)

    @override_settings(
        MESSAGING_PROVIDER="textbee", TEXTBEE_API_KEY=KEY, TEXTBEE_DEVICE_ID="device-1"
    )
    def test_textbee(self):
        sender = get_sender()

        self.assertIsInstance(sender, TextBeeSender)
        self.assertEqual(sender.provider, "textbee")
        self.assertTrue(sender.can_send)

    @override_settings(MESSAGING_PROVIDER="textbee", TEXTBEE_API_KEY="", TEXTBEE_DEVICE_ID="d")
    def test_textbee_without_its_key_sends_nothing(self):
        with self.assertLogs("messaging.senders", level="WARNING"):
            sender = get_sender()

        self.assertIsInstance(sender, DisabledSender)

    @override_settings(MESSAGING_PROVIDER="carrier-pigeon")
    def test_an_unknown_provider_is_a_configuration_error(self):
        with self.assertRaises(ImproperlyConfigured):
            get_sender()


class DisabledSenderTests(SimpleTestCase):
    def test_refuses_rather_than_sends(self):
        result = DisabledSender().send("+919000000101", "Hi")

        self.assertEqual(result.outcome, SendOutcome.FAILED)


class FakeSenderTests(SimpleTestCase):
    def test_records_and_answers_as_told(self):
        failed = SendResult(SendOutcome.FAILED, reason="Refused")
        sender = FakeSender(outcomes={"+919000000102": failed})

        self.assertEqual(sender.send("+919000000101", "A").outcome, SendOutcome.SENT)
        self.assertEqual(sender.send("+919000000102", "B"), failed)
        self.assertEqual(sender.sent, [("+919000000101", "A"), ("+919000000102", "B")])
