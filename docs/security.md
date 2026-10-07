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
| 10  | Block XSS                        | Done in code and API headers; the app's CSP is set where it's hosted    |
| 11  | Validate uploads                 | Rule, for when uploads arrive                                           |
| 12  | Rate-limit all requests          | Done                                                                    |
| 13  | Tighten CORS                     | Done                                                                    |
| 14  | Production settings, DEBUG off   | Done; checked in CI                                                     |
| 15  | Patch dependencies               | Done; audited in CI, Dependabot weekly                                  |

All settings below come from the environment; `backend/.env.example` lists every variable.

## 1. Protect admin routes

- **Django admin** uses Django's session login and needs `is_staff`. App people get an unusable password (`accounts/admin.py`), so a phone sign-in never opens admin. Admin access and app access are separate permissions ([auth-and-access.md](auth-and-access.md)).
- **Its path** is `DJANGO_ADMIN_PATH` (default `admin/`). Use a non-obvious one in production.
- **Failed logins are throttled** (`config/middleware.py` `AdminLoginThrottleMiddleware`): 5 failures per address and username, or 20 per address across usernames, within 15 minutes, then 429 with `Retry-After`. A successful login clears that username's count.
- **App routes**: the guards in `router/index.ts` are UX only. Every API endpoint checks access itself (item 2).
- **Left to hosting and staff:** restrict admin by network or VPN where possible, and consider 2FA for staff (e.g. `django-otp`).

## 2. Server-side access, always

- DRF requires authentication by default (`IsAuthenticated` + `FirebaseAuthentication`). A public endpoint opts out explicitly with `AllowAny` and `authentication_classes([])`; only `/api/v1/health/` does today.
- Every request is checked on the server: never trust a UID, phone number, role, property, tenancy, rate or total from the request. The server derives them from the verified token and the database.
- Role permissions are checked with `properties/roles.py` `role_can` on every write.

## 3. Row-level security

- **In the app (done):** every query is scoped through `properties/queries.py` `properties_for_user`, then the tenancy, then its bills. The queryset is filtered, so another property's records 404 and never appear in lists. Object permissions alone are not enough.
- A tenancy with bills can't move to another property, so bills never change scope ([tenants.md](tenants.md)).
- **PostgreSQL RLS** isn't used: the app connects as one database role. Adding RLS policies would be defence in depth, needing a per-request setting of the user on the connection. Not planned; revisit if anything other than Django gets database access.

## 4. Hash passwords

- The app has no passwords: sign-in is a Firebase phone OTP, and Firebase holds the identities.
- Staff passwords for Django admin are hashed with **Argon2** (`PASSWORD_HASHERS`, `argon2-cffi`). Older PBKDF2 hashes still verify and are upgraded at the next login. The password validators in `settings.py` apply.
- Never store or log a password or OTP.

## 5. No auth tokens stored by the app

- The app never stores the Firebase ID token. `services/api.ts` asks `authService.getIdToken()` for it on each request; Firebase caches and refreshes it in memory. Never put a token in `localStorage`, `sessionStorage`, a cookie, a URL or a store.
- **Decided 2026-10-07: keep Firebase's default persistence.** The Firebase SDK keeps its own session (including a refresh token) in IndexedDB (`browserLocalPersistence`), so people stay signed in after a reload. That's Firebase's storage, not the app's: the ID token is short-lived and refreshed by the SDK, and logout clears the session. If that ever needs tightening, `browserSessionPersistence` (per tab) or `inMemoryPersistence` (every reload signs out) is a one-line change in `services/auth.service.ts` (`setPersistence`).

## 6. Secrets stay server-side

