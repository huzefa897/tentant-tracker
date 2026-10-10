#!/usr/bin/env bash
# Goes back to an earlier release's images (deploy/releases.log lists them).
#   scripts/rollback.sh <release>
#
# It does NOT undo database migrations. Releases should keep the database usable by the
# previous release; when one can't, restore the backup deploy.sh took (docs/deployment.md).
# It uses the current compose.prod.yaml and .env.production: if a later release changed them,
# check out the earlier compose.prod.yaml first.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/production.sh

export RELEASE=${1:?usage: scripts/rollback.sh <release> (see deploy/releases.log)}
for image in rent-tracker-backend rent-tracker-web; do
  docker image inspect "$image:$RELEASE" >/dev/null 2>&1 || die "no image $image:$RELEASE here"
done

compose up -d --wait --no-build backend web
compose exec -T backend python -m config.healthcheck || die "the backend isn't ready"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $RELEASE (rollback)" >>deploy/releases.log
echo "Rolled back to $RELEASE."
