from dataclasses import dataclass, field

from .base import SendOutcome, SendResult


@dataclass
class FakeSender:
    """For tests: records what it's asked to send and answers as told. `outcomes` maps a number
    to its answer (sent by default); `raises` maps one to an error to raise, as a broken sender
    would."""

    provider: str = "fake"
    can_send: bool = True
    reason: str = ""
    outcomes: dict[str, SendResult] = field(default_factory=dict)
    raises: dict[str, Exception] = field(default_factory=dict)
    sent: list[tuple[str, str]] = field(default_factory=list)

    def send(self, to: str, body: str) -> SendResult:
        self.sent.append((to, body))
        if to in self.raises:
            raise self.raises[to]
        return self.outcomes.get(
            to, SendResult(SendOutcome.SENT, provider_message_id=f"fake-{len(self.sent)}")
        )
