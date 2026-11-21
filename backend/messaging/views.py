"""POST /api/v1/messaging/run/: a scheduler (cron-job.org, hourly) starts a run here, since
Render's free plan has no cron (docs/messaging.md, Running it).

Not a person's endpoint: no Firebase, no property scoping. A run sends only what's due and is
safe to repeat, so the token decides only *whether* it runs, never what it sends.
"""

import hmac

from django.conf import settings
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from config.throttling import MessagingRunRateThrottle

from .clock import SystemClock
from .models import RunTrigger
from .runner import MessageRunner
from .senders import get_sender


def _token_matches(request) -> bool:
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    return scheme == "Bearer" and hmac.compare_digest(
        token.strip().encode(), settings.MESSAGING_RUN_TOKEN.encode()
    )


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
        get_sender(),
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
