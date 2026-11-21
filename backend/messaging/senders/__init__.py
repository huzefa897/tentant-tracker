"""Senders, and the one place that picks one: get_sender(), from settings.MESSAGING_PROVIDER."""

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from .base import MessageSender, SendOutcome, SendResult
from .disabled import DisabledSender
from .fake import FakeSender

__all__ = [
    "DisabledSender",
    "FakeSender",
    "MessageSender",
    "SendOutcome",
    "SendResult",
    "get_sender",
]


def get_sender() -> MessageSender:
    """The configured provider's sender, or DisabledSender when none is set. An unknown name
    is a configuration error, never a silent DisabledSender."""
    provider = settings.MESSAGING_PROVIDER
    if not provider:
        return DisabledSender()
    raise ImproperlyConfigured(f"Unknown MESSAGING_PROVIDER: {provider!r}.")
