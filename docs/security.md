# Security

The rules every change follows, what's in place, and what's left. Update the status column in the same change as the work. Audited 2026-10-07; hardened on the `security-fixes` branch the same day.

## Checklist

| #   | Item                             | Status                                                                  |
| --- | -------------------------------- | ----------------------------------------------------------------------- |
| 1   | Protect admin routes             | Done in Django; network restriction and 2FA are hosting/staff decisions |
| 2   | Server-side access, always       | Done (rule)                                                             |
| 3   | Row-level security               | Done in the app; PostgreSQL RLS not used                                |
| 4   | Hash passwords                   | Done (Argon2)                                                           |
| 5   | No auth tokens stored by the app | Done; Firebase keeps its own session (decided)                          |
| 6   | Secrets stay server-side         | Done (rule)                                                             |
| 7   | No secrets in logs               | Done (rule + logging config)                                            |
| 8   | Parameterised SQL                | Done (rule)                                                             |
| 9   | Validate form inputs             | Done (rule)                                                             |
| 10  | Block XSS                        | Done in code, API and Caddy headers; CSP report-only until checked      |
| 11  | Validate uploads                 | Done for the one upload (the Sheet import in admin)                     |
| 12  | Rate-limit all requests          | Done                                                                    |
| 13  | Tighten CORS                     | Done                                                                    |
| 14  | Production settings, DEBUG off   | Done; set by compose.prod.yaml, checked in CI                           |
| 15  | Patch dependencies               | Done; audited in CI, Dependabot weekly                                  |

All settings below come from the environment; `backend/.env.example` lists every variable.

## 1. Protect admin routes

- **Django admin** uses Django's session login and needs `is_staff`. App people get an unusable password (`accounts/admin.py`), so a phone sign-in never opens admin. Admin access and app access are separate permissions ([auth-and-access.md](auth-and-access.md)).
- **Its path** is `DJANGO_ADMIN_PATH` (default `admin/`). Use a non-obvious one in production.
- **Failed logins are throttled** (`config/middleware.py` `AdminLoginThrottleMiddleware`): 5 failures per address and username, or 20 per address across usernames, within 15 minutes, then 429 with `Retry-After`. Each attempt is reserved **before** the password is checked, under a row lock in PostgreSQL (`accounts.AdminLoginAttempts`), so a burst of simultaneous guesses can't slip past the limit and every process shares the count. A refused attempt rolls back, so blocked requests (say, with new usernames) add no rows. A successful login clears that username's count and gives the address its attempt back.
- **App routes**: the guards in `router/index.ts` are UX only. Every API endpoint checks access itself (item 2).
- **Left to hosting and staff:** restrict admin by network or VPN where possible, and consider 2FA for staff (e.g. `django-otp`).

## 2. Server-side access, always

- DRF requires authentication by default (`IsAuthenticated` + `FirebaseAuthentication`). A public endpoint opts out explicitly with `AllowAny` and `authentication_classes([])`; only `/api/v1/health/` and `/api/v1/ready/` do today.
- Every request is checked on the server: never trust a UID, phone number, role, property, tenancy, rate or total from the request. The server derives them from the verified token and the database.
- Role permissions are checked with `properties/roles.py` `role_can` on every write.

## 3. Row-level security

- **In the app (done):** every query is scoped through `properties/queries.py` `properties_for_user`, then the tenancy, then its bills. The queryset is filtered, so another property's records 404 and never appear in lists. Object permissions alone are not enough.
- A tenancy with bills can't move to another property, so bills never change scope ([tenants.md](tenants.md)).
- **PostgreSQL RLS** isn't used: the app connects as one database role. Adding RLS policies would be defence in depth, needing a per-request setting of the user on the connection. Not planned; revisit if anything other than Django gets database access.
- **On a hosted PostgreSQL with its own API** (Supabase): turn that API off. Supabase's Data API publishes the `public` schema to anyone with the project's public key, and without RLS that's every record ([deployment.md](deployment.md#render-and-supabase)).

## 4. Hash passwords

- The app has no passwords: sign-in is a Firebase phone OTP, and Firebase holds the identities.
- Staff passwords for Django admin are hashed with **Argon2** (`PASSWORD_HASHERS`, `argon2-cffi`). Older PBKDF2 hashes still verify and are upgraded at the next login. The password validators in `settings.py` apply.
- Never store or log a password or OTP.

