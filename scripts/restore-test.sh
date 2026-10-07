#!/usr/bin/env bash
# Proves a backup can be restored: restores the dump into a new, empty, throwaway database
# (on a Docker network with no route out, so nothing it could trigger reaches anyone), then
# compares its ledger_summary (counts, totals, checksums) with the live database's.
#
#   scripts/restore-test.sh /var/backups/rent-tracker/rent-tracker-<time>.dump
#
# Run it right after a backup: records written since make the live summary differ.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/production.sh

dump=${1:?usage: scripts/restore-test.sh <dump file>}
[[ -r "$dump" ]] || die "can't read $dump"

name="rent-tracker-restore-test-$$"
database=rent_tracker_restore_test
password=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
workdir=$(mktemp -d)
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
  rm -rf "$workdir"
}
trap cleanup EXIT

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
docker exec -i "$name" pg_restore --exit-on-error --no-owner --no-privileges \
  -U restore -d "$database" <"$dump"

# The live backend's image, so the summary is worked out by the same code on both sides.
image=$(docker inspect -f '{{.Config.Image}}' "$(compose ps -q backend)")
echo "Summarising the restored database and the live one…"
docker run --rm --network "$name" \
  -e DJANGO_SECRET_KEY=restore-test-only -e FIREBASE_PROJECT_ID=restore-test-only \
  -e DJANGO_ALLOWED_HOSTS=localhost -e POSTGRES_HOST="$name" -e POSTGRES_DB="$database" \
  -e POSTGRES_USER=restore -e POSTGRES_PASSWORD="$password" \
  "$image" python manage.py ledger_summary >"$workdir/restored"
compose exec -T backend python manage.py ledger_summary >"$workdir/live"

if diff -u --label live --label restored "$workdir/live" "$workdir/restored"; then
  cat "$workdir/restored"
  echo "Restore test passed: the restored database matches the live one."
else
  die "the restored database differs from the live one (above). If records were written since \
the backup, take a new backup and test that."
fi