- Backend secrets (`DJANGO_SECRET_KEY`, the database password, the Firebase service-account key path) come from the gitignored `backend/.env`. The service-account JSON lives outside the repository. In production, use the host's secret store.
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
- **The app's Content-Security-Policy** is set by whatever serves the built app; it isn't hosted yet. Start from this policy and check that phone sign-in (reCAPTCHA) still works in staging before tightening:

  ```
  default-src 'self';
  script-src 'self' https://www.google.com https://www.gstatic.com https://apis.google.com;
  frame-src https://www.google.com https://<firebase-project>.firebaseapp.com;
  connect-src 'self' <api-origin> https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com;
  img-src 'self' data:;
  font-src 'self' data:;
  style-src 'self' 'unsafe-inline';
  object-src 'none';
  base-uri 'self';
  frame-ancestors 'none'
  ```

## 11. Validate uploads (future)

There are no uploads today. When they arrive:

- Check size on the server, and set `DATA_UPLOAD_MAX_MEMORY_SIZE` and `FILE_UPLOAD_MAX_MEMORY_SIZE`.
- Check the type by content, not the name or `Content-Type`, and allow a short list of types.
- Store files under random names outside the web root, or in object storage.
- Serve them from another origin, with `Content-Disposition: attachment` where possible.
- Scope them through `properties_for_user` like any other record.

## 12. Rate-limit all requests

Every API request is limited (`config/throttling.py`); over a limit is 429 with `Retry-After`, and the app says to wait a minute (`ApiError` `'rate-limited'`, `RATE_LIMITED_MESSAGE`). There are three limits:

- **Per address, before authentication** (`ApiRateLimitMiddleware`, `DJANGO_THROTTLE_ADDRESS`, default 300/minute). It covers every `/api/` request. It's middleware because DRF checks its throttles only after authentication and permissions, so requests with no token or a bad one would otherwise never be counted.
- **Per signed-in person** (`UserRateThrottle`, `DJANGO_THROTTLE_USER`, default 300/minute).
- **Writes per person** (`WriteRateThrottle`, `DJANGO_THROTTLE_WRITES`, default 30/minute), e.g. creating bills.

Admin login is throttled separately (item 1). OTP abuse is limited by Firebase and reCAPTCHA; consider Firebase App Check.

In production:

- **Proxies:** behind a proxy, set `DJANGO_NUM_PROXIES` so each client's own address is used (from `X-Forwarded-For`). Without it, every client shares the proxy's address.
- **Shared counts:** the default local-memory cache is per process, so with N worker processes a person effectively gets N times each limit. With more than one process, set `DJANGO_SHARED_CACHE=true` to keep counts in PostgreSQL (Django's database cache, table `django_cache`; run `manage.py createcachetable` once per database). Redis isn't used (decided 2026-10-07).
- **Proxy limits:** add limits at the proxy as well.

Tests run with a dummy cache (`config/test_runner.py`), so limits don't carry over between tests. The rate-limit tests turn a real cache back on.

## 13. Tighten CORS

- `CORS_ALLOWED_ORIGINS` is an explicit list from the environment: no wildcards, no `CORS_ALLOW_ALL_ORIGINS`. In production, list only the app's own origin. In development the Vite proxy means the list can stay empty.
- Only `/api/` sends CORS headers (`CORS_URLS_REGEX`); admin is same-origin only.
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

## 15. Patch dependencies

- **CI** fails on high or critical npm advisories in what ships to browsers (`npm audit --omit=dev --audit-level=high`), and on any known vulnerability in the locked Python packages (`pip-audit` over `pipenv requirements --hash`).
- **Dependabot** (`.github/dependabot.yml`) opens weekly grouped updates for npm, pip and GitHub Actions, and security updates as advisories appear.
- **Decisions made on 2026-10-07:**
  - `shadcn-vue` is a dev dependency: it's a CLI plus one CSS import at build time.
  - `@grpc/grpc-js` is overridden to a patched version (`overrides` in `package.json`). It comes with Firebase's Firestore, which the app doesn't use or bundle, and every Firebase release pins an affected version. Remove the override once Firebase moves past it.
  - What `npm audit` still reports is development and build tooling only: `braces` and `decode-uri-component` (via Vite's optional `stylus`), and `sprintf-js` and `node-forge` (via the shadcn CLI). None of it ships to browsers. Dependabot picks up fixes as they're released.
