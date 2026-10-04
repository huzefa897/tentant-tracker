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
- APIs require authentication by default (`IsAuthenticated`, session auth for now); opt out per view, as the health check does. CORS only allows the Vue dev origin and is not authentication.
- `properties` and `billing` have no models yet.
