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
- `npm run check:conflicts` — dry-run merges of the current branch into `dev` (`--base origin/main` for another base) and every other open PR's branch (`scripts/check-merge-conflicts.sh`, `--strict` to fail on PR-vs-PR conflicts). Textual conflicts only: a clean merge can still break the build.

Before calling work done: `npm run format && npm run lint:check && npm test && npm run build`. CI (`.github/workflows/ci.yml`) runs the same checks on every PR and push to `dev` and `main`, plus the conflict check on PRs (fails only on conflicts with the PR's base; conflicts with other PRs are warnings).

**Branches:** branch from `dev` and open PRs against `dev`. `main` is production and deploys on every passing commit; a "Release: dev → main" PR opens by itself, and merging it (with a merge commit, not squash) is the deploy ([docs/deployment.md](docs/deployment.md)).

## Backend

Django + DRF + PostgreSQL in `backend/` (setup in `backend/README.md`). PostgreSQL runs in Docker (`docker compose up -d --wait db` from the root, host port 5434); Django runs on the host with pipenv, from `backend/`:

- `pipenv run start` — dev server (`runserver`, port 8000)
- `pipenv run makemigrate` — `makemigrations` (alias `makemigrations`); `pipenv run migrate` — apply them
- `pipenv run test` — Django tests (needs the database up); `pipenv run check`; `pipenv run dbcheck` prints `postgresql`

Or run everything in Docker with live reload: `docker compose --profile app up` (app on http://localhost:5173, Django on :8000; needs `backend/.env`, see `backend/README.md`).

Before calling backend work done: `pipenv run check && pipenv run python manage.py makemigrations --check --dry-run && pipenv run test`. CI's `backend` job runs the same against a Postgres service.

## How the app works: read the docs

The details of each part of the app live in `docs/`, one file per area. **Before working on an area, read its doc** (and every doc your change touches), and keep it up to date in the same change. Add new detail there, not here.

| Doc                                                                    | Covers                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/backend.md](docs/backend.md)                                     | Backend setup and conventions: env, apps, camelCase API, auth by default, `properties_for_user` scoping, roles; how the app calls it (`services/api.ts`, `ApiError`)                                                                                              |
| [docs/auth-and-access.md](docs/auth-and-access.md)                     | Firebase phone sign-in, invite-only people, property memberships and selection, `/me`, route guards, logout                                                                                                                                                       |
| [docs/tenants.md](docs/tenants.md)                                     | Tenancies (model, overlap and property rules, API), the tenant store and selector, the dashboard                                                                                                                                                                  |
| [docs/rent-entries.md](docs/rent-entries.md)                           | Bills: model, calculations, create/list API, the store, saving, history and details pages, the old local ledger                                                                                                                                                   |
| [docs/payments-and-receipts.md](docs/payments-and-receipts.md)         | Payments (model, `record_payment`, API, store, recording), idempotent retries, and receipts (Django snapshots, issuance, PDF download)                                                                                                                            |
| [docs/dashboard.md](docs/dashboard.md)                                 | The dashboard: overdue bills grouped by tenant across properties (the default), and rent due: rental periods due bill or no bill, amounts only from prepared bills; their APIs, stores, refresh, filters, actions, not owed                                       |
| [docs/security.md](docs/security.md)                                   | Security rules and the hardening checklist (admin, access, RLS, tokens, secrets, logs, SQL, input, XSS, uploads, rate limits, CORS, production settings, dependencies); **read it before any backend, auth, API or dependency change**                            |
| [docs/testing.md](docs/testing.md)                                     | The shared service fakes and fixtures for tests                                                                                                                                                                                                                   |
| [docs/deployment.md](docs/deployment.md)                               | Production: the containers and Caddy, first deploy, releasing and rolling back, health and readiness, backups, restore tests and recovery, the Render + Supabase alternative; **read it before changing settings, images, Compose, `render.yaml` or the scripts** |
| [docs/data-import.md](docs/data-import.md)                             | Importing the owners' Google Sheet: what's imported, `sheet_to_ledger`, `import_legacy_ledger`, the mapping, reconciliation, reruns                                                                                                                               |
| [docs/google-sheets-integration.md](docs/google-sheets-integration.md) | The owners' Google Sheet and its Apps Script (`google-api/`): layout, data problems, what the app needs from it; read before any Sheets work                                                                                                                      |

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
- Never touch Firebase or the API in tests: use the shared service fakes ([docs/testing.md](docs/testing.md)).

## Skills

Skills are task guides in `.claude/skills/<name>/SKILL.md`. Claude Code loads them automatically; other agents should open the matching `SKILL.md` and follow it before starting that kind of task.

- **Code review** — `.claude/skills/code-review-skill/SKILL.md`. Use it whenever you review code: a PR or diff someone asks about, and your own branch before opening a PR. Follow its four phases (context, high level, line by line, summary) and label findings by severity. In this repo focus on its Vue 3, TypeScript and CSS rows, and add these project checks:
  - Layering (Architecture above): no router or service calls in components, no vendor types outside `services/`.
  - Tests ship with the change (Testing above).
  - Writes validate, then update state only after the backend confirms; a failed load is an error, never an empty list or a zero balance. The backend calculates and validates money; it never trusts totals, rates or ids from the request.
  - Money is `Decimal` in Django and summed and compared in paise in the app; saved figures come from the backend; receipts are snapshots, never re-derived.
  - Nothing private committed: tenant data, phone numbers, emails, sheet or script IDs.
  - Security: the rules in [docs/security.md](docs/security.md) hold (server-side access, no stored tokens, no secrets in `VITE_*` or logs, ORM only, no `v-html` with user data).
- **UI design** — `impeccable`, installed per user (`~/.claude/skills/impeccable/`), not in this repo: designing, critiquing or polishing screens, layout, typography, colour, accessibility. Use it for UI work when it's available.

## Conventions

- Import via `@/` alias, not relative `../../`.
- Use theme tokens (`bg-background`, `text-muted-foreground`, `text-destructive`) rather than raw colours.
- Phone numbers are stored as E.164 (`+918341413827`); format for display only (`utils/phone.ts`). Countries live in `utils/phoneCountries.ts` ([docs/auth-and-access.md](docs/auth-and-access.md)).
- Format money with `utils/currency.ts` (`formatINR`) and days with `utils/date.ts` (`formatOrdinal`).
- Errors are shown inline (`role="alert"`), never `alert()`.
- Loading states are skeletons in the content's place, never a "Loading…" line or a spinner that the content then pushes aside: shadcn-vue's `Skeleton`, arranged with `components/common/SkeletonLines.vue` (label/value lines, optionally a card), `SkeletonRows.vue` (list and table rows) and `components/tenant/TenantChipSkeleton.vue`, inside `LoadingRegion.vue` (announces a label to screen readers, hides the shapes). A reload of content already shown keeps the controls (e.g. filters) and replaces only what's reloading. Skeletons don't pulse under `prefers-reduced-motion` (`style.css`).
- Motion lives in `style.css`: `animate-page-in` (layout content, so every screen eases in), `animate-rise-in` (content that appears or changes in place; key the element to replay it), the `ToggleSwitch` slide and a press-in on every `[data-slot=button]`. All of it is off under `prefers-reduced-motion`; don't hand-edit `components/ui/` for motion.
- `VITE_*` env vars are public — never put secrets in them.

## Private data

The repo is public: never commit the real sheet, tenant data, email addresses, phone numbers or IDs. `google-api/` takes personal details from Script Properties and its script ID from the gitignored `.clasp.json`; The owners' WhatsApp bot, a separate Apps Script project that writes monthly entries to the same sheet and is expected to be retired, lives in `whatsapp-bot/` and takes the sheet ID and its secrets from Script Properties.
