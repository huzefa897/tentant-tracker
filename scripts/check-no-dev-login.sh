#!/usr/bin/env bash
# Fails if a production build (dist/) contains dev login, which must exist only in `npm run dev`
# (src/services/devLogin.ts, docs/security.md). Run after `npm run build`.
#
# It looks for the "dev-login-only" marker, which the code carries on purpose (the storage key in
# devLogin.ts, the data attribute on DevSignInButton.vue), so rewording the UI can't make it pass
# by accident.
set -euo pipefail

dist="${1:-dist}"
if [ ! -d "$dist" ]; then
  echo "No $dist/ folder: run npm run build first." >&2
  exit 2
fi

if grep -rl 'dev-login-only' "$dist"; then
  echo "Dev login code is in the production build (files above)." >&2
  exit 1
fi
echo "No dev login code in $dist/."
