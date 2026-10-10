# Shared by the production scripts (sourced, not run). Works from the repository root, with
# the settings in .env.production (ENV_FILE overrides it, e.g. for a local trial).

ENV_FILE=${ENV_FILE:-.env.production}

die() {
  echo "Error: $*" >&2
  exit 1
}

[[ -f "$ENV_FILE" ]] || die "$ENV_FILE not found: copy .env.production.example and fill it in."

# docker compose for production, with its settings file.
compose() {
  docker compose --env-file "$ENV_FILE" -f compose.prod.yaml "$@"
}

# A value from the settings file (the last NAME=… line), or the default, read as Compose reads
# it: a quoted value is what's inside the quotes; an unquoted one ends at a " #" comment. Read,
# never sourced: values like commands with spaces needn't be shell-quoted, and nothing runs.
env_value() {
  local value
  value=$(sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1)
  case $value in
    \"*) value=${value#\"}; value=${value%%\"*} ;;
    \'*) value=${value#\'}; value=${value%%\'*} ;;
    *) value=$(sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//' <<<"$value") ;;
  esac
  echo "${value:-${2:-}}"
}
