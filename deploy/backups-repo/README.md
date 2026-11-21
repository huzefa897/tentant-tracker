# Rent tracker backups

Nightly, encrypted backups of the rent tracker's database (Supabase), made by
[.github/workflows/backup.yml](.github/workflows/backup.yml) and [backup.sh](backup.sh).
**This repository must stay private.** The files are encrypted, but the repository is still
the only place they're kept off Supabase.

The source of these files is `deploy/backups-repo/` in the app's repository: change them
there, let its Backups workflow pass (it tests them against throwaway databases), then copy
them here. How backups fit with releases and restores is in its
`docs/deployment.md` (Render and Supabase > Backups on Supabase).

## What each run does

1. Dumps the `public` schema (Django's tables) over Supabase's session pooler, plus the
   extensions it uses, listed in `backup.sh` (`btree_gist`, for the no-overlapping-tenancies
   constraint). The run fails if a table in `public` belongs to an extension, because its
   rows wouldn't be in the backup.
2. Checks it: it must list the payments table and restore with no errors into an empty
   PostgreSQL 17 that the job starts. The restored database must then have the same tables
   as the live one, with the same number of rows in each. Three tables that change by
   themselves are left out: `django_session` (sessions), `django_cache` (rate-limit counts)
   and `accounts_adminloginattempts` (login-attempt counts).
3. Encrypts it with [age](https://age-encryption.org) to the public key in `AGE_RECIPIENT`.
   The private key is never here, so nothing in GitHub can read the backups.
4. Commits `rent-tracker/<year>/<month>/rent-tracker-<time>.dump.age`.
5. Pings the health check, which alerts when a run fails or a day passes without one.

## Setting it up

1. **The key**, on your own machine: `age-keygen -o key.txt`. Keep `key.txt` in your password
   manager (and nowhere in any repository); without it the backups can't be read. It prints
   the public key (`age1…`).
2. **The health check:** a free [healthchecks.io](https://healthchecks.io) check, period 1
   day, grace 3 hours, alerting you by email.
3. **Settings > Secrets and variables > Actions** in this repository:
   - Secrets: `SUPABASE_HOST` and `SUPABASE_USER` (Supabase > Connect > **Session pooler**:
     the host, and `postgres.<project-ref>`), `SUPABASE_PASSWORD` (the database password),
     `HEALTHCHECK_URL` (the check's ping URL).
   - Variable: `AGE_RECIPIENT`, the public key (`age1…`).
4. **Settings > Actions > General > Workflow permissions:** "Read and write permissions", so
   the job can push.
5. **Actions > Back up the database > Run workflow**, and check it passes and a
   `.dump.age` file appears.
6. **Clone this repository on your own machine**, and `git pull` it every so often. On the
   free plan nothing stops a force-push from rewriting the history here, so that clone is the
   copy GitHub can't take away.

## Reading a backup

```bash
age --decrypt --identity key.txt rent-tracker/<year>/<month>/<file>.dump.age > backup.dump
```

Better, test it without leaving it decrypted on disk, from the app's repository:

```bash
scripts/restore-test.sh --supabase .env.supabase --identity key.txt <file>.dump.age
```

## Size

Git keeps every file it was ever given, so deleting old backups doesn't make the repository
smaller. At about a megabyte a night that's a few hundred MB a year, well inside GitHub's
limits. If it ever passes 1 GB, you can start a fresh history, after keeping an archive of the
old one. That's the owner's decision, done by hand, never by the job or a coding agent.
