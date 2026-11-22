"""The providers messaging can send with, and the one place that builds their senders.

A property picks a provider by name in admin (PropertyMessagingSettings.provider); its
credentials stay in the environment (TEXTBEE_API_KEY, ...), never in the database, so a
restored backup or a developer's machine can't text anyone. Nothing sends while the server's
own switch, MESSAGING_ENABLED, is off. A provider whose credentials aren't set, or are set
wrong, gives a DisabledSender saying why, never an error: the runner asks for a sender, and
admin for the provider's status, which checks the credentials whether or not the switch is on.

Adding a provider: one sender class, its settings, and one `registry.register(...)` below.
"""

import logging
from dataclasses import dataclass
from typing import Callable

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured, ValidationError

from .base import MessageSender
from .disabled import DisabledSender
from .textbee import textbee_from_settings

logger = logging.getLogger(__name__)

DEFAULT_PROVIDER = "textbee"
MESSAGING_OFF = "Messaging is off on this server: set MESSAGING_ENABLED=true to send."
READY = "Ready"
READY_BUT_OFF = "Ready, but messaging is off on this server (MESSAGING_ENABLED)."
BUILD_FAILED = "its settings couldn't be read."


@dataclass(frozen=True)
class Provider:
    name: str  # stored on settings and messages: never rename one in use
    label: str  # shown in admin
    # Its sender from settings, or None while its credentials aren't set.
    build: Callable[[], MessageSender | None]
    # Which settings it needs, said when they're missing.
    needs: str


class ProviderRegistry:
    def __init__(self):
        self._providers: dict[str, Provider] = {}

    def register(self, provider: Provider) -> None:
        if provider.name in self._providers:
            raise ValueError(f"Provider {provider.name!r} is already registered.")
        self._providers[provider.name] = provider

    def choices(self) -> list[tuple[str, str]]:
        return [(p.name, p.label) for p in self._providers.values()]

    def validate(self, name: str) -> None:
        if name not in self._providers:
            raise ValidationError(
                "%(name)s isn't a provider messaging knows.",
                code="unknown_provider",
                params={"name": name},
            )

    def sender_for(self, name: str) -> MessageSender:
        """The provider's sender, or a DisabledSender saying why nothing can be sent. Never
        raises: admin shows this, and a setting set wrong must not take its pages down."""
        if not settings.MESSAGING_ENABLED:
            return DisabledSender(name, MESSAGING_OFF)
        return self._build(name)

    def status(self, name: str) -> str:
        """For admin: whether the provider's credentials are there and right, said apart from
        the server's switch, so they can be checked before messaging is turned on."""
        sender = self._build(name)
        if not sender.can_send:
            return sender.reason
        return READY if settings.MESSAGING_ENABLED else READY_BUT_OFF

    def _build(self, name: str) -> MessageSender:
        provider = self._providers.get(name)
        if provider is None:
            return DisabledSender(name, f"{name!r} isn't a provider messaging knows.")
        try:
            sender = provider.build()
        except ImproperlyConfigured as exc:  # our own wording, never a credential
            return DisabledSender(name, f"{provider.label} isn't set up: {exc}")
        except Exception as exc:  # a setting of the wrong type, say: its text could quote it
            logger.error(
                "Messaging: building the %s sender failed with %s", name, type(exc).__name__
            )
            return DisabledSender(name, f"{provider.label} isn't set up: {BUILD_FAILED}")
        if sender is None:
            return DisabledSender(name, f"{provider.label} isn't set up: set {provider.needs}.")
        return sender


registry = ProviderRegistry()
registry.register(
    Provider(
        "textbee",
        "TextBee",
        textbee_from_settings,
        needs="TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID",
    )
)


def provider_choices() -> list[tuple[str, str]]:
    return registry.choices()


def validate_provider(name: str) -> None:
    registry.validate(name)
