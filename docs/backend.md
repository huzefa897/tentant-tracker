# Backend

Django + DRF + PostgreSQL in `backend/` (setup in `backend/README.md`). The frontend calls it for access (`/me`), tenants (tenancies), rent entries (bills), payments and receipts. PostgreSQL runs in Docker (`docker compose up -d --wait db` from the root, host port 5434); Django runs on the host with pipenv, from `backend/`. Or the whole stack runs in Docker with `docker compose --profile app up` (`backend/README.md`). Commands and the done-gate are in `CLAUDE.md`.

Feature rules live in their own docs: sign-in and property access in [auth-and-access.md](auth-and-access.md), tenancies in [tenants.md](tenants.md), bills in [rent-entries.md](rent-entries.md), payments in [payments-and-receipts.md](payments-and-receipts.md).

## Setup and conventions

- Settings come from the gitignored `backend/.env`; every variable is listed in `backend/.env.example`. Add new ones to both.
- Apps: `accounts`, `properties` (properties, memberships, tenancies), `billing` (rent entries, payments). Tests in `tests.py` or a `tests/` package per app; mock `verify_firebase_token`, never call live Firebase.
- Add packages with `pipenv install <name>` and commit `Pipfile.lock`.
- API JSON is camelCase with explicit serializer fields; never expose whole models.
- DRF requires authentication by default; a public endpoint opts out with `AllowAny` and `authentication_classes([])` (only `/api/v1/health/` and `/api/v1/ready/` today). CORS is not authentication.
- Scope every property query through `properties/queries.py` `properties_for_user` (filter the queryset, so others' records 404 and never appear in lists), not object permissions alone.
- Role permissions live in `properties/roles.py` (`role_can`), never in Django Groups (hidden: they're global, not per property). Owners can do everything; managers manage tenants, record payments and issue receipts, but can't reverse payments, void or correct bills, or manage the property or its members.
- Every API request is rate limited (per address before authentication, then per person, writes more strictly; `config/throttling.py`), and admin login failures are throttled (`config/middleware.py`). Production settings (HTTPS, HSTS, secure cookies, admin path, logging) come from the environment. Details and the rules for changes: [security.md](security.md).
- **Health:** `/api/v1/health/` says the app responds; `/api/v1/ready/` also checks the database (503 `{"status": "unavailable"}`, nothing more, when it can't). Both are public and safe to ping from an uptime monitor: they have their own per-address limit, counted in memory so pings never load the database ([security.md](security.md) item 12). Every `/api/` response carries `Cache-Control: no-store, private`.
- **Production** runs the `backend/Dockerfile` image (Gunicorn, WhiteNoise for admin's static files) behind Caddy: [deployment.md](deployment.md). Management commands: `ledger_summary` (counts, totals and checksums, compared by the restore test), `sheet_to_ledger` and `import_legacy_ledger` ([data-import.md](data-import.md)).

## Talking to it from the app

In development `/api` is proxied to Django on `127.0.0.1:8000` (`vite.config.ts`), so the app calls its own origin and needs no CORS setup; `VITE_API_BASE_URL` overrides it. All calls go through `services/api.ts` (Axios); a request interceptor attaches `Authorization: Bearer <ID token>` from `authService.getIdToken()`, which Firebase caches and refreshes; never store the token. Errors become `ApiError` (`services/apiError.ts`): a 400 is `'invalid-request'` with `fieldErrors`, a 409 is `'conflict'` with the body's other fields in `details` (e.g. `outstandingAmount`), a 429 is `'rate-limited'` (shown as `RATE_LIMITED_MESSAGE`; nothing was done, so trying later is safe). A response interceptor remembers the 429's `Retry-After` (`services/rateLimit.ts`, a minute when it's missing or unreadable), and automatic retries (`useAutoRetry`, `useRouteTenant`, `useRouteEntry`) wait until it has passed, including the immediate retries on `online` and `visibilitychange`; the user's own Retry is never held back.
