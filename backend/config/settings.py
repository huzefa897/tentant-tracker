"""
Django settings for the Rent Tracker API.

Every environment-specific value comes from the environment, loaded from
backend/.env in development (see .env.example).
"""

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def env_list(name: str, default: str = "") -> list[str]:
    return [
        value.strip()
        for value in os.getenv(name, default).split(",")
        if value.strip()
    ]


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    return default if value is None else value.strip().lower() == "true"


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    return default if value is None or not value.strip() else int(value)


SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]

DEBUG = os.getenv("DJANGO_DEBUG", "False").lower() == "true"

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS")

# HTTPS. Off by default for plain-http development and tests; production turns them on in its
# environment (`manage.py check --deploy` lists what's missing). Behind a proxy that ends TLS,
# DJANGO_BEHIND_HTTPS_PROXY trusts its X-Forwarded-Proto, so redirects don't loop.
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT")
# The container's own health checks call these over plain http from inside it.
SECURE_REDIRECT_EXEMPT = [r"^api/v1/(health|ready)/$"]
if env_bool("DJANGO_BEHIND_HTTPS_PROXY"):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = env_int("DJANGO_SECURE_HSTS_SECONDS", 0)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS")
# HSTS preload is a decision for the whole domain and slow to undo, so it isn't made here.
SILENCED_SYSTEM_CHECKS = ["security.W021"]
# Admin's session and CSRF cookies only travel over HTTPS unless DEBUG (local http) is on.
SESSION_COOKIE_SECURE = env_bool("DJANGO_SECURE_COOKIES", not DEBUG)
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")
# Django's defaults, stated so they aren't loosened by accident: no framing, no MIME sniffing,
# same-origin referrers and opener.
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"

# Where Django admin is served. Set another path in production so it isn't at the default
# address bots try; its logins are throttled either way (config/middleware.py).
ADMIN_PATH = os.getenv("DJANGO_ADMIN_PATH", "admin/").strip("/") + "/"

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "rest_framework",
    "corsheaders",
    "accounts",
    "properties",
    "billing",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Serves admin's static files (collected into STATIC_ROOT in the image) in production.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    # Before CommonMiddleware so CORS headers are added to every response.
    "corsheaders.middleware.CorsMiddleware",
    # Cache-Control: no-store on every API response; outside the rate limit, so its 429 too.
    "config.middleware.ApiNoStoreMiddleware",
    # After CORS, so a 429 still carries CORS headers and the app can read it.
    "config.throttling.ApiRateLimitMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "config.middleware.AdminLoginThrottleMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ["POSTGRES_DB"],
        "USER": os.environ["POSTGRES_USER"],
        "PASSWORD": os.environ["POSTGRES_PASSWORD"],
        "HOST": os.environ["POSTGRES_HOST"],
        "PORT": os.getenv("POSTGRES_PORT", "5432"),
    },
}

# Set before the first migration: swapping the user model later is painful.
AUTH_USER_MODEL = "accounts.User"

# Staff passwords for Django admin (the app itself has none: phone sign-in). Argon2 first;
# the others only check older hashes, which are upgraded at the next login.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.ScryptPasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
# The property is in India. With USE_TZ, timestamps are stored in UTC.
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
# `manage.py collectstatic` copies admin's CSS and JS here (done when the image is built).
STATIC_ROOT = BASE_DIR / "staticfiles"

# The app sends no email yet. Development prints it; production uses SMTP unless set.
MAILERS = {
    "default": {
        "BACKEND": os.getenv(
            "DJANGO_EMAIL_BACKEND",
            "django.core.mail.backends.console.EmailBackend"
            if DEBUG
            else "django.core.mail.backends.smtp.EmailBackend",
        ),
    },
}

# CORS only controls which browser origins may call the API. It is not authentication. Only the
# API sends CORS headers (admin is same-origin only), to the origins listed, without cookies:
# the API uses bearer tokens.
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS")
CORS_URLS_REGEX = r"^/api/.*$"
CORS_ALLOW_CREDENTIALS = False

# Throttle counts live in the cache. Local memory is per process; with more than one process,
# set DJANGO_SHARED_CACHE to keep them in PostgreSQL (run `manage.py createcachetable` once).
CACHES = {
    "default": (
        {"BACKEND": "django.core.cache.backends.db.DatabaseCache", "LOCATION": "django_cache"}
        if env_bool("DJANGO_SHARED_CACHE")
        else {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}
    ),
}

# Plain console logs; the host collects them. Never log tokens, Authorization headers, OTPs,
# passwords, request bodies or phone numbers (docs/security.md). No mail_admins handler, which
# would email request details.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "plain": {"format": "{asctime} {levelname} {name}: {message}", "style": "{"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "plain"},
    },
    "root": {"handlers": ["console"], "level": os.getenv("DJANGO_LOG_LEVEL", "INFO")},
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": os.getenv("DJANGO_LOG_LEVEL", "INFO"),
            "propagate": False,
        },
    },
}

REST_FRAMEWORK = {
    # Endpoints require a signed-in user unless they opt out explicitly.
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    # Firebase ID tokens only (Authorization: Bearer). Django admin keeps its own session login.
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "accounts.authentication.FirebaseAuthentication",
    ],
    # Every API request is rate limited (config/throttling.py): per address before
    # authentication (ApiRateLimitMiddleware, "address"), then per signed-in person, with writes
    # limited more strictly. Over a limit is 429 with Retry-After.
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.UserRateThrottle",
        "config.throttling.WriteRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        # Generous: behind a proxy without DJANGO_NUM_PROXIES, every client shares one address.
        "address": os.getenv("DJANGO_THROTTLE_ADDRESS", "300/minute"),
        "user": os.getenv("DJANGO_THROTTLE_USER", "300/minute"),
        "writes": os.getenv("DJANGO_THROTTLE_WRITES", "30/minute"),
    },
    # How many proxies sit in front of Django, so a client's address is read from
    # X-Forwarded-For rather than the proxy's. 0 (the default) ignores X-Forwarded-For, which
    # clients can forge, and uses REMOTE_ADDR. Never None: DRF would trust the whole header.
    "NUM_PROXIES": env_int("DJANGO_NUM_PROXIES", 0),
}

# The test runner turns throttling off (a dummy cache), so tests don't share counts; the
# throttle tests turn it back on.
TEST_RUNNER = "config.test_runner.TestRunner"

# The Firebase project the Vue app signs in with. Its service-account credentials come
# from GOOGLE_APPLICATION_CREDENTIALS: a path to a JSON key kept outside the repository.
FIREBASE_PROJECT_ID = os.environ["FIREBASE_PROJECT_ID"]
