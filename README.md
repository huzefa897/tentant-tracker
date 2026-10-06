# Rent Tracker

Frontend application for managing tenant rent and utility payments.

## Stack

- Vue 3
- TypeScript
- Vite
- Vue Router
- Pinia
- Tailwind CSS
- shadcn-vue
- Axios

## Development

```sh
npm install
cp .env.example .env.local   # then fill in the Firebase web app values
npm run dev
```

Sign-in needs the backend running too: `npm run dev` proxies `/api` to Django on
`127.0.0.1:8000`. See [backend/README.md](backend/README.md) to start it.

## Signing in

Sign-in is Firebase phone auth. In the Firebase console (Authentication) the
Phone provider must be enabled and the countries allowed under SMS region
policy; add a test number with a fixed code to sign in without a real SMS.

Signing in only proves who you are. The app then asks the backend
(`/api/v1/me/`) which properties you can access, and a new account has none:
it shows "Your account has no property access". Grant access in Django admin by
adding a membership for your user (see "Granting access" in the backend README).

## Tenants

The dashboard lists the selected property's current tenancies from the
backend. Add them in Django admin (**Tenancies**), or add three fictional ones
for development with `create_dev_tenancies` (see the backend README). Search by
name or flat number (e.g. `zahid` or `202`) to view a tenant's details.

Rent entries (bills) are saved in the backend, which calculates every total.
Payments can't be recorded yet (BE Phase 5), and entries saved in this browser
before BE Phase 4 are no longer shown.

## Scripts

| Command                | What it does                          |
| ---------------------- | ------------------------------------- |
| `npm run dev`          | Start the Vite dev server             |
| `npm run build`        | Type-check and build for production   |
| `npm run lint`         | Run oxlint and ESLint (with auto-fix) |
| `npm run lint:check`   | Run oxlint and ESLint without fixing  |
| `npm run format`       | Format `src/` with Prettier           |
| `npm run format:check` | Check formatting without writing      |
| `npm test`             | Run the Vitest unit tests once        |
| `npm run test:watch`   | Run Vitest in watch mode              |

## Environment

Variables prefixed with `VITE_` are bundled into the frontend and visible to
anyone using the app. Never put secrets in them.

| Variable                    | Purpose                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| `VITE_API_BASE_URL`         | Optional API base URL; defaults to `/api/v1` on the app's own origin |
| `VITE_FIREBASE_API_KEY`     | Firebase web app config (public by design; identifies the project)   |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase web app config                                              |
| `VITE_FIREBASE_PROJECT_ID`  | Firebase web app config; same project as the backend                 |
| `VITE_FIREBASE_APP_ID`      | Firebase web app config                                              |
