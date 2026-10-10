#!/bin/sh
# The backend's start command on Render (render.yaml). Render's free plan has no pre-deploy step,
# so migrations run here, before Gunicorn, each time the service starts (a no-op when there's
# nothing new). Only safe with a single instance, which is all the free plan allows.
set -e
python manage.py migrate --noinput
# The rate-limit counts' table (DJANGO_SHARED_CACHE); does nothing once it exists.
python manage.py createcachetable
exec gunicorn config.wsgi:application --bind "0.0.0.0:${PORT:-8000}" \
    --access-logfile - --error-logfile - --no-control-socket
