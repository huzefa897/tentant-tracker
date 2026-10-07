#!/usr/bin/env bash
# Releases the checked-out commit to production (docs/deployment.md):
#   1. builds the images, tagged with the commit
#   2. backs up the database
#   3. runs the migrations once
#   4. starts the new release and waits until it's healthy
#   5. checks readiness
# Run the tests and the frontend build (CI does) before deploying. The previous images stay,
# so scripts/rollback.sh can go back to them.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/production.sh

[[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
  die "uncommitted changes: deploy a commit, so the release can be found again."
export RELEASE
RELEASE=$(git rev-parse --short HEAD)
previous=$(tail -n 1 deploy/releases.log 2>/dev/null | cut -d' ' -f2 || true)

echo "== 1. Building release $RELEASE"
compose build

echo "== 2. Backing up the database"
if [[ -n "$(compose ps -q --status running db)" ]]; then
  scripts/backup-db.sh
else
  echo "No database running yet (first deploy): nothing to back up."
fi

echo "== 3. Migrating, once"
compose up -d --wait db
compose run --rm backend python manage.py migrate --noinput
# The table that shares rate-limit counts between workers (DJANGO_SHARED_CACHE).
compose run --rm backend python manage.py createcachetable

echo "== 4. Starting release $RELEASE"
compose up -d --wait --no-build backend web

echo "== 5. Checking readiness"
compose exec -T backend python -m config.healthcheck || die "the backend isn't ready"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $RELEASE" >>deploy/releases.log

echo "Released $RELEASE. Now check the site: sign in, open a tenant, a bill and a receipt."
[[ -z "$previous" ]] || echo "To go back: scripts/rollback.sh $previous"
