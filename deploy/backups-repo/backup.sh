#!/usr/bin/env bash
# Backs up the Supabase database into this repository, encrypted. Run nightly by
# .github/workflows/backup.yml (and by hand from its "Run workflow" button before a release).
#
# 1. pg_dump of the public schema (Django's tables; Supabase's own schemas are left out).
# 2. Proves it: the dump must list the payments table, restore into an empty PostgreSQL with
#    no errors, and hold the same number of rows in every table as the live database.
# 3. Encrypts it with age to AGE_RECIPIENT (a public key: nothing here can decrypt it).
# 4. Commits it as rent-tracker/<year>/<month>/rent-tracker-<time>.dump.age and pushes.
# 5. Pings HEALTHCHECK_URL (success, or /fail), so a backup that fails or stops is noticed.
#
# The unencrypted dump only ever exists in a private temporary folder, deleted on exit.
# Never add `set -x`, or print the variables: the logs would show the password.
set -euo pipefail

: "${SUPABASE_HOST:?SUPABASE_HOST is not set}"
: "${SUPABASE_USER:?SUPABASE_USER is not set}"
: "${SUPABASE_PASSWORD:?SUPABASE_PASSWORD is not set}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT is not set}"
: "${RESTORE_PORT:?RESTORE_PORT is not set}"
healthcheck_url=${HEALTHCHECK_URL:-}
pg_bin=/usr/lib/postgresql/17/bin

ping() {
  [[ -z "$healthcheck_url" ]] || curl -fsS -m 10 --retry 3 "$healthcheck_url$1" >/dev/null || true
}

work=$(mktemp -d)
chmod 700 "$work"
finish() {
  local status=$?
  rm -rf "$work"
  if ((status != 0)); then
    echo "Backup FAILED." >&2
    ping /fail
  fi
}
trap finish EXIT

[[ "$AGE_RECIPIENT" == age1* ]] || {
  echo "AGE_RECIPIENT must be an age public key (age1…), never the private key." >&2
  exit 1
}

# The live database, over the session pooler. Each command gets the password on its own, so
# the empty restore database below never sees it.
live() {
  local command=$1
  shift
  PGPASSWORD=$SUPABASE_PASSWORD PGSSLMODE=require "$command" \
    --host="$SUPABASE_HOST" --port=5432 --username="$SUPABASE_USER" --dbname=postgres "$@"
}
# The throwaway database the workflow starts next to this job.
restored() {
  local command=$1
  shift
  PGPASSWORD=restore-test-only "$command" \
    --host=127.0.0.1 --port="$RESTORE_PORT" --username=postgres --dbname=postgres "$@"
}

stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump="$work/rent-tracker-$stamp.dump"

echo "Dumping the database…"
# To a file, not a pipe, so the dump records where each table's data starts.
live "$pg_bin/pg_dump" --format=custom --schema=public --no-owner --no-privileges --file="$dump"

contents=$("$pg_bin/pg_restore" --list "$dump")
grep -q "TABLE DATA public billing_payment" <<<"$contents" || {
  echo "The dump has no payments table." >&2
  exit 1
}

echo "Restoring it into an empty database…"
# A dump of one schema also creates that schema, and "public" already exists in an empty
# database, so that one entry is skipped.
grep -vE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' <<<"$contents" >"$work/restore.list"
restored "$pg_bin/pg_restore" --exit-on-error --no-owner --no-privileges \
  --use-list="$work/restore.list" "$dump"

echo "Comparing row counts…"
# Every table except those that change on their own (sessions, the rate-limit cache and
# counts). Only table names and counts are printed, never the records.
tables=$(restored "$pg_bin/psql" -XAtq -c "
  select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
    and table_name not in ('django_session', 'django_cache', 'accounts_adminloginattempts')
  order by table_name")
[[ -n "$tables" ]] || {
  echo "The restored database has no tables." >&2
  exit 1
}
query=$(sed -E "s/.*/select '&', count(*) from public.\"&\"/" <<<"$tables" | paste -sd'|' |
  sed 's/|/ union all /g')
live "$pg_bin/psql" -XAtq -F' ' -c "$query order by 1" >"$work/live.counts"
restored "$pg_bin/psql" -XAtq -F' ' -c "$query order by 1" >"$work/restored.counts"
if ! diff -u --label live --label restored "$work/live.counts" "$work/restored.counts"; then
  echo "The restored database differs from the live one (above). If records were written" \
    "during the backup, run it again." >&2
  exit 1
fi
cat "$work/restored.counts"

echo "Encrypting and committing it…"
folder="rent-tracker/${stamp:0:4}/${stamp:4:2}"
mkdir -p "$folder"
age --encrypt --recipient "$AGE_RECIPIENT" --output "$folder/rent-tracker-$stamp.dump.age" "$dump"

git add "$folder/rent-tracker-$stamp.dump.age"
git -c user.name="github-actions[bot]" \
  -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit -q -m "Backup $stamp"
for attempt in 1 2 3; do
  git push -q && break
  ((attempt < 3)) || exit 1
  git pull -q --rebase
done

ping ""
echo "Backed up to $folder/rent-tracker-$stamp.dump.age"
