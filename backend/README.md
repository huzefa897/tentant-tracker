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

**Firebase ID token → Django verification → local User → property membership.** Authentication says who you are; only an active membership of an active property grants access.

- Requests send `Authorization: Bearer <Firebase ID token>`. `accounts/authentication.py` verifies it with the Firebase Admin SDK (`accounts/firebase.py`, the only module that imports `firebase_admin`), with revocation and disabled-user checks. Identity never comes from the request body.
- Invalid, expired or revoked tokens, disabled or deleted Firebase users and inactive Django users get **401**. If Firebase can't verify (network, outage, missing credentials) the API returns **503** and logs it, never "wrong login".
- The first verified request creates a local user (`accounts/services.py`): internal `firebase-<uuid>` username, unusable password, never staff, **no memberships**.
- Django admin keeps its own username/password session login. Being an admin grants no API access.

Configure in `.env`: `FIREBASE_PROJECT_ID` (the Vue app's project) and `GOOGLE_APPLICATION_CREDENTIALS` (absolute path to a service-account key kept **outside** the repo). Tests mock Firebase and need neither.

### Granting access (bootstrap)

1. Sign in from the Vue app, which calls `GET /api/v1/me/` and creates your user.
2. In admin, create the property under **Properties**.
3. Add an active **owner** membership for that user (inline on the property, or under **Property memberships**).

### Endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/v1/health/` | `{"status": "ok"}`, no authentication |
| `GET /api/v1/me/` | `{id, phoneNumber, properties: [{id, name, role}]}`; an empty list means access isn't configured |
| `GET /api/v1/properties/` | The user's properties (`id, name, address, contactNumber, role`) |
| `GET /api/v1/properties/{id}/` | One of them; unassigned or missing is **404** |

All three use `properties/queries.py` `properties_for_user`, so lists and lookups are scoped the same way.
