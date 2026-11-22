"""Senders, and the one place that picks one: get_sender(), from settings.MESSAGING_PROVIDER."""

import logging

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from .base import MessageSender, SendOutcome, SendResult
from .disabled import DisabledSender
from .fake import FakeSender
from .textbee import DEFAULT_BASE_URL as DEFAULT_TEXTBEE_URL
from .textbee import TextBeeSender

logger = logging.getLogger(__name__)

__all__ = [
    "DisabledSender",
    "FakeSender",
    "MessageSender",
    "SendOutcome",
    "SendResult",
    "TextBeeSender",
    "get_sender",
]


def get_sender() -> MessageSender:
    """The configured provider's sender, or DisabledSender when none is set or its
    credentials are missing. An unknown name is a configuration error, never a silent
    DisabledSender."""
    provider = settings.MESSAGING_PROVIDER
    if not provider:
        return DisabledSender()
    if provider == "textbee":
        if not (settings.TEXTBEE_API_KEY and settings.TEXTBEE_DEVICE_ID):
            # Recorded on each run as a dry run with no provider, so it shows in admin.
            logger.warning("Messaging: TextBee is chosen but its key or device id is missing")
            return DisabledSender()
        return TextBeeSender(
            settings.TEXTBEE_API_KEY,
            settings.TEXTBEE_DEVICE_ID,
            base_url=settings.TEXTBEE_BASE_URL or DEFAULT_TEXTBEE_URL,
        )
    raise ImproperlyConfigured(f"Unknown MESSAGING_PROVIDER: {provider!r}.")
