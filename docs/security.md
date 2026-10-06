# Security

The rules every change follows, and the hardening still to do. Work through the **To do** items on the `security-fixes` branch, and update this file's status column in the same change. Audited 2026-10-07.

## Checklist

| #   | Item                             | Status                                             |
| --- | -------------------------------- | -------------------------------------------------- |
| 1   | Protect admin routes             | Partly done                                        |
| 2   | Server-side access, always       | Done (rule)                                        |
| 3   | Row-level security               | Done in the app; PostgreSQL RLS not used           |
| 4   | Hash passwords                   | Done (Django); optional Argon2                     |
| 5   | No auth tokens stored by the app | Done; Firebase's own session persistence to decide |
| 6   | Secrets stay server-side         | Done (rule)                                        |
| 7   | No secrets in logs               | Rule; no production logging config yet             |
| 8   | Parameterised SQL                | Done (rule)                                        |
| 9   | Validate form inputs             | Done (rule)                                        |
| 10  | Block XSS                        | Done in code; CSP header to do                     |
| 11  | Validate uploads                 | Rule, for when uploads arrive                      |
| 12  | Rate-limit all requests          | To do                                              |
| 13  | Tighten CORS                     | Mostly done                                        |
| 14  | Production settings, DEBUG off   | Partly done                                        |
| 15  | Patch dependencies               | To do                                              |

## 1. Protect admin routes

- **Django admin** (`/admin/`) uses Django's session login and needs `is_staff`. App people get an unusable password (`accounts/admin.py`), so a phone sign-in never opens admin. Admin access and app access are separate permissions ([auth-and-access.md](auth-and-access.md)).
- **App routes**: the guards in `router/index.ts` are UX only. Every API endpoint checks access itself (item 2).
- **To do**: throttle admin login attempts (e.g. `django-axes`, or the proxy), serve admin under a path set by an env var rather than `/admin/`, and in production restrict it by network or VPN where possible. Consider 2FA for staff.

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
- Staff passwords for Django admin are hashed by Django (PBKDF2 by default), with the password validators in `settings.py`. Never store or log a password or OTP.
- **Optional**: add Argon2 (`argon2-cffi`, `PASSWORD_HASHERS`) as the first hasher; existing hashes upgrade on next login.

## 5. No auth tokens stored by the app

- The app never stores the Firebase ID token. `services/api.ts` asks `authService.getIdToken()` for it on each request; Firebase caches and refreshes it in memory. Never put a token in `localStorage`, `sessionStorage`, a cookie, a URL or a store.
- **To decide:** the Firebase SDK keeps its own session (including a refresh token) in IndexedDB by default (`browserLocalPersistence`), which is what keeps people signed in after a reload. Switching to `browserSessionPersistence` (per tab) or `inMemoryPersistence` (every reload signs out) trades convenience for less stored on the device.

## 6. Secrets stay server-side

- Backend secrets (`DJANGO_SECRET_KEY`, the database password, the Firebase service-account key path) come from the gitignored `backend/.env`; every variable is listed in `backend/.env.example`. The service-account JSON lives outside the repository. In production, use the host's secret store.
- `VITE_*` variables are bundled into the app and are **public**: never put a secret in one. The Firebase web config is public by design.
- Apps Script secrets live in Script Properties, never in the code. The repo is public: never commit tenant data, phone numbers, emails, sheet or script IDs.

## 7. No secrets in logs

- Never log tokens, `Authorization` headers, OTPs, passwords, request bodies or full phone numbers. Log ids (`user.pk`) instead.
- Today: `accounts/services.py` logs a user id, and `accounts/firebase.py` logs exceptions when Firebase is unavailable (not invalid tokens).
- **To do**: a production `LOGGING` config. Check that Firebase Admin exceptions in it never carry a token. Make sure the server's access logs don't record the `Authorization` header.

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
- **To do**: a Content-Security-Policy header where the app is hosted (script sources limited to the app and Firebase/reCAPTCHA), plus `X-Content-Type-Options: nosniff` and a `Referrer-Policy`.

## 11. Validate uploads (future)

There are no uploads today. When they arrive:

- Check size on the server, and set `DATA_UPLOAD_MAX_MEMORY_SIZE` and `FILE_UPLOAD_MAX_MEMORY_SIZE`.
- Check the type by content, not the name or `Content-Type`, and allow a short list of types.
- Store files under random names outside the web root, or in object storage.
- Serve them from another origin, with `Content-Disposition: attachment` where possible.
- Scope them through `properties_for_user` like any other record.

## 12. Rate-limit all requests

- **To do**: DRF throttling (`DEFAULT_THROTTLE_CLASSES` with `UserRateThrottle` and `AnonRateThrottle`, plus scoped, stricter rates for writes such as creating bills). Use a shared cache (e.g. Redis) in production, since the default local-memory cache is per process. Add limits at the proxy as well.
- Throttle admin login (item 1).
- OTP abuse is limited by Firebase and reCAPTCHA. Consider Firebase App Check.

## 13. Tighten CORS

- `CORS_ALLOWED_ORIGINS` is an explicit list from the environment: no wildcards, no `CORS_ALLOW_ALL_ORIGINS`, no credentials (the API uses bearer tokens, not cookies). In development the Vite proxy means the list can stay empty.
- CORS is not authentication: it only controls which browser origins may read responses.
- **To do**: limit CORS to the API (`CORS_URLS_REGEX = r"^/api/.*$"`). In production, list only the app's own origin.

## 14. Production settings, DEBUG off

- `DEBUG` defaults to off (`DJANGO_DEBUG` must be `true` to turn it on), and `ALLOWED_HOSTS` comes from the environment.
- **To do**: `manage.py check --deploy` warns about these, so set them from the environment for production:
  - `SECURE_HSTS_SECONDS`, `SECURE_SSL_REDIRECT` (or the proxy's equivalent, with `SECURE_PROXY_SSL_HEADER`).
  - `SESSION_COOKIE_SECURE` and `CSRF_COOKIE_SECURE`.
  - A real email backend in place of the console one.

  Then run `check --deploy --fail-level WARNING` in CI with production-like env.

## 15. Patch dependencies

- On 2026-10-07, `npm audit` reports 20 vulnerabilities (8 moderate, 12 high). Most are transitive:
  - `firebase` → `@firebase/firestore` → `@grpc/grpc-js`. The app doesn't use Firestore, and Vite bundles only what's imported.
  - Development tooling, e.g. `shadcn-vue` → `@dotenvx/dotenvx` → `node-forge`, and old `braces`.
- Django 6.1.1 → 6.1.2 and the Google auth libraries have updates.
- **To do**:
  - Run `npm audit fix` (without `--force`) and update `firebase` and the dev tooling.
  - Run `pipenv update` and commit `Pipfile.lock`.
  - Add Dependabot (npm, pip, GitHub Actions) and an audit step in CI (`npm audit --omit=dev --audit-level=high`, `pip-audit`).
