"""The one interface every provider's sender implements (docs/messaging.md, Providers).

Nothing outside `messaging/senders/` knows a provider's URLs, fields or errors: a sender turns
them into a SendResult and never raises them.
"""

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol


class SendOutcome(StrEnum):
    SENT = "sent"  # the provider accepted it
    FAILED = "failed"  # the provider refused it: nothing went
    UNKNOWN = "unknown"  # a timeout or an answer that couldn't be read: it may have gone


@dataclass(frozen=True)
class SendResult:
    outcome: SendOutcome
    provider_message_id: str = ""
    # Short and safe to store and show: never the number, the key or a whole response body.
    reason: str = ""


class MessageSender(Protocol):
    # The provider's name as recorded on each message, e.g. "textbee"; empty for none.
    provider: str
    # False when nothing can be sent (MESSAGING_ENABLED off, or the provider's credentials not
    # set or set wrong): the runner then holds its messages, sending and reserving nothing, so
    # the months are still due once it can send.
    can_send: bool
    # Why it can't send, for the run's errors and admin; empty when it can.
    reason: str

    def send(self, to: str, body: str) -> SendResult:
        """Sends one SMS to an E.164 number."""
        ...
