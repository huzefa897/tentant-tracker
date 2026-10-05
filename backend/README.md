# Rent Tracker API

Django + Django REST Framework + PostgreSQL. PostgreSQL runs in Docker; Django runs on your machine with [pipenv](https://pipenv.pypa.io/).

## First run

From the repository root, start the database (host port 5434):

```bash
docker compose up -d --wait db
```

Then, from `backend/`:

```bash
cp .env.example .env          # then set DJANGO_SECRET_KEY (command is in the file)
pipenv install
pipenv run migrate
pipenv run createsuperuser
pipenv run start
```

- Health: http://127.0.0.1:8000/api/v1/health/ → `{"status": "ok"}` (app only; not a database check)
- Admin: http://127.0.0.1:8000/admin/

## Scripts

| Command | Runs |
|---|---|
| `pipenv run start` | `manage.py runserver` |
| `pipenv run makemigrate` | `manage.py makemigrations` (alias: `makemigrations`) |
| `pipenv run migrate` | `manage.py migrate` |
| `pipenv run createsuperuser` | `manage.py createsuperuser` |
| `pipenv run check` | `manage.py check` |
| `pipenv run test` | `manage.py test` (needs the database running; creates a throwaway test database) |
| `pipenv run dbcheck` | Connects to the database and prints `postgresql` |

Dependency versions are pinned in `Pipfile.lock`. Add packages with `pipenv install <name>`.

## Notes

- `.env` is local and gitignored; `.env.example` lists every variable. The compose credentials are for local development only.
- `docker compose down -v` deletes the `postgres_data` volume, which is the whole database.
- `AUTH_USER_MODEL` is `accounts.User` (an `AbstractUser` with `firebase_uid` and `phone_number`). Roles go on property membership (BE Phase 2), not on the user.
- CORS only allows the Vue dev origin and is not authentication.
- `billing` has no models yet.

## Authentication and property access

**Firebase ID token → Django verification → person → property membership.** Firebase proves who controls a phone number; only people an admin has added can use the app, and only an active membership of an active property grants access to it.

### The model

| Concept | Is | Where |
|---|---|---|
| Firebase identity | Proof of a phone number. No name, no permissions. | Firebase console (not a Django table) |
| **Person** (`accounts.User`) | A real person: mobile number, email, and a link to their Firebase identity (`firebase_uid`, a read-only reference). | Admin → **People** |
| **Property** | A building, independent of people. | Admin → **Properties** |
| **Property membership** | A person's role (owner/manager) at a property, active or ended. The only thing that grants property access. | Admin → **Property memberships**, or inline on a person or property |

Admin portal access (`is_staff`/`is_superuser`, username + password) and app sign-in (phone) are separate permissions on the same person. Phone sign-in never opens the admin portal. Django's Groups are hidden: they grant admin permissions across every property, so property roles live on the membership. What each role may do is in `properties/roles.py` (owners: everything; managers: tenants, payments, receipts).

### Sign-in is invite-only

- Requests send `Authorization: Bearer <Firebase ID token>`. `accounts/authentication.py` verifies it with the Firebase Admin SDK (`accounts/firebase.py`, the only module that imports `firebase_admin`), with revocation and disabled-user checks. Identity never comes from the request body.
- **Adding a person** in admin with a mobile number registers that number with Firebase (or reuses its existing identity) and stores the UID, before anything is saved (`accounts/services.py` `link_firebase_identity`). Changing the number moves the identity; removing it stops phone sign-in. If Firebase is unreachable, nothing is saved.
- **A verified number nobody added** gets **403** `{"code": "not_registered"}` and **nothing is created**. People are never matched by phone number at sign-in, only by the UID linked when they were added.
- Invalid, expired or revoked tokens, disabled or deleted Firebase users and inactive people get **401**. If Firebase can't verify (network, outage, missing credentials) the API returns **503** and logs it, never "wrong login".
- Mobile numbers are E.164 (`+918341413827`), unique, and limited to the countries the app's login accepts (`accounts/phone.py`, mirroring the frontend's `utils/phoneCountries.ts`). Admin accepts spaces and dashes.
- Firebase still sends a code to any number typed on the login page (in the allowed SMS regions); the backend is what refuses unknown numbers.

Configure in `.env`: `FIREBASE_PROJECT_ID` (the Vue app's project) and `GOOGLE_APPLICATION_CREDENTIALS` (absolute path to a service-account key kept **outside** the repo). Tests mock Firebase and need neither.

### Adding a person and granting access

1. Admin → **People** → **Add person**: enter their mobile number (and optionally email). Saving registers it for app sign-in.
2. On the person's page that opens, add **Property access**: the property, a role, active. The admin who granted it is recorded.
3. They can now sign in to the app. A person with sign-in but no active membership sees "No property access"; filter People by **property access → Waiting for access** to find them.

End access by making a membership inactive (memberships aren't deleted, so history is kept), or block someone entirely by making the person inactive. Create admin-portal accounts with `pipenv run createsuperuser`; to let an admin use the app too, add their mobile number on their person page.

### Endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/v1/health/` | `{"status": "ok"}`, no authentication |
| `GET /api/v1/me/` | `{id, phoneNumber, properties: [{id, name, role}]}`; an empty list means access isn't configured; an unregistered number is 403 `not_registered` |
| `GET /api/v1/properties/` | The user's properties (`id, name, address, contactNumber, role`) |
| `GET /api/v1/properties/{id}/` | One of them; unassigned or missing is **404** |

All three use `properties/queries.py` `properties_for_user`, so lists and lookups are scoped the same way.
