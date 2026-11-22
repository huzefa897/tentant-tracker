"""Gunicorn's access log without Render's health checks (`--logger-class`, render-start.sh).

Render calls the health endpoint every few seconds, which buries real requests in the log. Only
its successful checks are dropped: a failing check, an uptime monitor's ping (another user agent)
and every other request are logged as usual.
"""

from gunicorn.glogging import Logger

HEALTH_PATH = "/api/v1/health/"
RENDER_USER_AGENT_PREFIX = "Render/"


def is_render_health_check(environ: dict, status_code: int | None) -> bool:
    return (
        environ.get("PATH_INFO") == HEALTH_PATH
        and environ.get("HTTP_USER_AGENT", "").startswith(RENDER_USER_AGENT_PREFIX)
        and status_code is not None
        and 200 <= status_code < 300
    )


class QuietHealthCheckLogger(Logger):
    def access(self, resp, req, environ, request_time):
        if is_render_health_check(environ, getattr(resp, "status_code", None)):
            return
        super().access(resp, req, environ, request_time)
