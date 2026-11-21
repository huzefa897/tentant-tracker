# shellcheck shell=bash
# The callers set workdir and image, and read scratch_args and the other scratch_* values.
# shellcheck disable=SC2154,SC2034
# Shared by restore-test.sh and restore-supabase.sh (sourced, not run). Expects `die` and a
# private work folder in $workdir (mkdir 700, deleted on exit by the caller).

# A decrypted copy of the backup: the file itself if it isn't encrypted, or the .age file
# decrypted with the key into $workdir. Prints the path.
decrypted_dump() {
  local dump=$1 identity=$2
  if [[ "$dump" != *.age ]]; then
    echo "$dump"
    return
  fi
  [[ -n "$identity" ]] || die "$dump is encrypted: pass the key with --identity"
  [[ -r "$identity" ]] || die "can't read $identity"
  command -v age >/dev/null || die "age isn't installed"
  age --decrypt --identity "$identity" --output "$workdir/backup.dump" "$dump"
  echo "$workdir/backup.dump"
}

# Fails unless the dump holds the payments table's data (a dump of the wrong database, or of
# nothing, would otherwise restore "successfully").
check_dump() {
  local contents
  # Into a variable first: grep -q stops reading early, which pipefail would count as failure.
  contents=$(docker run --rm -i postgres:17 pg_restore --list <"$1")
  grep -q "TABLE DATA public billing_payment" <<<"$contents" ||
    die "the backup has no payments table: is it a backup of this app?"
}

# Restores the dump (stdin) into the database the PG* settings name, with a PostgreSQL 17
# client in a throwaway container; any further arguments go to `docker run` (the settings,
# the network). A dump of the public schema alone (the Supabase backups) also creates that
# schema, which already exists, so that one entry is skipped.
#
# The tenancy overlap constraint needs the btree_gist extension (properties migration 0004),
# and a schema dump leaves extensions out unless they're named. The nightly backups name it
# (backup.sh's --extension), and the dump then creates it in the schema it was in on Supabase
# ("extensions"), but not that schema: it's created here first, as backup.sh does. Older
# dumps don't hold it, so it's created here, as the migration does.
#
# The dump is copied into the container because --use-list needs it as a file; the container
# is removed afterwards.
restore_dump() {
  docker run --rm -i "$@" postgres:17 sh -euc '
    run_sql() { psql -XAtq -v ON_ERROR_STOP=1 --dbname="$PGDATABASE" -c "$1"; }
    cat >/tmp/backup.dump
    pg_restore --list /tmp/backup.dump |
      grep -vE "^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public " >/tmp/restore.list
    if grep -E " EXTENSION - btree_gist( |\$)" /tmp/restore.list >/tmp/extension.list; then
      schema=$(pg_restore --use-list=/tmp/extension.list --file=- /tmp/backup.dump |
        sed -nE "s/^CREATE EXTENSION .* WITH SCHEMA \"?([A-Za-z_][A-Za-z0-9_]*)\"?;\$/\\1/p")
      [ -n "$schema" ] || { echo "Error: no schema for btree_gist in the dump" >&2; exit 1; }
      run_sql "create schema if not exists \"$schema\""
    else
      run_sql "create extension if not exists btree_gist"
    fi
    pg_restore --exit-on-error --no-owner --no-privileges --use-list=/tmp/restore.list \
      --dbname="$PGDATABASE" /tmp/backup.dump'
}

# An empty, throwaway PostgreSQL 17 on a Docker network with no route out, so nothing in the
# restored data can reach anyone. Sets scratch_password; scratch_db_stop removes it.
scratch_db_start() {
  scratch_name=$1
  scratch_database=rent_tracker_restore_test
  scratch_password=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
  echo "Starting an empty database ($scratch_name)…"
  docker network create --internal "$scratch_name" >/dev/null
  docker run -d --name "$scratch_name" --network "$scratch_name" \
    -e POSTGRES_DB="$scratch_database" -e POSTGRES_USER=restore \
    -e POSTGRES_PASSWORD="$scratch_password" postgres:17 >/dev/null
  # Over TCP: the image's first-start setup server only listens on its socket.
  local _
  for _ in $(seq 60); do
    docker exec "$scratch_name" pg_isready -q -h 127.0.0.1 -U restore -d "$scratch_database" && return
    sleep 1
  done
  die "it didn't start"
}
scratch_db_stop() {
  [[ -n "${scratch_name:-}" ]] || return 0
  docker rm -f "$scratch_name" >/dev/null 2>&1 || true
  docker network rm "$scratch_name" >/dev/null 2>&1 || true
}
# docker run arguments that reach the scratch database: as PG* (for restore_dump) and as
# POSTGRES_* (for summary).
scratch_db_args() {
  scratch_args=(--network "$scratch_name"
    -e PGHOST="$scratch_name" -e PGDATABASE="$scratch_database" -e PGUSER=restore
    -e PGPASSWORD="$scratch_password"
    -e POSTGRES_HOST="$scratch_name" -e POSTGRES_DB="$scratch_database" -e POSTGRES_USER=restore
    -e POSTGRES_PASSWORD="$scratch_password")
}

# manage.py ledger_summary (counts, totals and checksums, never the records) of the database
# that the docker run arguments point to, worked out by the backend image $image.
summary() {
  docker run --rm -e DJANGO_SECRET_KEY=restore-test-only -e FIREBASE_PROJECT_ID=restore-test-only \
    -e DJANGO_ALLOWED_HOSTS=localhost "$@" "$image" python manage.py ledger_summary
}
