"""The one HTTP call senders make, behind a small seam so tests fake it and never reach a
provider. Standard library only: no HTTP package to keep up to date for one POST."""

from dataclasses import dataclass
from typing import Callable
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_BODY_BYTES = 64 * 1024  # an answer is a few hundred bytes; never read an unbounded one


@dataclass(frozen=True)
class HttpResponse:
    status: int
    body: bytes


# (url, headers, body, timeout in seconds) -> the answer, whatever its status. Raises on a
# timeout or a connection that failed: the sender decides what those mean.
Post = Callable[[str, dict[str, str], bytes, float], HttpResponse]


class _NoRedirects(HTTPRedirectHandler):
    """Never follow a redirect: urllib would resend our headers, the API key among them, to
    wherever it points (another host, even plain http) and turn the POST into a GET. The 3xx
    comes back as the answer instead."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = build_opener(_NoRedirects)


def urllib_post(url: str, headers: dict[str, str], body: bytes, timeout: float) -> HttpResponse:
    request = Request(url, data=body, headers=headers, method="POST")
    try:
        with _opener.open(request, timeout=timeout) as response:  # https only, checked
            return HttpResponse(response.status, response.read(MAX_BODY_BYTES))
    except HTTPError as error:  # a 3xx, 4xx or 5xx is an answer, not a failure to ask
        with error:
            return HttpResponse(error.code, error.read(MAX_BODY_BYTES))
