# Rent Tracker

Vue 3 + TypeScript + Vite frontend for managing tenant rent and utility payments (Saleem Towers, India).
Stack: Vue Router, Pinia (setup stores), Tailwind v4, shadcn-vue (reka-ui), Axios.

## Commands

- `npm run dev` — dev server
- `npm run build` — type-check (`vue-tsc`) + production build. Run it: the dev server does not type-check.
- `npm run lint` — oxlint + ESLint with auto-fix
- `npm run lint:check` — same, no fixes (use for verification/CI)
- `npm run format` — Prettier over `src/` (`npm run format:check` to check only)
- `npm test` — Vitest, single run (`npm run test:watch` to watch)
- `npm run check:conflicts` — dry-run merges of the current branch into `main` and every other open PR's branch (`scripts/check-merge-conflicts.sh`, `--strict` to fail on PR-vs-PR conflicts). Textual conflicts only: a clean merge can still break the build.

Before calling work done: `npm run format && npm run lint:check && npm test && npm run build`. CI (`.github/workflows/ci.yml`) runs the same checks on every PR and push to `main`, plus the conflict check on PRs (fails only on conflicts with `main`; conflicts with other PRs are warnings).

## Backend

Django + DRF + PostgreSQL in `backend/` (setup in `backend/README.md`). The frontend calls it for access (`/me`), tenants (tenancies) and rent entries (bills); payments and receipts aren't on it yet (BE Phase 5). PostgreSQL runs in Docker (`docker compose up -d --wait db` from the root, host port 5434); Django runs on the host with pipenv, from `backend/`:

- `pipenv run start` — dev server (`runserver`, port 8000)
- `pipenv run makemigrate` — `makemigrations` (alias `makemigrations`); `pipenv run migrate` — apply them
- `pipenv run test` — Django tests (needs the database up); `pipenv run check`; `pipenv run dbcheck` prints `postgresql`

Before calling backend work done: `pipenv run check && pipenv run python manage.py makemigrations --check --dry-run && pipenv run test`. CI's `backend` job runs the same against a Postgres service.

