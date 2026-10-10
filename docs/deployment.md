# Deployment, backups and recovery

How the app runs in production, how to release a new version, and how to get the data back if something goes wrong. Everything below is the single-server setup ([compose.prod.yaml](../compose.prod.yaml)); the free-hosting alternative is [Render and Supabase](#render-and-supabase) at the end. The settings rules are in [security.md](security.md); importing the owners' Google Sheet is in [data-import.md](data-import.md).

## The layout

One server runs three containers ([compose.prod.yaml](../compose.prod.yaml)):

```
 browser ──HTTPS──▶  web: Caddy  ───────▶  backend: Django  ───────▶  db: PostgreSQL
                     ports 80, 443         (Gunicorn, port 8000)       (no published port)
                     • gets the HTTPS      • /api/…                    • only reachable from
                       certificate         • admin                       the backend, on a
                     • serves the Vue app  • admin's static files        network with no way out
```

- **One domain for everything.** Caddy serves the built Vue app and passes `/api/…`, admin and `/static/…` to Django. The browser only ever talks to one origin, so there's no CORS to set up and `VITE_API_BASE_URL` stays empty.
- **Caddy handles HTTPS by itself**: once the domain points at the server, it gets a free Let's Encrypt certificate and renews it. Its certificates live in the `caddy_data` volume.
- **Django isn't published**: it's reached only through Caddy. Caddy tells it the visitor's real address (`X-Forwarded-For`, trusted with `DJANGO_NUM_PROXIES=1`) and that the request came over HTTPS (`X-Forwarded-Proto`, trusted with `DJANGO_BEHIND_HTTPS_PROXY`).
- **PostgreSQL is private**: no published port and an internal network, so only Django can reach it.
- **Secrets stay out of the images.** Settings come from `.env.production` at run time (each container gets only the ones it needs), and the Firebase service-account key is mounted read-only. Both images copy only an allowlist of files, so `.env` files, keys and dumps can't end up inside.

**A separate API domain** (e.g. `app.example.com` and `api.example.com`) also works: set `VITE_API_BASE_URL=https://api.example.com/api/v1`, list the app's exact origin in `CORS_ALLOWED_ORIGINS`, and give each domain its own site in the `Caddyfile`. Only do this if you need to; one domain is simpler and safer.

The images:

- **`backend/Dockerfile`**: the exact, hash-checked packages from `Pipfile.lock`, a non-root user, admin's static files collected at build time (served by WhiteNoise), Gunicorn (`WEB_CONCURRENCY` workers; the rate-limit counts are shared through PostgreSQL, `DJANGO_SHARED_CACHE`), logs to stdout/stderr. Its health check calls `/api/v1/ready/`.
- **`deploy/web/Dockerfile`**: builds the Vue app (the `VITE_*` values are baked in at build time, so changing them needs a rebuild) into a Caddy image with [deploy/web/Caddyfile](../deploy/web/Caddyfile). Vue routes such as `/tenants/…` get `index.html`; hashed assets are cached for a year, everything else is revalidated so a release shows at once.

## What you need

- A Linux server with Docker and the Compose plugin, ports 80 and 443 open, and enough disk for the database and backups.
- A domain (or subdomain) with an A/AAAA record pointing at the server.
- **Firebase** (the production project):
  - Authentication > Settings > **Authorized domains**: add the domain, or phone sign-in is refused.
  - Project settings > Service accounts > **Generate new private key**: the key for the backend. Store it outside the repository, e.g. `/etc/rent-tracker/firebase-service-account.json`, in a directory only the deploying user can open (`chmod 700`), with the file readable by the container (`chmod 644`; the directory keeps others out).
  - Project settings > General > Your apps: the web app's config for the `VITE_FIREBASE_*` values.
- Somewhere off the server for backups (another machine, or object storage through `rclone`), and a monitor for them (e.g. a free [healthchecks.io](https://healthchecks.io) check).

## The first deploy

1. Clone the repository on the server and check out the release to deploy.
2. `cp .env.production.example .env.production`, fill in every value (the comments say how to generate the secrets) and `chmod 600 .env.production`. Use new secrets: never the development ones.
3. `scripts/deploy.sh`. It builds, starts the database, migrates, starts the backend and Caddy, and waits until they're healthy. The first start takes a minute while Caddy gets the certificate.
4. Create an admin login: `docker compose --env-file .env.production -f compose.prod.yaml run --rm backend python manage.py createsuperuser`. Admin is at `https://<domain>/<DJANGO_ADMIN_PATH>`.
5. In admin, set the property's name, address and contact number (receipts need them), add the tenancies, and add the people who sign in, with their property memberships ([auth-and-access.md](auth-and-access.md)).
6. Import the Sheet's history if needed ([data-import.md](data-import.md)).
7. Run the checks below, then set up backups.
8. **Content-Security-Policy:** the site starts with the policy in report-only mode (`Content-Security-Policy-Report-Only` in the `Caddyfile`). Sign in with a phone number, open a bill and download a receipt with the browser's console open. If nothing is reported as violating the policy, rename the header to `Content-Security-Policy` in the `Caddyfile` and deploy again. If something is, add exactly that source to the policy rather than loosening it.

### Checks after a deploy

- `https://<domain>/api/v1/ready/` answers `{"status": "ok"}`.
- `https://<domain>/tenants/anything` loads the app (a direct link to a Vue route), not a 404.
- Sign in with a phone number: the app shows only that person's properties.
- Open a tenant, create a bill, record a part payment and the rest, issue a receipt and open it again; refresh each page.
- `docker compose … restart` (or reboot the server), then check the bill, payment and receipt are still there.
- `curl -sI https://<domain>/api/v1/me/` shows `Cache-Control: no-store, private`: the API is never cached.
- Nothing secret was shipped: `docker run --rm rent-tracker-web:<release> sh -c 'grep -rl "private_key" /srv || echo clean'` and the same for `rent-tracker-backend:<release>` with `/app`.

### Before the first deploy: the whole journey locally

Run the app against the development backend and go through the journey above (sign in, properties and tenancies, a bill, a part payment and the rest, a receipt, refresh each page). Every screen reads from the API: the app no longer reads bills, payments or receipts from browser storage (it uses none at all).

### A local trial of the production setup

To try the containers on your own machine (never on a real server), make a second settings file with the trial values from `.env.production.example` (`SITE_ADDRESS=:80`, `HTTP_PORT=8080`, `HTTPS_PORT=8443`, `DJANGO_ALLOWED_HOSTS=localhost`, `DJANGO_SECURE_SSL_REDIRECT=false`, `DJANGO_SECURE_COOKIES=false`, `DJANGO_SECURE_HSTS_SECONDS=0`) and run `ENV_FILE=.env.trial scripts/deploy.sh`, then open http://localhost:8080. Plain http means admin's login and phone sign-in won't work fully; it's for checking the containers start, migrate, serve the app and survive restarts.

## Releasing

`scripts/deploy.sh` releases the checked-out commit, and refuses while there are uncommitted or untracked files (they would be built into a release its commit doesn't hold). CI must have passed for it (tests and the frontend build). The script:

1. Builds both images, tagged with the commit (`rent-tracker-backend:<commit>`), so the previous release's images stay available.
2. Backs up the database ([backups](#backups)).
3. Runs the migrations **once**, as their own step, and creates the rate-limit table (`createcachetable`). The app's processes never migrate on start.
4. Starts the new release and waits until Docker reports it healthy.
5. Checks readiness, and records the release in `deploy/releases.log`.

Then go through the checks above.

### Rolling back

`scripts/rollback.sh <release>` starts an earlier release's images again (`deploy/releases.log` lists them), but with the current `compose.prod.yaml` and `.env.production`. If a release since changed either (a new setting, service or volume), check out the earlier commit's `compose.prod.yaml` first, and keep any settings it needs. **It doesn't undo migrations.** So:

- Keep each release's migrations usable by the release before it: add columns as nullable or with defaults, and remove or rename things in a later release, once nothing uses them.
- When a migration can't be compatible (it rewrites or drops data), say so in its PR, and recover by restoring the backup `deploy.sh` took just before it ([restoring](#restoring-production)), then rolling back. Anything recorded after that backup is lost, so check before choosing this.

## Health, restarts and logs

- `/api/v1/health/` says the app responds; `/api/v1/ready/` also checks the database and answers 503 `{"status": "unavailable"}` (nothing more) when it can't reach it. Docker uses the readiness check for the backend's health.
- **An uptime monitor** (e.g. UptimeRobot, or a [healthchecks.io](https://healthchecks.io)-style pinger) can call `https://<domain>/api/v1/ready/` every few minutes (every 14 minutes is fine) and alert on anything but 200. Use `/ready/` to catch the database too, `/health/` for the app alone. Both are public, limited to 10 requests a minute per address (`DJANGO_THROTTLE_HEALTH`) and never query the database to count them ([security.md](security.md) item 12).
- Every container restarts automatically (`restart: unless-stopped`), after a crash or a reboot. The backend waits for a healthy database, and Caddy for a healthy backend.
- While the database is down, the app shows its "unavailable right now, try again shortly" messages (the API answers 5xx, `ApiError` `'unavailable'`), and recovers by itself once it's back.
- Logs: `docker compose --env-file .env.production -f compose.prod.yaml logs -f backend` (or `web`, `db`). Django logs warnings and errors, Gunicorn one line per request (never headers or bodies), Caddy its own errors.

## Backups

`scripts/backup-db.sh` takes a custom-format `pg_dump` inside the database container, checks the dump can be read, copies it off the server (`BACKUP_COPY_COMMAND`), deletes local dumps older than `BACKUP_RETENTION_DAYS`, and pings `BACKUP_HEALTHCHECK_URL` (success, or `/fail`).

- **Daily**, from the deploying user's crontab (`crontab -e`):

  ```
  30 2 * * * cd /path/to/tentant-tracker && scripts/backup-db.sh >>/var/log/rent-tracker-backup.log 2>&1
  ```

- **Before every deploy**: `deploy.sh` runs it.
- **Off the server**: set `BACKUP_COPY_COMMAND` (e.g. `rclone copy {} offsite:rent-tracker-backups`). Keep the off-site copies for at least as long as the local ones, and where only you can delete them.
- **Failures are visible**: with `BACKUP_HEALTHCHECK_URL` set, the monitor alerts you when a backup fails or stops arriving.
- The `postgres_data` volume survives restarts and redeploys, but **it isn't a backup**: it's lost with the server.

### Testing a backup

A backup only counts once it has been restored. After setting backups up, and then every month:

```bash
scripts/restore-test.sh /var/backups/rent-tracker/rent-tracker-<time>.dump
```

It restores the dump into a new, empty database (`rent_tracker_restore_test`, in a throwaway container on a network with no route out, so nothing in it can reach anyone), then compares `manage.py ledger_summary` from both databases: people, properties, memberships and tenancies, bill, payment and receipt counts, total billed, paid and outstanding, and checksums of every bill's balance, every payment and every receipt's reference and snapshot. Run it right after a backup, since anything written since shows up as a difference. To look around the restored data yourself, run the steps in the script by hand and stop before the cleanup.

### Restoring production

If the database is lost or must go back to a backup:

1. Stop the app so nothing writes: `docker compose … stop backend web`.
2. Recreate an empty database (new server, or remove the `postgres_data` volume, **only once you're sure the backup is good**) and start it: `docker compose … up -d --wait db`.
3. Restore: `docker compose … exec -T db sh -c 'pg_restore --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < <dump>`.
4. `scripts/deploy.sh` (it migrates if the code is newer than the backup), then the checks above.

### What a database backup doesn't cover

- **Firebase accounts** live in the Firebase project, not the database. The database keeps each person's phone number and Firebase id, so people sign in again as themselves. If the Firebase project itself were lost, people would need linking to the new one (re-entering their numbers in admin).
- **Secrets**: `.env.production` and the service-account key. Keep a copy in a password manager. A lost key can be replaced from the Firebase console (then delete the old one there); a lost `DJANGO_SECRET_KEY` can be replaced (admin sessions end); the database password can be reset in PostgreSQL.
- **Certificates**: Caddy gets new ones by itself.
- **The code**: it's in Git; `deploy/releases.log` says which commit was running.

## Render and Supabase

A free alternative to running a server: [render.yaml](../render.yaml) is a Render Blueprint for the API (Docker, free plan) and the Vue app (a static site), with the database on Supabase's free plan. Render's own free PostgreSQL isn't used: it's deleted after 30 days and has no backups.

```
 browser ──▶ rent-tracker.onrender.com       (static site: the built app, security headers)
        └──▶ rent-tracker-api.onrender.com   (Django + Gunicorn) ──TLS──▶ Supabase (session pooler)
```

How it differs from the single server:

- **Two origins.** The app calls the API's own URL (`VITE_API_BASE_URL`), which lets the app's origin through CORS (`CORS_ALLOWED_ORIGINS`). Render doesn't document forwarding a static site's `/api` to another service, so the one-origin layout isn't used.
- **Migrations run on start** (`backend/render-start.sh`): the free plan has no pre-deploy step. A no-op when there's nothing new; fine with the single instance the free plan allows.
- **No shell.** Admin logins and the Sheet import ([data-import.md](data-import.md)) run from your machine against Supabase (below).
- **Sleeps after 15 minutes without traffic** and takes about a minute to wake. An uptime monitor calling `https://rent-tracker-api.onrender.com/api/v1/ready/` every 14 minutes keeps it awake, and its database query keeps the Supabase project from pausing (it pauses after 7 days without activity; a paused project can be restored, with its data, for 90 days). A month awake uses most of the free plan's 750 instance hours, which is enough for this one service; the static site doesn't use them.
- **Health checks:** Render calls `/api/v1/health/` every few seconds, so `DJANGO_THROTTLE_HEALTH` is raised to 120/minute there (counted in memory, never in the database). Its checks are reported to send `Host: localhost:<port>`, so `localhost` is in `DJANGO_ALLOWED_HOSTS`. If a deploy never goes live, look for `DisallowedHost` in the logs.
- **Backups are yours to run.** Supabase's free plan has none, and `scripts/backup-db.sh` needs the single server. Take a daily `pg_dump` from another machine using the session pooler's details, encrypt it, and copy it off-site (e.g. `rclone` with a `crypt` remote). Never keep an unencrypted dump anywhere public, such as this public repository's CI artifacts. Test a restore as in [Testing a backup](#testing-a-backup).

### Setting it up

1. **Supabase:** create a project (pick the region nearest India).
   - **Turn off the Data API** (Project Settings > API > Data API): it publishes every table in the `public` schema over REST, and Django's tables have no PostgreSQL row-level security, so the project's public (anon) key would read every record ([security.md](security.md) item 3). Django is the only client.
   - **Connect > Session pooler** gives the host, port 5432 and user (`postgres.<project-ref>`) for the API. Not the direct connection (IPv6-only on the free plan, which Render can't reach) and not the transaction pooler on port 6543 (no prepared statements, and the app's payment locking needs a session).
2. **Render:** New > Blueprint, pick the repository. It reads `render.yaml` and asks for each `sync: false` value: the Supabase connection, `DJANGO_ADMIN_PATH`, the Firebase project and service-account key's fields (as in `backend/.env.example`; the private key can be pasted with its `\n`s), and the Firebase web config.
3. **Names:** the Blueprint assumes the services get `rent-tracker` and `rent-tracker-api.onrender.com`. If Render adds a suffix, update every URL in `render.yaml` that mentions them (`DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS`, `CORS_ALLOWED_ORIGINS`, `VITE_API_BASE_URL` and the Content-Security-Policy), or set your own domains.
4. **Firebase:** Authentication > Settings > Authorized domains: add the static site's domain. In `render.yaml`'s Content-Security-Policy, replace `YOUR-PROJECT` with the auth domain's project.
5. **An admin login,** from your machine with the backend image (or pipenv), pointing at Supabase:

   ```bash
   docker build -t rent-tracker-backend backend
   docker run --rm -it -e DJANGO_SECRET_KEY=unused -e FIREBASE_PROJECT_ID=<project> \
     -e POSTGRES_HOST=<pooler host> -e POSTGRES_PORT=5432 -e POSTGRES_DB=postgres \
     -e POSTGRES_USER=postgres.<project-ref> -e POSTGRES_PASSWORD=<password> \
     -e POSTGRES_SSLMODE=require rent-tracker-backend python manage.py createsuperuser
   ```

   Admin is at `https://rent-tracker-api.onrender.com/<DJANGO_ADMIN_PATH>`.
6. **The uptime monitor** (above), then the [checks after a deploy](#checks-after-a-deploy), with the static site's URL for the app and the API's for `/api/…`.

Releases deploy themselves: each service rebuilds when a commit to `main` touching it passes CI (`autoDeployTrigger: checksPass`). Render keeps the two previous deploys for rollback on the free plan; it doesn't undo migrations ([Rolling back](#rolling-back) applies).

**To check before relying on it:** `DJANGO_NUM_PROXIES` is `3`, the number of proxies users have measured in front of Render services, not a documented figure. Render appends to `X-Forwarded-For` without clearing it, so too high a number lets clients choose their own address for the rate limits, and too low makes everyone share one. Check that requests from two networks (say, Wi-Fi and mobile data) are counted separately, e.g. by running down a low `DJANGO_THROTTLE_ADDRESS` from one of them.

