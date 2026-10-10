import logging

from django.test.runner import DiscoverRunner
from django.test.utils import override_settings


class TestRunner(DiscoverRunner):
    """Runs tests with a dummy cache, so rate limits never carry over from one test to the
    next (tests of the limits themselves use a real cache, with override_settings), and with
    the console log handlers silenced, so errors that tests cause on purpose don't clutter the
    output. assertLogs still sees every record."""

    def setup_test_environment(self, **kwargs):
        super().setup_test_environment(**kwargs)
        self._dummy_cache = override_settings(
            CACHES={
                alias: {"BACKEND": "django.core.cache.backends.dummy.DummyCache"}
                for alias in ("default", "health")
            }
        )
        self._dummy_cache.enable()
        for name in ("", "django"):
            for handler in logging.getLogger(name).handlers:
                handler.setLevel(logging.CRITICAL + 1)

    def teardown_test_environment(self, **kwargs):
        self._dummy_cache.disable()
        super().teardown_test_environment(**kwargs)