- Settings come from the gitignored `backend/.env`; every variable is listed in `backend/.env.example`. Add new ones to both.
- `AUTH_USER_MODEL` is `accounts.User` (`AbstractUser` + nullable unique `firebase_uid`, `phone_number`). Roles belong on property membership, never on the user.
- Auth is Firebase ID tokens (`Authorization: Bearer`) verified in `accounts/firebase.py`, the only module that imports `firebase_admin`; it raises its own `InvalidFirebaseTokenError` (→ 401) or `FirebaseUnavailableError` (→ 503, never reported as a bad login). Never trust a UID or phone number from the request body. Admin keeps Django's session login.
- DRF requires authentication by default; a public endpoint opts out with `AllowAny` and `authentication_classes([])` (only `/api/v1/health/` today). CORS is not authentication.
- **Sign-in is invite-only.** A person (`accounts.User`, "People" in admin, with one optional `name` field rather than first/last names, displayed as "Name — +91 …") is linked to a Firebase identity when an admin adds them with a mobile number (`accounts/services.py` `link_firebase_identity`, the last step of the admin save, inside its transaction). Changing or removing a linked number revokes the identity's sessions, and the API refuses people without a number (like admin's "can sign in"), so a removed person's existing token stops working. A verified number nobody added gets 403 `not_registered` and creates nothing; never create or match people by phone at sign-in. Mobile numbers are unique E.164 validated by `accounts/phone.py`, which mirrors `src/utils/phoneCountries.ts` (change both).
- **Access comes only from an active `PropertyMembership` of an active `Property`**, granted in admin (which records `granted_by`). Memberships are ended (inactive), never deleted. Admin portal access (`is_staff`) and app sign-in are separate permissions on one person; admins get no API access without a membership. Role permissions live in `properties/roles.py` (`role_can`), never in Django Groups (hidden: they're global, not per property). Scope every property query through `properties/queries.py` `properties_for_user` (filter the queryset, so others' records 404 and never appear in lists), not object permissions alone.
- API JSON is camelCase with explicit serializer fields; never expose whole models.
- **Tenants are tenancies** (`properties.Tenancy`): one occupant of one flat over a period, with its own UUID, so a flat has many tenancies over time and bills will belong to the tenancy. Status (upcoming/current/ended) is derived from the dates on the India business date (`business_date()`), never stored; end dates are inclusive. Validation lives on the model (admin uses it) with database check constraints behind it; overlapping tenancies of one flat are refused by `clean()` (naming the clash) and, against simultaneous saves, by a PostgreSQL exclusion constraint (`btree_gist`; model validation skips it via `get_constraints` so the message isn't repeated). The tenancy API is read-only and nested under the property (`/api/v1/properties/{id}/tenancies/`), found through `properties_for_user` first. Tenants never sign in.
- **Bills are rent entries** (`billing.RentEntry`): one per tenancy and billing month (stored as the first of the month), `PROTECT`ed from tenancy deletion. Rent and electricity rate are copied from the tenancy when the bill is created and never change after; totals, paid, outstanding and status are derived in `billing/calculations.py` with `Decimal` (electricity rounded to paise, half up, **then** added to rent and water) and never stored. Database constraints back every rule (unique month, rent > 0, units/rate/water ≥ 0, first of month). The API (`/api/v1/properties/{id}/tenancies/{id}/entries/`, list/create, and `.../{entryId}/`) is scoped through `properties_for_user` then the tenancy, so others' bills 404; there's no update or delete. Creation goes through `billing/services.py` `create_rent_entry`, which locks the tenancy, rechecks that the month overlaps the occupancy (no proration), and assigns the rate, tenancy and creator itself; the serializer refuses unknown, server-assigned and payment fields rather than ignoring them. A duplicate month is 409 `duplicate_billing_month`, including when the unique constraint catches a race (only that constraint, matched by name, outside the failed transaction). Lists are newest month first, 12 per page, with `?year=` and `?billing_month=`. Concurrency tests (`billing/tests/test_concurrency.py`) need PostgreSQL.
- Apps: `accounts`, `properties` (properties, memberships, tenancies), `billing` (rent entries). Tests in `tests.py` or a `tests/` package per app; mock `verify_firebase_token`, never call live Firebase.
- Add packages with `pipenv install <name>` and commit `Pipfile.lock`.

## Architecture

Layering, top to bottom — each layer only calls the one below it:

- `views/` — route-level screens. Own navigation (`router.push`) and wire stores to components.
- `components/<feature>/` — forms and UI. Take props, emit events; no router, no service calls.
- `stores/` — Pinia setup stores for **shared** state only. Components change state through store actions, not by assigning store refs.
- `services/` — the only place that talks to external systems (Firebase, the Django API, later Google Sheets). Return app types from `types/`, never vendor types (e.g. `AuthUser`, not a Firebase user), and throw app errors (`AuthError`, `ApiError`), never Firebase or Axios errors.
- `types/`, `utils/` (pure functions), `layouts/`.

`components/ui/` is generated by shadcn-vue (`npx shadcn-vue@latest add <name>`). Don't hand-edit unless necessary.

## Testing

**Every new component, store, util or feature ships with tests in the same change.** When changing existing behaviour, update or add the tests that cover it.

- Vitest + `@vue/test-utils` in jsdom. Tests live next to the code in `__tests__/` (e.g. `src/utils/__tests__/date.spec.ts`), named `*.spec.ts`.
- Components: mount with props, assert rendered output and emitted events — not internal state.
- Stores: use `setActivePinia(createPinia())` in `beforeEach`; test through actions and getters.
- Services/utils: plain input → output, including invalid input.
- Skip `components/ui/` (generated). Test files are linted with `@vitest/eslint-plugin`.

## Skills

Skills are task guides in `.claude/skills/<name>/SKILL.md`. Claude Code loads them automatically; other agents should open the matching `SKILL.md` and follow it before starting that kind of task.

- **Code review** — `.claude/skills/code-review-skill/SKILL.md`. Use it whenever you review code: a PR or diff someone asks about, and your own branch before opening a PR. Follow its four phases (context, high level, line by line, summary) and label findings by severity. In this repo focus on its Vue 3, TypeScript and CSS rows, and add these project checks:
  - Layering (Architecture above): no router or service calls in components, no vendor types outside `services/`.
  - Tests ship with the change (Testing above).
  - Writes validate, then update state only after the backend confirms; a failed load is an error, never an empty list or a zero balance. The backend calculates and validates money; it never trusts totals, rates or ids from the request.
  - Money is `Decimal` in Django and summed and compared in paise in the app; saved figures come from the backend; receipts are snapshots, never re-derived.
  - Nothing private committed: tenant data, phone numbers, emails, sheet or script IDs.
- **UI design** — `impeccable`, installed per user (`~/.claude/skills/impeccable/`), not in this repo: designing, critiquing or polishing screens, layout, typography, colour, accessibility. Use it for UI work when it's available.

## Conventions

- Import via `@/` alias, not relative `../../`.
- Use theme tokens (`bg-background`, `text-muted-foreground`, `text-destructive`) rather than raw colours.
- Phone numbers are stored as E.164 (`+918341413827`); format for display only (`utils/phone.ts`).
- Login accepts India, Australia and US mobiles. Countries live in one table (`utils/phoneCountries.ts`) that drives validation, input grouping, display and the login country picker; add a country there (and its flag in `components/brand/CountryFlag.vue`).
- Errors are shown inline (`role="alert"`), never `alert()`.
- Motion lives in `style.css`: `animate-page-in` (layout content, so every screen eases in), `animate-rise-in` (content that appears or changes in place; key the element to replay it) and a press-in on every `[data-slot=button]`. All of it is off under `prefers-reduced-motion`; don't hand-edit `components/ui/` for motion.
- `VITE_*` env vars are public — never put secrets in them.

## Current state

Sign-in is **Firebase phone auth** (`services/auth.service.ts`, the only module importing `firebase/auth`; the app is created lazily in `services/firebase.ts` from `VITE_FIREBASE_*` in `.env.local`). Firebase keeps the session itself and restores it **asynchronously**: `authStore.init()` subscribes once and resolves on the first auth state, `ready` says it has, and the route guards `await` it before deciding. Missing config leaves the app signed out with `loginNotice` shown on login. `LoginView` and `VerifyOtpView` each render a `recaptcha-host` element that they pass to `sendOtp` (resend needs a fresh check); the service uses a new container per attempt and clears it after. The pending confirmation and phone number live **in memory**, so refreshing `/verify` returns to login. Firebase errors map to `AuthErrorCode` (`services/authErrors.ts`) and the store words them; an outage is never shown as a wrong code. `App.vue` watches the auth user: if Firebase ends the session elsewhere (another tab, disabled account) it clears per-user state and leaves protected pages.

**Signing in is not access.** Only numbers an admin added can use the app: if `/me` answers 403 `not_registered`, the access store ends the Firebase session (`authStore.endSession`) and login explains why. After sign-in the app calls `GET /api/v1/me/` through `services/api.ts` (Axios; a request interceptor attaches `Authorization: Bearer <ID token>` from `authService.getIdToken()`, which Firebase caches and refreshes; never store the token). `stores/access.ts` holds the identity and the selected property: one property is selected automatically, several need a choice, none means "no property access", and a failed load is an **error with Retry**, never no access. Routes with `meta.requiresProperty` (dashboard and tenant pages) redirect to `/properties` (`PropertySelectView`, with `?redirect=` to return; only same-app paths are followed) until a property is selected. Property selection is separate from tenant selection. Guards are UX only: the backend enforces authentication and property access.

In development `/api` is proxied to Django on `127.0.0.1:8000` (`vite.config.ts`), so the app calls its own origin and needs no CORS setup; `VITE_API_BASE_URL` overrides it. Granting access is manual (backend README "Granting access"): sign in once, then add an owner membership in Django admin.

Logout (`composables/useLogout.ts`) clears the selected tenant, property access and the bills loaded from the backend, then `signOut()`s.

Tests never touch Firebase or the API: mock the services with the shared fakes, `vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))` and the same for `access.service`, `tenant.service` and `rentEntry.service`, calling `resetAuthService()`/`resetAccessService()`/`resetTenantService()`/`resetRentEntryService()` in `beforeEach`. The rent entry fake saves, filters and pages `fakeEntries.entries` like the API (409 for a duplicate month; `fakeEntries.rate` makes the "server" charge another rate). Build bills with `makeEntry` (`src/test/rentEntryFixtures.ts`, re-exported by `src/test/rentEntries.ts`): its figures follow its charges unless overridden. Fakes import fixtures from `rentEntryFixtures.ts`, never `rentEntries.ts`, which imports the router (a cycle through the mocked service). The tenant fake searches and pages its fictional `testTenants` (ids `tenant-001`…) like the API; `fakeTenancies` changes them or the page size, and `loadTestTenants()` (`src/test/tenants.ts`) signs in, selects the property and loads them for store tests. `signInAs()` sets the session Firebase "restores"; the default identity has one property, so protected pages open directly. The router is shared across tests: navigate with `force: true` when the path may already be current.

Tenants come from the backend's **tenancies** of the selected property (`services/tenant.service.ts`, which validates each response as a `TenancyDto` and maps it to the app's `Tenant`, converting the decimal-string money to numbers; `Tenant.id` is the tenancy UUID). `stores/tenant.ts` keeps the search **results** (current tenancies only, paginated with Load more, for the query they answer) apart from a **cache of tenants by id**, which also holds tenants loaded by id; `selectedTenant` comes from the cache, so a search that leaves the selected tenant out never loses it. The selector searches through the API 300 ms after typing pauses (`TenantSelector` emits `search`); every list request is numbered and only the newest may change state, so an older response never replaces a newer search. Changing the selected property (switching, logout, lost access) resets the tenant store at once (a sync watcher in the store) and discards pending responses. A failed load is an error with Retry, never "No current tenants found." Pages opened by URL load their tenant through the detail API (`loadTenant`, any status), so they never depend on visiting the dashboard. The dashboard never auto-selects a tenant. Below the selected tenant's name it shows their latest bill by billing month (`LatestEntryCard`, via `TenantDetails`' `latest-entry` slot) and their bill count, from the first page of their bills (`loadSummary`, reloaded whenever a tenant is selected): nothing while loading or when they have none, and an error with Retry when it fails. Format money with `utils/currency.ts` (`formatINR`) and days with `utils/date.ts` (`formatOrdinal`).

