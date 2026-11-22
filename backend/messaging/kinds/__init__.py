"""The kinds of message the app can send by hand (messaging/sending.py). Adding one means a
class with `name`, `parse` and `prepare`, listed here; the endpoint, the checks every message
shares, reserving, sending and recording don't change."""

from ..sending import MessageKind
from .bill_reminder import BILL_REMINDER
from .dues_reminder import DUES_REMINDER

KINDS: dict[str, MessageKind] = {kind.name: kind for kind in (BILL_REMINDER, DUES_REMINDER)}


def kind_named(name) -> MessageKind | None:
    return KINDS.get(name) if isinstance(name, str) else None
