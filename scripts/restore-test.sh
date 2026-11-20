#!/usr/bin/env bash
# Proves a backup can be restored: restores the dump into a new, empty, throwaway database
# (on a Docker network with no route out, so nothing it could trigger reaches anyone), then
# compares its ledger_summary (counts, totals, checksums) with the live database's.
#
#   scripts/restore-test.sh /var/backups/rent-tracker/rent-tracker-<time>.dump
#
# Supabase (the Render setup): compare with Supabase instead of this server's database, using
# the backend image built from the code that's live (docker build -t rent-tracker-backend
# backend; IMAGE overrides the name). A backup from the backups repository is decrypted with
# --identity into a private temporary folder, deleted on exit.
#
#   scripts/restore-test.sh --supabase .env.supabase --identity key.txt <file>.dump.age
#
# .env.supabase (gitignored) holds POSTGRES_HOST, POSTGRES_PORT=5432, POSTGRES_DB=postgres,
# POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_SSLMODE=require, one NAME=value a line, no
# quotes (Docker's --env-file format).
#
# Run it right after a backup: records written since make the live summary differ.
set -euo pipefail
cd "$(dirname "$0")/.."

die() {
  echo "Error: $*" >&2
  exit 1
}
usage="usage: scripts/restore-test.sh [--supabase <env file>] [--identity <age key>] <dump file>"

supabase_env=""
identity=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --supabase) supabase_env=${2:?$usage}; shift 2 ;;
    --identity) identity=${2:?$usage}; shift 2 ;;
    -*) die "$usage" ;;
    *) break ;;
  esac
done
dump=${1:?$usage}
[[ -r "$dump" ]] || die "can't read $dump"

if [[ -n "$supabase_env" ]]; then
  [[ -r "$supabase_env" ]] || die "can't read $supabase_env"
  image=${IMAGE:-rent-tracker-backend}
  docker image inspect "$image" >/dev/null 2>&1 ||
    die "no $image image: build it from the live code (docker build -t $image backend)"
else
  source scripts/lib/production.sh
  # The live backend's image, so the summary is worked out by the same code on both sides.
  image=$(docker inspect -f '{{.Config.Image}}' "$(compose ps -q backend)")
fi

name="rent-tracker-restore-test-$$"
database=rent_tracker_restore_test
password=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
workdir=$(mktemp -d)
chmod 700 "$workdir"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
  rm -rf "$workdir"
}
trap cleanup EXIT

if [[ "$dump" == *.age ]]; then
  [[ -n "$identity" ]] || die "$dump is encrypted: pass the key with --identity"
  command -v age >/dev/null || die "age isn't installed"
  age --decrypt --identity "$identity" --output "$workdir/backup.dump" "$dump"
  dump="$workdir/backup.dump"
fi

echo "Starting an empty database ($name)…"
docker network create --internal "$name" >/dev/null
docker run -d --name "$name" --network "$name" \
  -e POSTGRES_DB="$database" -e POSTGRES_USER=restore -e POSTGRES_PASSWORD="$password" \
  postgres:17 >/dev/null
# Over TCP: the image's first-start setup server only listens on its socket.
for _ in $(seq 60); do
  docker exec "$name" pg_isready -q -h 127.0.0.1 -U restore -d "$database" && break
  sleep 1
done
docker exec "$name" pg_isready -q -h 127.0.0.1 -U restore -d "$database" || die "it didn't start"

echo "Restoring $dump…"
contents=$(docker exec -i "$name" pg_restore --list <"$dump")
if grep -qE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' <<<"$contents"; then
  # A dump of the public schema alone (the Supabase backups) also creates it, and it already
  # exists in an empty database: skip that one entry. -L needs the dump as a file.
  grep -vE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' <<<"$contents" >"$workdir/restore.list"
  docker cp "$dump" "$name:/tmp/backup.dump"
  docker cp "$workdir/restore.list" "$name:/tmp/restore.list"
  docker exec "$name" pg_restore --exit-on-error --no-owner --no-privileges \
    --use-list=/tmp/restore.list -U restore -d "$database" /tmp/backup.dump
else
  docker exec -i "$name" pg_restore --exit-on-error --no-owner --no-privileges \
    -U restore -d "$database" <"$dump"
fi

summary() {
  docker run --rm -e DJANGO_SECRET_KEY=restore-test-only -e FIREBASE_PROJECT_ID=restore-test-only \
    -e DJANGO_ALLOWED_HOSTS=localhost "$@" "$image" python manage.py ledger_summary
}
echo "Summarising the restored database and the live one…"
summary --network "$name" -e POSTGRES_HOST="$name" -e POSTGRES_DB="$database" \
  -e POSTGRES_USER=restore -e POSTGRES_PASSWORD="$password" >"$workdir/restored"
if [[ -n "$supabase_env" ]]; then
  summary --env-file "$supabase_env" >"$workdir/live"
else
  compose exec -T backend python manage.py ledger_summary >"$workdir/live"
fi

if diff -u --label live --label restored "$workdir/live" "$workdir/restored"; then
  cat "$workdir/restored"
  echo "Restore test passed: the restored database matches the live one."
else
  die "the restored database differs from the live one (above). If records were written since \
the backup, take a new backup and test that."
fi
