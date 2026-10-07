# syntax=docker/dockerfile:1
# The VITE_* build arguments are public by design (below), not secrets.
# check=skip=SecretsUsedInArgOrEnv
# The public web server: Caddy with the built Vue app. Caddy gets HTTPS certificates, serves the
# app and passes the API, admin and admin's static files to Django (deploy/web/Caddyfile).
# Build context: the repository root (its .dockerignore lists what's sent).

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Vite bakes VITE_* into the bundle at build time, so they're build arguments. All are public
# (the Firebase web config identifies the project); never pass a secret here.
ARG VITE_API_BASE_URL=""
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
RUN test -n "$VITE_FIREBASE_API_KEY" && test -n "$VITE_FIREBASE_AUTH_DOMAIN" \
    && test -n "$VITE_FIREBASE_PROJECT_ID" && test -n "$VITE_FIREBASE_APP_ID" \
    || { echo "Set every VITE_FIREBASE_* build argument (.env.production)." >&2; exit 1; }
RUN npm run build

FROM caddy:2-alpine
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
