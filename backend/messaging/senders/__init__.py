"""Senders, and the registry that builds the one a property's settings name (providers.py)."""

from .base import MessageSender, SendOutcome, SendResult
from .disabled import DisabledSender
from .fake import FakeSender
from .providers import Provider, ProviderRegistry, registry
from .textbee import TextBeeSender

__all__ = [
    "DisabledSender",
    "FakeSender",
    "MessageSender",
    "Provider",
    "ProviderRegistry",
    "SendOutcome",
    "SendResult",
    "TextBeeSender",
    "registry",
]
