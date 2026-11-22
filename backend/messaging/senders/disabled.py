from .base import SendOutcome, SendResult


class DisabledSender:
    """No provider configured: nothing can be sent. The runner checks `can_send` and never
    calls send(); if something does, it's refused, never sent."""

    provider = ""
    can_send = False

    def send(self, to: str, body: str) -> SendResult:
        return SendResult(SendOutcome.FAILED, reason="No provider is configured.")
