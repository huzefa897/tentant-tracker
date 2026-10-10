"""The container's health check: `python -m config.healthcheck` exits 0 when the app is ready.

Calls the readiness endpoint on this container over plain http (exempt from the HTTPS redirect),
with a Host header Django allows. Standard library only, so it doesn't load Django.
"""

import os
import sys
import urllib.request


def main() -> int:
    hosts = [h.strip() for h in os.getenv("DJANGO_ALLOWED_HOSTS", "").split(",") if h.strip()]
    host = hosts[0].lstrip(".") if hosts else "localhost"
    request = urllib.request.Request(
        "http://127.0.0.1:8000/api/v1/ready/", headers={"Host": host}
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return 0 if response.status == 200 else 1
    except OSError:
        return 1


if __name__ == "__main__":
    sys.exit(main())
