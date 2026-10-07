#!/usr/bin/env bash
# Backs up the production database: a custom-format pg_dump, checked to be readable, copied off
# this server (BACKUP_COPY_COMMAND) and pruned after BACKUP_RETENTION_DAYS. Reports success or
# failure to BACKUP_HEALTHCHECK_URL, so a backup that stops running is noticed.
#
# Run it daily from cron, and before every deploy that changes the database (deploy.sh does).
# Prints the dump's path. A Docker volume is not a backup: it's lost with the server.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/production.sh

backup_dir=$(env_value BACKUP_DIR /var/backups/rent-tracker)
retention_days=$(env_value BACKUP_RETENTION_DAYS 30)
copy_command=$(env_value BACKUP_COPY_COMMAND)
healthcheck_url=$(env_value BACKUP_HEALTHCHECK_URL)

ping() {
  [[ -z "$healthcheck_url" ]] || curl -fsS -m 10 --retry 3 "$healthcheck_url$1" >/dev/null || true
}

partial=""
# On any exit: an unfinished dump is removed, and a failure is reported. (An EXIT trap, not
# ERR, which doesn't fire for failures inside functions such as compose.)
finish() {
  local status=$?
  [[ -z "$partial" ]] || rm -f "$partial"
  if ((status != 0)); then
    echo "Backup FAILED." >&2
    ping /fail
  fi
}
trap finish EXIT

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
dump="$backup_dir/rent-tracker-$(date -u +%Y%m%dT%H%M%SZ).dump"
partial="$dump.partial"

# Inside the database container, over its local socket: no password leaves it.
compose exec -T db sh -c 'pg_dump --format=custom -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >"$partial"
# A dump that can't be listed, or has no payments table, is no backup. (Listed in full first:
# grep -q stopping early would fail the pipeline.)
contents=$(compose exec -T db pg_restore --list <"$partial")
grep -q "TABLE DATA public billing_payment" <<<"$contents"
mv "$partial" "$dump"
partial=""
chmod 600 "$dump"

if [[ -n "$copy_command" ]]; then
  quoted=$(printf '%q' "$dump")
  bash -c "${copy_command//\{\}/$quoted}"
else
  echo "Warning: BACKUP_COPY_COMMAND is empty, so this backup is only on this server." >&2
fi

find "$backup_dir" -name 'rent-tracker-*.dump' -type f -mtime +"$retention_days" -delete
ping ""
echo "$dump"