**The old local ledger is no longer read.** Bills, payments and receipts saved in this browser before BE Phase 4 stay untouched under `rent-tracker:rent-entries:v1` but nothing shows them. Never match them to tenancies by name or upload them automatically; importing needs an explicit id mapping.

Rent entries (**bills**) live in PostgreSQL. `services/rentEntry.service.ts` validates each response as a `RentEntryDto` and maps it to the app's `RentEntry` (`types/rentEntry.ts`; `tenantId` is the tenancy id, money becomes numbers), and sends new bills as decimal strings without a rate (`CreateRentEntryDto`). A saved bill carries **the backend's figures** (`electricityAmount`, `totalDue`, `totalPaid`, `outstanding`, `status`): screens display them and never recalculate. `utils/rentCalculations.ts` follows the backend's rule exactly (integer milli-units × paise, half up) for the form's **preview** only; the form's validation limits decimals (2 for money, 3 for units) and size to what the backend stores. `stores/rentEntry.ts` holds the selected property's bills: a cache by id (`getEntry` matches **both** ids), one page of history (`loadHistory`), per-tenant summaries (`loadSummary`) and `addEntry`. Changing the selected property (switching, logout) resets it at once and discards pending responses. A failed load is an error with Retry, never an empty list or a zero balance.

`addEntry` adds a bill to state only after the backend returns it; on any failure nothing changes, the form keeps its values and no confirmation shows. It throws `EntrySaveError` with the message to show and, when that month now has a bill (a 409 duplicate, or a timeout/5xx after which it checks with `?billing_month=`), that `existingEntry`, so `NewRentEntryView` links to it instead of inviting another submission. Save is disabled while in flight. The confirmation shows the **returned** charges and figures, and says so when the rate differed from the preview.

