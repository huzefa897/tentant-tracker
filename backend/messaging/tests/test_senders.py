from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, override_settings

from messaging.senders import DisabledSender, FakeSender, SendOutcome, SendResult, get_sender


class GetSenderTests(SimpleTestCase):
    @override_settings(MESSAGING_PROVIDER="")
    def test_no_provider_sends_nothing(self):  # TC-16
        sender = get_sender()

        self.assertIsInstance(sender, DisabledSender)
        self.assertFalse(sender.can_send)

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
