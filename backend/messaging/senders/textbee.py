"""TextBee (textbee.dev): SMS sent through an Android phone running its app.

API (textbee.dev/docs/api-reference, read 2026-11-21): POST {base}/gateway/send-sms with the
`x-api-key` header and {"recipients", "message", "deviceId"}; a 200 answers
{"data": {"success", "smsBatchId", ...}}. 400 (no enabled device, too long, ...), 401 (key),
403 (account), 404 (device) and 429 (plan limit used up) send nothing.

No idempotency key, so a request is never retried here: a timeout may still have sent it,
and the runner's reservation is what stops a second message.
"""

import json
import logging

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from .base import SendOutcome, SendResult
from .http import Post, urllib_post

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.textbee.dev/api/v1"
TIMEOUT_SECONDS = 10.0

# Fixed reasons, never the answer's own text: it could quote the number back.
_REFUSALS = {
    400: "TextBee refused it: no enabled device, or the number or message was rejected.",
    401: "TextBee refused the API key.",
    403: "TextBee says this account can't send messages.",
    404: "TextBee doesn't know the device.",
    429: "TextBee's daily or monthly plan limit is used up.",
}
_REFUSED = "TextBee refused it."
_NOT_DISPATCHED = "TextBee couldn't pass it to the phone."
_UNREADABLE = "TextBee's answer couldn't be read: it may have been sent."
_NO_ANSWER = "TextBee didn't answer in time: it may have been sent."


class TextBeeSender:
    provider = "textbee"
    can_send = True

    def __init__(
        self,
        api_key: str,
        device_id: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = TIMEOUT_SECONDS,
        post: Post = urllib_post,
    ):
        if not api_key or not device_id:
            raise ImproperlyConfigured("TextBee needs an API key and a device id.")
        if not base_url.startswith("https://"):
            raise ImproperlyConfigured("TEXTBEE_BASE_URL must be https: it carries the API key.")
        self._api_key = api_key
        self._device_id = device_id
        self._url = base_url.rstrip("/") + "/gateway/send-sms"
        self._timeout = timeout
        self._post = post

    def __repr__(self) -> str:  # never the key
        return "TextBeeSender()"

    def send(self, to: str, body: str) -> SendResult:
        payload = json.dumps(
            {"recipients": [to], "message": body, "deviceId": self._device_id}
        ).encode()
        headers = {
            "x-api-key": self._api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        try:
            response = self._post(self._url, headers, payload, self._timeout)
        except Exception as exc:  # timeout, refused connection, DNS: it may have gone
            logger.warning("TextBee: no answer (%s)", type(exc).__name__)
            return SendResult(SendOutcome.UNKNOWN, reason=_NO_ANSWER)
        return self._result(response.status, response.body)

    def _result(self, status: int, body: bytes) -> SendResult:
        if 200 <= status < 300:
            try:
                data = json.loads(body)["data"]
                if "successCount" in data or "failureCount" in data:
                    return self._dispatched(data["successCount"], data["failureCount"])
                accepted = data["success"] is True
                batch_id = str(data.get("smsBatchId") or "")
            except (ValueError, KeyError, TypeError):
                logger.warning("TextBee: unreadable answer to a %s", status)
                return SendResult(SendOutcome.UNKNOWN, reason=_UNREADABLE)
            if accepted and batch_id:
                return SendResult(SendOutcome.SENT, provider_message_id=batch_id)
            if accepted:  # accepted, but nothing to match a delivery report to
                logger.warning("TextBee: accepted without a batch id")
                return SendResult(SendOutcome.SENT)
            logger.warning("TextBee: answered %s without success", status)
            return SendResult(SendOutcome.FAILED, reason=_REFUSED)
        if 400 <= status < 500:
            logger.warning("TextBee: refused with %s", status)
            return SendResult(SendOutcome.FAILED, reason=_REFUSALS.get(status, _REFUSED))
        # A 5xx or a redirect: whether it went is unknown.
        logger.warning("TextBee: answered %s", status)
        return SendResult(SendOutcome.UNKNOWN, reason=_UNREADABLE)

    @staticmethod
    def _dispatched(succeeded, failed) -> SendResult:
        """The immediate-dispatch answer: counts of recipients pushed to the phone, not a
        queued batch. There is one recipient, so exactly one of the two must be 1."""
        counts = (succeeded, failed)
        if not all(isinstance(n, int) and not isinstance(n, bool) for n in counts):
            raise TypeError("counts must be whole numbers")
        if counts == (1, 0):
            return SendResult(SendOutcome.SENT)
        if counts == (0, 1):
            logger.warning("TextBee: dispatch failed")
            return SendResult(SendOutcome.FAILED, reason=_NOT_DISPATCHED)
        logger.warning("TextBee: dispatched %s, failed %s, for one recipient", *counts)
        return SendResult(SendOutcome.UNKNOWN, reason=_UNREADABLE)


def textbee_from_settings() -> TextBeeSender | None:
    """The sender from TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID, or None while either is unset."""
    if not (settings.TEXTBEE_API_KEY and settings.TEXTBEE_DEVICE_ID):
        return None
    return TextBeeSender(
        settings.TEXTBEE_API_KEY, settings.TEXTBEE_DEVICE_ID, base_url=settings.TEXTBEE_BASE_URL
    )
