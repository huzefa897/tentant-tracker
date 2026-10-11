#!/usr/bin/env bash
# Dry-runs merging the current branch into the base branch and into the branch of every other
# open PR, and lists the files that would conflict. Uses `git merge-tree`, so
# nothing is checked out or written (needs git >= 2.38).
#
# A conflict with the base fails (exit 1). A conflict with another branch is a warning, since
# whichever lands second resolves it; pass --strict to fail on those too.
#
# Only textual conflicts: a clean merge can still break the build (e.g. a rename on one branch
# and a new caller of the old name on another). CI's build of the merged PR catches that for
# the base; for other branches, merge them locally and run the checks.
#
# Usage: scripts/check-merge-conflicts.sh [--base origin/dev] [--self <branch>] [--strict] [--no-fetch]
#
# Runs on macOS's bash 3.2 as well as CI's bash 5: no mapfile, ${var^^} or empty arrays under
# set -u, and no quotes inside comments in $(...) or <(...), which bash 3.2 misparses.

set -euo pipefail

base='origin/dev'
self=''
strict=false
fetch=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) base="$2"; shift ;;
    --self) self="$2"; shift ;;
    --strict) strict=true ;;
    --no-fetch) fetch=false ;;
    -h | --help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [[ -z "$self" ]]; then
  self="$(git rev-parse --abbrev-ref HEAD)"
fi

if $fetch; then
  git fetch --quiet --prune origin
fi

# GitHub Actions turns these into annotations on the PR; elsewhere they're plain lines.
report() {
  local level="$1" message="$2"
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    echo "::${level}::${message}"
  else
    echo "$(tr '[:lower:]' '[:upper:]' <<<"$level"): ${message}"
  fi
}

# Prints conflicting files and returns 1 on conflict, 0 when clean, 2 if git couldn't merge.
check_against() {
  local ref="$1" output status=0
  output="$(git merge-tree --write-tree --name-only --no-messages HEAD "$ref" 2>&1)" || status=$?

  case "$status" in
    0) return 0 ;;
    # First line is the tree id; the rest are the conflicting paths.
    1) tail -n +2 <<<"$output" | sed '/^$/d; s/^/    /'; return 1 ;;
    *) echo "    $output"; return 2 ;;
  esac
}

failed=false
warned=false

echo "Checking $self against $base"
if files="$(check_against "$base")"; then
  echo "  clean"
else
  report error "$self conflicts with $base"
  echo "$files"
  failed=true
fi

# Other in-flight work: branches of open PRs. Without gh, fall back to every remote branch not
# merged into the base, which also lists squash-merged branches (git can't tell they landed).
if pr_heads="$(gh pr list --state open --limit 100 --json headRefName --jq '.[].headRefName' 2>/dev/null)"; then
  candidates="$(sed 's|^|origin/|' <<<"$pr_heads")"
else
  echo 'gh unavailable: checking all unmerged remote branches (squash-merged ones show up too)'
  candidates="$(git branch --remotes --no-merged "$base" --format='%(refname:short)')"
fi

# Skip PRs from forks: their branches aren't on origin.
others=''
while read -r ref; do
  if git rev-parse --verify --quiet "$ref^{commit}" >/dev/null; then
    others="${others}${ref}"$'\n'
  fi
done < <(grep -v -x -e '' -e "$base" -e "origin/$self" -e 'origin/HEAD' -e 'origin' <<<"$candidates" || true)

# Read from fd 3, so nothing in the loop can consume the list.
while read -r ref <&3; do
  [[ -n "$ref" ]] || continue
  echo "Checking $self against $ref"
  if files="$(check_against "$ref")"; then
    echo "  clean"
  else
    report warning "$self conflicts with $ref (whichever merges second must resolve it)"
    echo "$files"
    warned=true
  fi
done 3<<<"$others"

if $failed || { $strict && $warned; }; then
  exit 1
fi

echo 'No blocking merge conflicts.'
