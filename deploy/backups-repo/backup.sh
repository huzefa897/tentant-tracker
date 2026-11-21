#!/usr/bin/env bash
# Backs up the Supabase database into this repository, encrypted. Run nightly by
# .github/workflows/backup.yml (and by hand from its "Run workflow" button before a release).
#
# 1. pg_dump of the public schema (Django's tables; Supabase's own schemas are left out),
#    plus the extensions it uses (btree_gist, for one of its constraints).
# 2. Proves it: the dump must list the payments table and restore into an empty PostgreSQL
#    with no errors, and the restored database must have the same tables as the live one,
#    with the same number of rows in each (three tables that change by themselves aside).
# 3. Encrypts it with age to AGE_RECIPIENT (a public key: nothing here can decrypt it).
# 4. Commits it as rent-tracker/<year>/<month>/rent-tracker-<time>.dump.age and pushes.
# 5. Pings HEALTHCHECK_URL (success, or /fail), so a backup that fails or stops is noticed.
#
# The unencrypted dump only ever exists in a private temporary folder, deleted on exit.
# Never add `set -x`, or print the variables: the logs would show the password.
set -euo pipefail

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

# After the trap, so a missing secret also pings /fail.
: "${SUPABASE_HOST:?SUPABASE_HOST is not set}"
: "${SUPABASE_USER:?SUPABASE_USER is not set}"
: "${SUPABASE_PASSWORD:?SUPABASE_PASSWORD is not set}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT is not set}"
: "${RESTORE_PORT:?RESTORE_PORT is not set}"

[[ "$AGE_RECIPIENT" == age1* ]] || {
  echo "AGE_RECIPIENT must be an age public key (age1…), never the private key." >&2
  exit 1
}

# The live database, over the session pooler. Each command gets the password on its own, so
# the empty restore database below never sees it. SUPABASE_PORT and SUPABASE_SSLMODE are only
# for the app repository's test of this script (.github/workflows/backups.yml there), against
# a local database: the workflow here never sets them.
supabase_port=${SUPABASE_PORT:-5432}
supabase_sslmode=${SUPABASE_SSLMODE:-require}
live() {
  local command=$1
  shift
  PGPASSWORD=$SUPABASE_PASSWORD PGSSLMODE=$supabase_sslmode "$command" \
    --host="$SUPABASE_HOST" --port="$supabase_port" --username="$SUPABASE_USER" \
    --dbname=postgres "$@"
}
# The throwaway database the workflow starts next to this job. Its messages, and the
# client's, are in English (C), so the restore log filter below recognises them.
restored() {
  local command=$1
  shift
  LC_ALL=C PGOPTIONS="-c lc_messages=C -c client_min_messages=warning" \
    PGPASSWORD=restore-test-only "$command" \
    --host=127.0.0.1 --port="$RESTORE_PORT" --username=postgres --dbname=postgres "$@"
}

stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump="$work/rent-tracker-$stamp.dump"

