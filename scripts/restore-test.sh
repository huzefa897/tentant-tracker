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

source scripts/lib/restore.sh
workdir=$(mktemp -d)
chmod 700 "$workdir"
cleanup() {
  scratch_db_stop
  rm -rf "$workdir"
}
trap cleanup EXIT

dump=$(decrypted_dump "$dump" "$identity")
check_dump "$dump"

scratch_db_start "rent-tracker-restore-test-$$"
scratch_db_args
echo "Restoring the backup…"
restore_dump "${scratch_args[@]}" <"$dump"

echo "Summarising the restored database and the live one…"
summary "${scratch_args[@]}" >"$workdir/restored"
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