**Payments and receipts are paused until BE Phase 5.** Every backend bill is unpaid: `RentEntryForm`'s `paymentsEnabled` is false on the connected page (payment inputs disabled, `initialPayment` always `null`), `addEntry` refuses a submission with a payment rather than dropping it, and the details page says payments can't be recorded yet instead of offering Record Payment. `RecordPaymentForm`, `PaymentHistory`, `types/payment.ts` and the receipt modules (`types/receipt.ts`, `utils/receipt*.ts`, `config/receiptIssuer.ts`; a receipt is a snapshot of one payment, downloaded as a PDF with jsPDF and Poppins, issuer details from `VITE_RECEIPT_ISSUER_*` in `.env.local`) are kept, tested but unused, for Phase 5 to reconnect with backend ids. Payment status filtering is gone for the same reason.

History (`/tenants/:tenantId/entries`, `RentEntryHistoryView`) and details (`/tenants/:tenantId/entries/:entryId`, `RentEntryDetailsView`) take the tenant from the URL, never the dashboard selection, and the details page matches the entry on **both** ids so an entry never shows under another tenant. Both load the tenant and their bills from the backend themselves, so direct links and refreshes work (the details page through `composables/useRouteEntry.ts`, which reports a failed load as an error with Retry, never as "Entry not found"). Tenant pages opened by URL (new entry, history, details) get their tenant from `composables/useRouteTenant.ts`, which reports a failed tenant load as an error with Retry, never as "Tenant not found". The router reuses a page when only its params change, so derive from the route props (computeds) rather than loading in `onMounted` alone, and reset page-local state such as the year filter and page when the tenant changes. History is **paginated by the backend** (12 a page, Newer/Older) with the year filter applied there; years offered come from the tenancy's dates. Totals (`sumEntryAmounts`, in paise) cover **this page only** and are labelled "Totals for this page", never the tenant's balance; the deposit is never applied to them. Back links use explicit routes, not `router.back()`; the details page goes back to Previous Entries unless opened with `?from=dashboard` (the dashboard's latest entry), which returns to the dashboard with that tenant selected.

The owners currently keep everything in a Google Sheet with an Apps Script that emails receipts. Its layout, data problems and what the app needs from it are in `docs/google-sheets-integration.md`; read it before any Sheets work. The script itself lives in `google-api/` (see its README): personal details come from Script Properties and the script ID from the gitignored `.clasp.json`. The owners' WhatsApp bot, a separate Apps Script project that writes monthly entries to the same sheet and is expected to be retired, lives in `whatsapp-bot/` (the sheet ID and its secrets come from Script Properties). The repo is public: never commit the real sheet, tenant data, email addresses, phone numbers or IDs.

Route guards live in `router/index.ts` (`meta.requiresAuth`, `meta.guestOnly`, `meta.requiresProperty`) and are async: they wait for `authStore.init()` and, for property routes, `accessStore.load()`. Pinia is installed before the router in `main.ts` so guards can use stores.
