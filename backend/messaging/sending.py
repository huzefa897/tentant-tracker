"""Sending one message by hand, now: the steps every kind of message shares (docs/messaging.md,
Sent by hand).

A kind (messaging/kinds/) says what its message is about and when it may go: it reads its
request, then, inside the transaction, takes its locks, checks what it needs and writes the
text. Everything else is here, the same for every kind and as safe as a run: messaging on for
the property, its provider set up, a number that can be texted, the message reserved (`queued`)
and committed before the sender is called, then sent outside the transaction and recorded
(`runner.deliver`). A kind's own records (e.g. a reminder's item) are written with the message,
in the same transaction.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

from django.db import transaction

from .clock import Clock
from .models import Message, MessageStatus, MessageType, PropertyMessagingSettings
from .runner import can_text, deliver
from .senders import MessageSender, SendResult, registry
from .senders.providers import MESSAGING_OFF as SERVER_SWITCH_OFF

# Why nothing was sent, for every kind: a code for the app and a sentence for people. A kind
# adds its own (CannotSend(code, detail)).
REFUSALS = {
    "messaging_off": "Messaging is off for this property.",
    "server_off": "Messaging is off on the server.",
    "provider_not_set_up": "SMS isn't set up on the server yet.",
    "number_untextable": "The tenant's mobile number can't be texted. Check it on their page.",
}


class CannotSend(Exception):
    """Nothing was sent, and why. Raised fresh each time, never a shared instance: a raise
    writes its traceback onto the exception."""

    def __init__(self, code: str, detail: str | None = None):
        self.code = code
        self.detail = detail if detail is not None else REFUSALS[code]
        super().__init__(self.detail)


class InvalidRequest(Exception):
    """The request doesn't say what to send: a field and why (400)."""

    def __init__(self, field_name: str, detail: str):
        self.field = field_name
        self.detail = detail
        super().__init__(detail)


@dataclass(frozen=True)
class Draft:
    """What a kind wants sent: the message's type and text, and its own records to write with
    the message (called inside the transaction, once the message exists)."""

    type: MessageType
    body: str
    record: Callable[[Message], None] = field(default=lambda message: None)


class MessageKind(Protocol):
    # The name the app sends ({"kind": ...}); never shown to people.
    name: str

    def parse(self, tenancy, data: Mapping[str, Any]) -> Any:
        """What this message is about, from the request, within this tenancy: raises
        InvalidRequest (400) or Http404. Outside the transaction; takes no locks."""

    def prepare(self, tenancy, subject: Any, today) -> Draft:
        """Inside the transaction: takes the kind's locks, checks again what it depends on
        (raising CannotSend) and writes the text. `today` is the property's local date."""


@dataclass(frozen=True)
class Sent:
    message: Message
    result: SendResult


def send_now(
    tenancy, kind: MessageKind, subject: Any, user, clock: Clock, senders=None
) -> Sent:
    """Texts the tenant one message of this kind now, or raises CannotSend having sent
    nothing. `subject` is what kind.parse returned."""
    settings = PropertyMessagingSettings.for_property(tenancy.property)
    if not settings.enabled:
        raise CannotSend("messaging_off")
    sender: MessageSender = (senders or registry.sender_for)(settings.provider)
    if not sender.can_send:
        off = sender.reason == SERVER_SWITCH_OFF
        raise CannotSend("server_off" if off else "provider_not_set_up")
    today = settings.local_date(clock)

    with transaction.atomic():
        draft = kind.prepare(tenancy, subject, today)
        if not can_text(tenancy.mobile_number):
            raise CannotSend("number_untextable")
        message = Message.objects.create(
            tenancy=tenancy,
            sent_by=user,
            type=draft.type,
            status=MessageStatus.QUEUED,
            local_date=today,
            recipient=tenancy.mobile_number,
            body=draft.body,
            provider=sender.provider,
        )
        draft.record(message)

    return Sent(message, deliver(message, sender))
