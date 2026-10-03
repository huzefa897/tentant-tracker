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
cp .env.example .env
npm run dev
```

## Mock login

Authentication is mocked for now. Sign in with any valid Indian mobile number
(10 digits starting 6–9) and the OTP **`924636`**.

The signed-in session is kept in `localStorage`. While you're on the
verification step, the phone number is kept in `sessionStorage`, so a refresh
stays on that screen; a new tab starts again from login.

## Scripts

| Command              | What it does                          |
| -------------------- | ------------------------------------- |
| `npm run dev`        | Start the Vite dev server             |
| `npm run build`      | Type-check and build for production   |
| `npm run lint`       | Run oxlint and ESLint (with auto-fix) |
| `npm run lint:check` | Run oxlint and ESLint without fixing  |
| `npm run format`     | Format `src/` with Prettier           |

## Environment

Variables prefixed with `VITE_` are bundled into the frontend and visible to
anyone using the app. Never put secrets in them.

| Variable            | Purpose                |
| ------------------- | ---------------------- |
| `VITE_API_BASE_URL` | Base URL for API calls |
