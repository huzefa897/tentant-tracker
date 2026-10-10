# Sign-in and property access

## Sign-in (app)

Sign-in is **Firebase phone auth** (`services/auth.service.ts`, the only module importing `firebase/auth`; the app is created lazily in `services/firebase.ts` from `VITE_FIREBASE_*` in `.env.local`). Firebase keeps the session itself and restores it **asynchronously**: `authStore.init()` subscribes once and resolves on the first auth state, `ready` says it has, and the route guards `await` it before deciding. Missing config leaves the app signed out with `loginNotice` shown on login.

`LoginView` and `VerifyOtpView` each render a `recaptcha-host` element that they pass to `sendOtp` (resend needs a fresh check); the service uses a new container per attempt and clears it after. The pending confirmation and phone number live **in memory**, so refreshing `/verify` returns to login. Firebase errors map to `AuthErrorCode` (`services/authErrors.ts`) and the store words them; an outage is never shown as a wrong code. `App.vue` watches the auth user: if Firebase ends the session elsewhere (another tab, disabled account) it clears per-user state and leaves protected pages.

Login accepts India, Australia and US mobiles. Countries live in one table (`utils/phoneCountries.ts`) that drives validation, input grouping, display and the login country picker; add a country there (and its flag in `components/brand/CountryFlag.vue`). Phone numbers are stored as E.164 (`+918341413827`); format for display only (`utils/phone.ts`).

Logout (`composables/useLogout.ts`) clears the selected tenant, property access and the bills loaded from the backend, then `signOut()`s.

**Inactivity timeout** (`composables/useInactivityTimer.ts`, mounted in `App.vue`): the session ends after 15 minutes of no user activity (no mouse, keyboard, scroll or touch events on `window`). Activity events reset the countdown; resets are throttled to once per second. On expiry the user is fully signed out via `useLogout` and `loginNotice` is set so the login page explains why. The timer only runs while `authStore.isAuthenticated` is true.

## Sign-in (backend)

- `AUTH_USER_MODEL` is `accounts.User` (`AbstractUser` + nullable unique `firebase_uid`, `phone_number`). Roles belong on property membership, never on the user.
- Auth is Firebase ID tokens (`Authorization: Bearer`) verified in `accounts/firebase.py`, the only module that imports `firebase_admin`; it raises its own `InvalidFirebaseTokenError` (→ 401) or `FirebaseUnavailableError` (→ 503, never reported as a bad login). Never trust a UID or phone number from the request body. Admin keeps Django's session login.
- **Sign-in is invite-only.** A person (`accounts.User`, "People" in admin, with one optional `name` field rather than first/last names, displayed as "Name — +91 …") is linked to a Firebase identity when an admin adds them with a mobile number (`accounts/services.py` `link_firebase_identity`, the last step of the admin save, inside its transaction). Changing or removing a linked number revokes the identity's sessions, and the API refuses people without a number (like admin's "can sign in"), so a removed person's existing token stops working. A verified number nobody added gets 403 `not_registered` and creates nothing; never create or match people by phone at sign-in. Mobile numbers are unique E.164 validated by `accounts/phone.py`, which mirrors `src/utils/phoneCountries.ts` (change both).

## Property access

**Signing in is not access.** Access comes only from an active `PropertyMembership` of an active `Property`, granted in admin (which records `granted_by`). Memberships are ended (inactive), never deleted. Admin portal access (`is_staff`) and app sign-in are separate permissions on one person; admins get no API access without a membership. Granting access is manual (backend README "Granting access"): sign in once, then add an owner membership in Django admin.

In the app: if `GET /api/v1/me/` answers 403 `not_registered`, the access store ends the Firebase session (`authStore.endSession`) and login explains why. `stores/access.ts` holds the identity and the selected property: one property is selected automatically, several need a choice, none means "no property access", and a failed load is an **error with Retry**, never no access. Property selection is separate from tenant selection.

## Route guards

Route guards live in `router/index.ts` (`meta.requiresAuth`, `meta.guestOnly`, `meta.requiresProperty`) and are async: they wait for `authStore.init()` and, for property routes, `accessStore.load()`. Pinia is installed before the router in `main.ts` so guards can use stores. Routes with `meta.requiresProperty` (dashboard and tenant pages) redirect to `/properties` (`PropertySelectView`, with `?redirect=` to return; only same-app paths are followed) until a property is selected. Guards are UX only: the backend enforces authentication and property access.