# A table an extension created in public isn't dumped (the extension owns it), so its rows
# wouldn't be in the backup. Rather than leave it out of the checks, the backup stops.
owned=$(live "$pg_bin/psql" -XAtq -c "
  select c.relname from pg_class c
  join pg_depend d on d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')")
[[ -z "$owned" ]] || {
  printf 'These tables in public belong to an extension, so their rows would not be backed up:\n%s\n' \
    "$owned" >&2
  exit 1
}

# A schema filter leaves out every extension, so the ones public uses are named here:
# btree_gist, for the operator class of the tenancy_no_overlapping_occupancy constraint. A
# migration that makes public depend on another extension must add it to this list, or the
# restore check fails.
extensions=(btree_gist)
extension_args=()
for name in "${extensions[@]}"; do
  extension_args+=("--extension=$name")
done

echo "Dumping the database…"
# To a file, not a pipe, so the dump records where each table's data starts.
live "$pg_bin/pg_dump" --format=custom --schema=public "${extension_args[@]}" \
  --no-owner --no-privileges --file="$dump"

contents=$("$pg_bin/pg_restore" --list "$dump")
grep -q "TABLE DATA public billing_payment" <<<"$contents" || {
  echo "The dump has no payments table." >&2
  exit 1
}

echo "Restoring it into an empty database…"
# A dump of one schema also creates that schema, and "public" already exists in an empty
# database, so that one entry is skipped.
grep -vE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' <<<"$contents" >"$work/restore.list"
# Each extension must exist in the restore container's PostgreSQL, or the restore fails with
# a message the filter below hides, so check here and name it.
for name in "${extensions[@]}"; do
  available=$(restored "$pg_bin/psql" -XAtq -v name="$name" \
    <<<"select count(*) from pg_available_extensions where name = :'name'")
  ((available == 1)) || {
    echo "The restore check's PostgreSQL 17 doesn't have the extension $name." >&2
    exit 1
  }
done
# The dump creates each extension in the schema it's in on Supabase ("extensions"), but not
# that schema itself, so the empty database gets it first.
live "$pg_bin/psql" -XAtq -v names="$(printf '%s\n' "${extensions[@]}")" >"$work/schemas.sql" <<<"
  select distinct format('create schema if not exists %I;', n.nspname)
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = any(string_to_array(:'names', E'\\n')) and n.nspname <> 'public'"
restored "$pg_bin/psql" -Xq -v ON_ERROR_STOP=1 -f "$work/schemas.sql"
# Any message from PostgreSQL can quote a record (a bad value, a duplicate key), and a
# quoted record can run over several lines, so no line after a message starts can be
# trusted: from the first PostgreSQL message on, everything stays in the private folder, and
# that message's line is cut where the message starts. A pg_restore error, warning, detail or
# hint line with no message found in it is cut after its label too, in case it holds one in a
# form the filter doesn't know. Before that point, pg_restore's own lines hold only object
# names: --verbose names each object as it goes, and only the last such line is kept, so the
# log names what failed (--exit-on-error stops at the first error) without listing every
# object on a run that works. The "while PROCESSING TOC" and "from TOC entry" lines are kept.
# Hiding never switches back off, since a hidden record could fake any line after it, so only
# the first message can be traced to an object. NOTICEs are turned off (client_min_messages)
# so that the first message is the failure; a WARNING before it would still hide the rest.
status=0
restored "$pg_bin/pg_restore" --verbose --exit-on-error --no-owner --no-privileges \
  --use-list="$work/restore.list" "$dump" 2>"$work/restore.err" || status=$?
awk -v failed=$((status != 0)) '
  function flush() { if (last != "") print last; last = "" }
  hiding { hidden++; next }
  !/^pg_restore: / { hiding = 1; hidden++; next }
  match($0, /(^|[^A-Za-z_])(ERROR|FATAL|PANIC|WARNING|NOTICE|INFO|LOG|DETAIL|HINT|CONTEXT):  /) ||
  match($0, /^pg_restore: (error|warning|detail|hint): /) {
    flush()
    print substr($0, 1, RSTART + RLENGTH - 1) "(rest hidden: it can quote a record)"
    hiding = 1
    next
  }
  /^pg_restore: (while PROCESSING TOC:|from TOC entry )/ { flush(); print; next }
  { last = $0 }
  END {
    if (failed && !hiding) flush()
    if (hidden) print "(" hidden " more line" (hidden == 1 ? "" : "s") " hidden)"
  }
' "$work/restore.err" >"$work/restore.shown"
cat "$work/restore.shown" >&2
if ((status != 0)); then
  [[ -s "$work/restore.shown" ]] ||
    echo "pg_restore exited with status $status and wrote no error line." >&2
  echo "The dump doesn't restore." >&2
  exit 1
fi

echo "Comparing tables and row counts…"
# Every table in public, live and restored, except three that change by themselves during a
# backup: django_session, django_cache (the rate-limit cache) and accounts_adminloginattempts
# (login-attempt counts). From pg_class, not information_schema, so a table the Supabase user
# has no rights on is still listed (and its count then fails the run). Both sides are sorted
# with LC_ALL=C, since the two servers can sort names differently. Only table names and
# counts are printed, never the records.
from_tables="from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    and c.relname not in ('django_session', 'django_cache', 'accounts_adminloginattempts')"
# Both lists, so a table missing from the dump or the restore fails instead of going uncounted.
live "$pg_bin/psql" -XAtq -c "select c.relname $from_tables" | LC_ALL=C sort >"$work/live.tables"
restored "$pg_bin/psql" -XAtq -c "select c.relname $from_tables" | LC_ALL=C sort \
  >"$work/restored.tables"
[[ -s "$work/live.tables" ]] || {
  echo "The live database has no tables." >&2
  exit 1
}
if ! diff -u --label live --label restored "$work/live.tables" "$work/restored.tables"; then
  echo "The restored database doesn't have the same tables as the live one (above)." >&2
  exit 1
fi
# PostgreSQL writes the count query itself, so every table name is quoted safely.
query=$(restored "$pg_bin/psql" -XAtq -c "
  select string_agg(format('select %L, count(*) from public.%I', c.relname, c.relname),
    ' union all ') $from_tables")
live "$pg_bin/psql" -XAtq -F' ' -c "$query" | LC_ALL=C sort >"$work/live.counts"
restored "$pg_bin/psql" -XAtq -F' ' -c "$query" | LC_ALL=C sort >"$work/restored.counts"
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
