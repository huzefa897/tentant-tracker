from dataclasses import dataclass

from .base import SendOutcome, SendResult


@dataclass(frozen=True)
class DisabledSender:
    """A provider that can't send here (its credentials aren't set, or it's unknown). The
    runner checks `can_send` and never calls send(); if something does, it's refused, never
    sent. `reason` says why, for the run's record."""

    provider: str = ""
    reason: str = "No provider is configured."
    can_send: bool = False

    def send(self, to: str, body: str) -> SendResult:
        return SendResult(SendOutcome.FAILED, reason=self.reason)