## 5. No auth tokens stored by the app

- The app never stores the Firebase ID token. `services/api.ts` asks `authService.getIdToken()` for it on each request; Firebase caches and refreshes it in memory. Never put a token in `localStorage`, `sessionStorage`, a cookie, a URL or a store.
- **Decided 2026-10-07: keep Firebase's default persistence.** The Firebase SDK keeps its own session (including a refresh token) in IndexedDB (`browserLocalPersistence`), so people stay signed in after a reload. That's Firebase's storage, not the app's: the ID token is short-lived and refreshed by the SDK, and logout clears the session. If that ever needs tightening, `browserSessionPersistence` (per tab) or `inMemoryPersistence` (every reload signs out) is a one-line change in `services/auth.service.ts` (`setPersistence`).

## 6. Secrets stay server-side

- Backend secrets (`DJANGO_SECRET_KEY`, the database password, the Firebase service-account key's path, or its fields as variables) come from the gitignored `backend/.env`. The service-account JSON lives outside the repository. The key as variables is named so Django's error pages mask it (`FIREBASE_SERVICE_ACCOUNT_KEY`); never log it. In production they come from the gitignored `.env.production` on the server, each container gets only the ones it needs, and the key is mounted read-only; neither image contains any (their `.dockerignore` files are allowlists). [deployment.md](deployment.md) says how to keep a copy for recovery.
- `VITE_*` variables are bundled into the app and are **public**: never put a secret in one. The Firebase web config is public by design.
- Apps Script secrets live in Script Properties, never in the code. The repo is public: never commit tenant data, phone numbers, emails, sheet or script IDs.

## 7. No secrets in logs

- Never log tokens, `Authorization` headers, OTPs, passwords, request bodies or full phone numbers. Log ids (`user.pk`) instead.
- **Logging config** (`LOGGING` in `settings.py`): plain console logs at `DJANGO_LOG_LEVEL`, collected by the host. Django's `mail_admins` handler is not used, since it would email request details.
- **What's logged today:**
  - `accounts/services.py` logs a user id.
  - `accounts/firebase.py` logs exceptions when Firebase is unavailable. Invalid tokens aren't logged.
  - `django.request` logs the path of 4xx and 5xx responses, not their headers or bodies.
- **When hosting:** make sure the proxy's access logs don't record the `Authorization` header.

## 8. Parameterised SQL

- Use the Django ORM only. No `raw()`, `extra()`, `RawSQL` or `cursor()` in app code (none today, outside migrations). If raw SQL is ever unavoidable, pass values as parameters, never by string formatting.
- Query-string filters are validated before they reach a queryset (e.g. `?year=` is 0001–9999, `?billing_month=` is `YYYY-MM`), so bad input is a 400, never a 500.

## 9. Validate form inputs

- Validated on both sides. The app's validation (`utils/*Validation.ts`) is for UX; the backend is the authority: serializers with explicit fields, model `clean()`, and database constraints behind both.
- Serializers refuse unknown, server-assigned and derived fields rather than ignoring them. Money is `Decimal` on the server, with limits matching the columns.

## 10. Block XSS

- Vue escapes text interpolation. Never use `v-html` or `innerHTML` with user data (notes, names); none does today. Never build URLs from user input without encoding (`encodeURIComponent`).
- Redirects after login only follow same-app paths (`?redirect=`).
- The API returns JSON only; receipts are generated as PDFs with jsPDF text.
- **Django's responses** carry `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Cross-Origin-Opener-Policy: same-origin` and `X-Frame-Options: DENY`, stated explicitly in `settings.py` and tested.
- **The app's headers** come from Caddy ([deploy/web/Caddyfile](../deploy/web/Caddyfile)): the same four, plus HSTS and a **Content-Security-Policy**, sent as `Content-Security-Policy-Report-Only` until phone sign-in (reCAPTCHA) has been checked against it in the browser, then switched to enforcing ([deployment.md](deployment.md), first deploy). The policy:

  ```
  default-src 'self';
  script-src 'self' https://www.google.com https://www.gstatic.com https://apis.google.com;
  frame-src https://www.google.com https://<VITE_FIREBASE_AUTH_DOMAIN>;
  connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com;
  img-src 'self' data:;
  font-src 'self' data:;
  style-src 'self' 'unsafe-inline';
  object-src 'none';
  base-uri 'self';
  frame-ancestors 'none'
  ```

  With a separate API domain, add its origin to `connect-src`. Add a source only when a reported violation needs it.

## 11. Validate uploads

The only upload is the Google Sheet import on a property's admin page ([data-import.md](data-import.md), `billing/sheet_import.py`). It's for superusers only, checks the size (5 MB) on the server, checks the file is a zip by its content and refuses one that would unpack to more than 50 MB or 2,000 entries, and parses its XML through `defusedxml` (which `openpyxl` uses when it's installed). It's read in memory (`FILE_UPLOAD_MAX_MEMORY_SIZE`) and never stored or served; between steps the converted data is signed for that property and admin, and expires after an hour.

For any future upload:

- Check size on the server, and set `DATA_UPLOAD_MAX_MEMORY_SIZE` and `FILE_UPLOAD_MAX_MEMORY_SIZE`.
- Check the type by content, not the name or `Content-Type`, and allow a short list of types.
- Store files under random names outside the web root, or in object storage.
- Serve them from another origin, with `Content-Disposition: attachment` where possible.
- Scope them through `properties_for_user` like any other record.

## 12. Rate-limit all requests

Every API request is limited (`config/throttling.py`); over a limit is 429 with `Retry-After`, and the app says to wait a minute (`ApiError` `'rate-limited'`, `RATE_LIMITED_MESSAGE`). There are three limits:

- **Per address, before authentication** (`ApiRateLimitMiddleware`, `DJANGO_THROTTLE_ADDRESS`, default 300/minute). It covers every `/api/` request except the health and readiness checks (below). It's middleware because DRF checks its throttles only after authentication and permissions, so requests with no token or a bad one would otherwise never be counted.
- **Per signed-in person** (`UserRateThrottle`, `DJANGO_THROTTLE_USER`, default 300/minute).
- **Writes per person** (`WriteRateThrottle`, `DJANGO_THROTTLE_WRITES`, default 30/minute), e.g. creating bills.

**The public health and readiness checks** (`/api/v1/health/`, `/api/v1/ready/`) have their own, stricter limit instead (`HealthCheckRateThrottle`, `DJANGO_THROTTLE_HEALTH`, default 10/minute per address, shared by the two), and no per-person limits. Their counts are always kept in the process's memory (the `health` cache, bounded to 1,000 addresses), never in PostgreSQL, so a flood of pings costs no database work: health makes no queries at all, readiness only its `SELECT 1`. Each worker counts separately, so the effective limit is up to `WEB_CONCURRENCY` times the rate. An uptime monitor every few minutes, and Docker's own check every 30 seconds, are far below it.

Admin login is throttled separately (item 1). OTP abuse is limited by Firebase and reCAPTCHA; consider Firebase App Check.

In production:

- **Proxies:** behind a proxy, set `DJANGO_NUM_PROXIES` to how many there are, so each client's own address is read from `X-Forwarded-For`. Without it, every client shares the proxy's address. It defaults to `0`, which ignores `X-Forwarded-For`: clients can forge that header, so it's only trusted for the proxies you declare (never `None`, which would make DRF trust the whole header and let anyone dodge the limits). This applies to the admin login throttle too.
- **Shared counts:** the default local-memory cache is per process, so with N worker processes a person effectively gets N times each limit. With more than one process, set `DJANGO_SHARED_CACHE=true` to keep counts in PostgreSQL (Django's database cache, table `django_cache`; run `manage.py createcachetable` once per database). Redis isn't used (decided 2026-10-07).
- **Proxy limits:** Caddy has no rate limiting without a plugin, so the app's limits are the ones that apply. Add proxy limits if traffic ever calls for them.
- **Floods from many addresses:** per-address limits stop one client, not a distributed attack, which still reaches the server and uses its bandwidth and Caddy's connections before any limit applies. Protection from that is at the network edge (e.g. a proxying CDN such as Cloudflare in front of the domain), not in the app.

The database-backed limits **fail open**: if the counts can't be read (the database is down, or `createcachetable` wasn't run), the request goes through and a warning is logged, so a rate limit never takes the app down and readiness can still report the database as unavailable.

Tests run with a dummy cache (`config/test_runner.py`), so limits don't carry over between tests. The rate-limit tests turn a real cache back on.

## 13. Tighten CORS

- `CORS_ALLOWED_ORIGINS` is an explicit list from the environment: no wildcards, no `CORS_ALLOW_ALL_ORIGINS`. In production, list only the app's own origin. In development the Vite proxy means the list can stay empty.
- Only `/api/` sends CORS headers (`CORS_URLS_REGEX`); admin is same-origin only.
- Allowed request headers are django-cors-headers' defaults plus `Idempotency-Key` (`CORS_ALLOW_HEADERS`), which saving a bill or recording a payment sends. A new custom request header must be added there too, or browsers on another origin (the Render static site) block the request.
- Credentials are never allowed (`CORS_ALLOW_CREDENTIALS = False`): the API uses bearer tokens, not cookies.
- CORS is not authentication: it only controls which browser origins may read responses.

## 14. Production settings, DEBUG off

- `DEBUG` defaults to off (`DJANGO_DEBUG` must be `true` to turn it on), and `ALLOWED_HOSTS` comes from the environment.
- **HTTPS:**
  - `DJANGO_SECURE_SSL_REDIRECT` redirects to HTTPS.
  - `DJANGO_SECURE_HSTS_SECONDS` and `DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS` set HSTS: once a browser has visited over HTTPS, it refuses plain http for that long. **HSTS preload** (left out, its check silenced) would go further: submitting the domain to a list built into browsers, so even a first visit is HTTPS-only. It applies to the whole domain and every subdomain and takes months to undo, so it's only worth it once the domain is dedicated to HTTPS for good.
  - Behind a TLS proxy, set `DJANGO_BEHIND_HTTPS_PROXY` to trust its `X-Forwarded-Proto`, so redirects don't loop.
  - These default to off, so local http development and tests work.
- **Cookies:** admin's session and CSRF cookies are HTTPS-only unless `DEBUG` is on (`DJANGO_SECURE_COOKIES` overrides). `DJANGO_CSRF_TRUSTED_ORIGINS` lists admin's HTTPS origin if it's behind a proxy.
- **Email:** the app sends none yet. The backend is console in development and SMTP otherwise (`DJANGO_EMAIL_BACKEND`).
- **CI** runs `manage.py check --deploy --fail-level WARNING` with production-like settings, so a setting that weakens production fails the build.
- **Database connections over the internet** use TLS: `POSTGRES_SSLMODE=require` (libpq's `sslmode`) refuses an unencrypted connection. Unset, the default (`prefer`) only encrypts when the server offers it, which is fine on one machine or Docker network. `require` doesn't verify the server's certificate; `verify-full` with the provider's CA certificate would.
- **In production** `compose.prod.yaml` sets all of these (DEBUG off, the HTTPS redirect, HSTS, secure cookies, the proxy settings, shared rate-limit counts), from `.env.production` where they vary ([deployment.md](deployment.md)). On Render, `render.yaml` sets the same ones.
- **Caching:** every `/api/` response carries `Cache-Control: no-store, private` (`ApiNoStoreMiddleware`), so no browser, proxy or CDN keeps people's records.

## 15. Patch dependencies

- **CI** fails on high or critical npm advisories in what ships to browsers (`npm audit --omit=dev --audit-level=high`), and on any known vulnerability in the locked Python packages (`pip-audit` over `pipenv requirements --hash`).
- **Dependabot** (`.github/dependabot.yml`) opens weekly grouped updates for npm, pip and GitHub Actions, and security updates as advisories appear.
- **Decisions made on 2026-10-07:**
  - `shadcn-vue` is a dev dependency: it's a CLI plus one CSS import at build time.
  - `@grpc/grpc-js` is overridden to a patched version (`overrides` in `package.json`). It comes with Firebase's Firestore, which the app doesn't use or bundle, and every Firebase release pins an affected version. Remove the override once Firebase moves past it.
  - What `npm audit` still reports is development and build tooling only: `braces` and `decode-uri-component` (via Vite's optional `stylus`), and `sprintf-js` and `node-forge` (via the shadcn CLI). None of it ships to browsers. Dependabot picks up fixes as they're released.
