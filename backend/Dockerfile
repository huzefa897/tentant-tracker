# syntax=docker/dockerfile:1
# The Django API for production: Gunicorn on port 8000, as a non-root user. Settings come from
# the environment at run time (compose.prod.yaml); nothing secret is in the image.

FROM python:3.13-slim AS build
RUN pip install --no-cache-dir pipenv
WORKDIR /build
COPY Pipfile Pipfile.lock ./
# The exact, hash-checked versions in Pipfile.lock, without the dev packages.
RUN pipenv requirements --hash > requirements.txt \
    && python -m venv /venv \
    && /venv/bin/pip install --no-cache-dir --require-hashes -r requirements.txt

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/venv/bin:$PATH" \
    WEB_CONCURRENCY=2
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=build /venv /venv
COPY . .
# Admin's CSS and JS, served by WhiteNoise. Placeholder settings: collectstatic reads no secrets
# and connects to nothing.
RUN DJANGO_SECRET_KEY=collectstatic-only FIREBASE_PROJECT_ID=collectstatic-only \
    POSTGRES_DB=unused POSTGRES_USER=unused POSTGRES_PASSWORD=unused POSTGRES_HOST=unused \
    python manage.py collectstatic --noinput
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-m", "config.healthcheck"]
# Logs (access and errors) go to stdout/stderr for the host to collect. The access log records
# the request line, never headers, so tokens aren't logged. Workers: WEB_CONCURRENCY. No control
# socket: nothing uses it, and the user has no home directory to keep it in.
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--access-logfile", "-", "--error-logfile", "-", "--no-control-socket"]
