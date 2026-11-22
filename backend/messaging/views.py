"""Messaging's API.

POST /api/v1/messaging/run/: a scheduler (cron-job.org, hourly) starts a run here, since
Render's free plan has no cron (docs/messaging.md, Running it).

Not a person's endpoint: no Firebase, no property scoping. A run sends only what's due and is
safe to repeat, so the token decides only *whether* it runs, never what it sends.
"""

import hmac

from django.conf import settings
from rest_framework import exceptions, status, views
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from billing.views import ScopedLookupMixin
from config.throttling import AddressRateThrottle
from properties.roles import Capability, role_can

from .clock import SystemClock
from .manual import CannotSend, send_bill_reminder
from .models import PropertyMessagingSettings, RunTrigger
from .runner import MessageRunner
from .senders import registry


def _token_matches(request) -> bool:
    if not settings.MESSAGING_RUN_TOKEN:
        return False
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    # Auth schemes are case-insensitive (RFC 9110), so "bearer" is as good as "Bearer".
    return scheme.lower() == "bearer" and hmac.compare_digest(
        token.strip().encode(), settings.MESSAGING_RUN_TOKEN.encode()
    )


class MessagingRunRateThrottle(AddressRateThrottle):
    """Per address (DJANGO_THROTTLE_MESSAGING_RUN). Only refused requests count: guessing the
    token stays slow, but someone who knows the URL (on cron-job.org's shared addresses, say)
    can't use up the limit and lock the real scheduler out. A run is safe to repeat, so the
    token's own runs need no limit."""

    scope = "messaging_run"

    def allow_request(self, request, view):
        return _token_matches(request) or super().allow_request(request, view)


@api_view(["POST"])
@authentication_classes([])  # its own token below, never a person's
@permission_classes([AllowAny])
@throttle_classes([MessagingRunRateThrottle])
def run_messaging(request):
    if not settings.MESSAGING_RUN_TOKEN:
        return Response({"detail": "Not found."}, status=404)
    if not _token_matches(request):
        return Response({"detail": "Not allowed."}, status=403)
    result = MessageRunner(
        SystemClock(),
        trigger=RunTrigger.SCHEDULE,
        time_budget=settings.MESSAGING_RUN_TIME_BUDGET,
    ).run()
    run = result.run
    # Counts only: what was sent to whom is in admin's history.
    return Response(
        {
            "run": str(run.pk),
            "dryRun": run.dry_run,
            "propertiesChecked": run.properties_checked,
            "planned": run.planned,
            "sent": run.sent,
            "failed": run.failed,
            "unknown": run.unknown,
            "skipped": run.skipped,
            "errors": len(run.errors.splitlines()),
            "stoppedEarly": run.stopped_early,
        }
    )


SEND_FORBIDDEN = "Only owners and managers can text tenants."


class CannotSendError(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self, error: CannotSend):
        super().__init__({"code": error.code, "detail": error.detail})


class PropertyMessagingView(ScopedLookupMixin, views.APIView):
    """GET /api/v1/properties/{id}/messaging/: whether the app offers Send SMS here.
    {"enabled", "ready", "canSend"}: messaging on for the property, its provider set up on this
    server, and the person's role allows texting. Never the provider's credentials."""

    def get(self, request, property_id):
        prop = self.get_property()
        settings_ = PropertyMessagingSettings.for_property(prop)
        enabled = settings_.enabled
        ready = enabled and registry.sender_for(settings_.provider).can_send
        return Response(
            {
                "enabled": enabled,
                "ready": ready,
                "canSend": role_can(prop.role, Capability.SEND_MESSAGES),
            }
        )


class BillReminderView(ScopedLookupMixin, views.APIView):
    """POST .../tenancies/{id}/entries/{id}/reminder/: texts the tenant a reminder about this
    bill now (owners and managers). 201 {"status", "reason", "sentAt"}, the message's outcome:
    `sent`, `failed` (send it again) or `unknown` (it may have gone: check before sending
    again; the history is in admin). 409 with a code when nothing was sent: messaging off, SMS
    not set up, a void or paid bill, a number that can't be texted, already sent today.
    No Idempotency-Key: one a day per bill is the guard."""

    def post(self, request, property_id, tenancy_id, entry_id):
        entry = self.get_entry()
        if not role_can(self.get_property().role, Capability.SEND_MESSAGES):
            raise exceptions.PermissionDenied(SEND_FORBIDDEN)
        try:
            sent = send_bill_reminder(entry, request.user, SystemClock())
        except CannotSend as error:
            raise CannotSendError(error) from None
        message = sent.message
        return Response(
            {
                "status": message.status,
                "reason": message.reason,
                "sentAt": message.attempted_at.isoformat() if message.attempted_at else None,
            },
            status=status.HTTP_201_CREATED,
        )
