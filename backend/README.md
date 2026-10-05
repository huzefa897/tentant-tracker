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
- `billing` has no models yet; bills will belong to a tenancy (BE Phase 4).

## Authentication and property access

**Firebase ID token → Django verification → person → property membership.** Firebase proves who controls a phone number; only people an admin has added can use the app, and only an active membership of an active property grants access to it.

### The model

| Concept | Is | Where |
|---|---|---|
| Firebase identity | Proof of a phone number. No name, no permissions. | Firebase console (not a Django table) |
| **Person** (`accounts.User`) | A real person: optional name, mobile number, email, and a link to their Firebase identity (`firebase_uid`, a read-only reference). Shown as "Name — +91 …". | Admin → **People** |
| **Property** | A building, independent of people. | Admin → **Properties** |
| **Property membership** | A person's role (owner/manager) at a property, active or ended. The only thing that grants property access. | Admin → **Property memberships**, or inline on a person or property |
| **Tenancy** | One occupant of one flat over a period: name, flat, mobile, rent, due day, electricity rate, deposit, start and (inclusive) end date. Tenants don't sign in. A flat has a new tenancy, with its own id, for each occupant; bills will belong to the tenancy. | Admin → **Tenancies** |

Admin portal access (`is_staff`/`is_superuser`, username + password) and app sign-in (phone) are separate permissions on the same person. Phone sign-in never opens the admin portal. Django's Groups are hidden: they grant admin permissions across every property, so property roles live on the membership. What each role may do is in `properties/roles.py` (owners: everything; managers: tenants, payments, receipts).

### Sign-in is invite-only

- Requests send `Authorization: Bearer <Firebase ID token>`. `accounts/authentication.py` verifies it with the Firebase Admin SDK (`accounts/firebase.py`, the only module that imports `firebase_admin`), with revocation and disabled-user checks. Identity never comes from the request body.
- **Adding a person** in admin with a mobile number registers that number with Firebase (or reuses its existing identity) and stores the UID, as the last step of the save (`accounts/services.py` `link_firebase_identity`). Changing the number moves the identity; removing it stops phone sign-in. Either change also signs the person out everywhere (Firebase refresh tokens are revoked), and a person without a number gets **403** `not_registered` even with an older token. If Firebase is unreachable, nothing is saved.
- **A verified number nobody added** gets **403** `{"code": "not_registered"}` and **nothing is created**. People are never matched by phone number at sign-in, only by the UID linked when they were added.
- Invalid, expired or revoked tokens, disabled or deleted Firebase users and inactive people get **401**. If Firebase can't verify (network, outage, missing credentials) the API returns **503** and logs it, never "wrong login".
- Mobile numbers are E.164 (`+918341413827`), unique, and limited to the countries the app's login accepts (`accounts/phone.py`, mirroring the frontend's `utils/phoneCountries.ts`). Admin accepts spaces and dashes.
- Firebase still sends a code to any number typed on the login page (in the allowed SMS regions); the backend is what refuses unknown numbers.

Configure in `.env`: `FIREBASE_PROJECT_ID` (the Vue app's project) and `GOOGLE_APPLICATION_CREDENTIALS` (absolute path to a service-account key kept **outside** the repo). Tests mock Firebase and need neither.

### Adding a person and granting access

1. Admin → **People** → **Add person**: enter their mobile number, and optionally a name and email. Saving registers the number for app sign-in.
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
| `GET /api/v1/properties/{id}/tenancies/` | The property's tenancies, paginated: `{count, next, previous, results}` (20 per page, `?page=`). `?status=current` (default), `upcoming`, `ended` or `all`; `?search=` matches name or flat, case-insensitively. Ordered by flat, name, id |
| `GET /api/v1/properties/{id}/tenancies/{tenancyId}/` | One tenancy of any status (ended ones too, for history) |

All of them use `properties/queries.py` `properties_for_user`, so lists and lookups are scoped the same way: a property the user can't access is **404** before any tenancy is looked at, and a tenancy is only found under its own property. Tenancy JSON is `{id, propertyId, name, flatNumber, mobileNumber, rentAmount, rentDueDay, electricityRate, depositAmount, startDate, endDate, status}`, with money as decimal strings (`"15000.00"`). The endpoints are read-only: tenancies are managed in admin.

## Tenancies

- **Status is derived, never stored:** upcoming (starts after today), current (started, and no end date or ending today or later), ended (end date before today), on the India business date (`properties/models.py` `business_date`).
- **Validation** (admin and model): name and flat required and tidied (`" g-01 "` → `G-01`), mobile in E.164, rent above zero, due day 1–28, electricity rate and deposit zero or more, end date not before start date. Database check constraints back up the numeric ranges and date order.
- **No overlaps:** admin refuses a tenancy whose dates overlap another one for the same flat in the same property (end dates inclusive, so the next tenancy starts the day after). Flat numbers repeat across properties and over time. The database enforces the same rule (a PostgreSQL exclusion constraint on property, flat and the inclusive date range, using the `btree_gist` extension), so two admins saving at once can't both store an overlap: the second gets "Not saved" and nothing changes.
- **Development data:** `pipenv run python manage.py create_dev_tenancies "<property name or id>"` adds three fictional current tenancies (needs `DJANGO_DEBUG=True`; skips flats that already have one). Never message their numbers.
