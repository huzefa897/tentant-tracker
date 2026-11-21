#!/usr/bin/env bash
# Restores a backup into Supabase (the Render setup), then proves it restored completely.
#
#   scripts/restore-supabase.sh --target .env.supabase --identity key.txt <file>.dump.age
#
# The steps around it (stop the API, empty the public schema, resume) are in
# docs/deployment.md, "Restoring Supabase". This script:
#
# 1. Decrypts the backup into a private temporary folder (deleted on exit), and checks it
#    holds the payments table.
# 2. Restores it into an empty, throwaway database first (on a Docker network with no route
#    out) and summarises it: what Supabase must hold once it's restored. A bad backup stops
#    here, before Supabase is touched.
# 3. Refuses unless the target's public schema is empty, so it never mixes a backup into
#    live data, and asks you to type the target's host (or pass it with --confirm).
# 4. Restores into the target, then compares its ledger_summary (counts, totals, checksums;
#    never the records) with the throwaway one's.
#
# The target file (gitignored, like every .env.*) is the one restore-test.sh uses:
# POSTGRES_HOST, POSTGRES_PORT=5432, POSTGRES_DB=postgres, POSTGRES_USER,
# POSTGRES_PASSWORD and POSTGRES_SSLMODE=require, one NAME=value a line, no quotes. Point it
# at the session pooler of the project being restored into. It needs Docker, age (for .age
# files) and the backend image built from the code the backup was taken with or later
# (docker build -t rent-tracker-backend backend; IMAGE overrides the name).
#
# To rehearse against a local PostgreSQL without TLS, set ALLOW_NO_SSL=1.
set -euo pipefail
cd "$(dirname "$0")/.."

die() {
  echo "Error: $*" >&2
  exit 1
}
usage="usage: scripts/restore-supabase.sh --target <env file> [--identity <age key>] [--confirm <host>] <dump file>"

target_env=""
identity=""
confirm=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --target) target_env=${2:?$usage}; shift 2 ;;
    --identity) identity=${2:?$usage}; shift 2 ;;
    --confirm) confirm=${2:?$usage}; shift 2 ;;
    -*) die "$usage" ;;
    *) break ;;
  esac
done
dump=${1:?$usage}
[[ -n "$target_env" ]] || die "$usage"
[[ -r "$target_env" ]] || die "can't read $target_env"
[[ -r "$dump" ]] || die "can't read $dump"

# A value from the target file (the last NAME=… line): read, never sourced.
target_value() {
  sed -n "s/^$1=//p" "$target_env" | tail -n 1
}
host=$(target_value POSTGRES_HOST)
port=$(target_value POSTGRES_PORT)
database=$(target_value POSTGRES_DB)
user=$(target_value POSTGRES_USER)
for name in POSTGRES_HOST POSTGRES_PORT POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD; do
  [[ -n "$(target_value "$name")" ]] || die "$target_env has no $name"
done
[[ "$(target_value POSTGRES_SSLMODE)" == require ]] || [[ "${ALLOW_NO_SSL:-}" == 1 ]] ||
  die "$target_env must set POSTGRES_SSLMODE=require (Supabase is reached over the internet)"

image=${IMAGE:-rent-tracker-backend}
docker image inspect "$image" >/dev/null 2>&1 ||
  die "no $image image: build it from the live code (docker build -t $image backend)"

source scripts/lib/restore.sh
workdir=$(mktemp -d)
chmod 700 "$workdir"
cleanup() {
  scratch_db_stop
  rm -rf "$workdir"
}
trap cleanup EXIT

# The target's connection as libpq reads it, for the PostgreSQL client containers. In the
# private work folder, so the password never appears in a command line.
{
  echo "PGHOST=$host"
  echo "PGPORT=$port"
  echo "PGDATABASE=$database"
  echo "PGUSER=$user"
  echo "PGPASSWORD=$(target_value POSTGRES_PASSWORD)"
  echo "PGSSLMODE=$(target_value POSTGRES_SSLMODE)"
} >"$workdir/target.env"
chmod 600 "$workdir/target.env"
target_psql() {
  docker run --rm --env-file "$workdir/target.env" postgres:17 psql -XAtq -v ON_ERROR_STOP=1 "$@"
}

dump=$(decrypted_dump "$dump" "$identity")
check_dump "$dump"

# 2. What the target must hold once restored.
scratch_db_start "rent-tracker-restore-$$"
scratch_db_args
echo "Restoring the backup into the empty database first…"
restore_dump "${scratch_args[@]}" <"$dump"
summary "${scratch_args[@]}" >"$workdir/expected"
scratch_db_stop
echo "The backup restores. It holds:"
cat "$workdir/expected"

# 3. The target must be empty: tables, sequences, views, indexes, functions or types.
echo "Checking $host is empty…"
objects=$(target_psql -c "
  select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public')
       + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public')
       + (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = 'public' and t.typrelid = 0 and t.typelem = 0)") ||
  die "couldn't connect to $host (check $target_env, and that the project isn't paused)"
if [[ "$objects" != 0 ]]; then
  die "the public schema on $host isn't empty ($objects objects). Restore only into an empty \
one: a new project, or the steps in docs/deployment.md (Restoring Supabase) to empty it, \
once this backup has passed a restore test."
fi

echo
echo "About to restore into: host $host, port $port, database $database, user $user"
if [[ -z "$confirm" ]]; then
  [[ -t 0 ]] || die "not a terminal: pass --confirm <host> to confirm the target"
  read -r -p "Type the host to go ahead: " confirm
fi
[[ "$confirm" == "$host" ]] || die "that isn't $host: nothing was restored"

# 4. The restore, then the check.
echo "Restoring into $host…"
restore_dump --env-file "$workdir/target.env" <"$dump" ||
  die "the restore failed part way (above). $host now holds part of the backup: empty its \
public schema again before retrying."

echo "Comparing $host with the backup…"
summary --env-file "$target_env" >"$workdir/restored"
if ! diff -u --label backup --label "$host" "$workdir/expected" "$workdir/restored"; then
  die "$host differs from the backup (above). Don't resume the API: find out why, empty the \
public schema and restore again."
fi
echo "Restored: $host matches the backup."
echo "Next: resume the API service in Render (it migrates if the code is newer than the \
backup), then the checks after a deploy (docs/deployment.md)."
