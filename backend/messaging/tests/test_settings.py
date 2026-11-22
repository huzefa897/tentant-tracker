from datetime import UTC, date, datetime, time

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.urls import reverse

from messaging.clock import FixedClock
from messaging.models import PropertyMessagingSettings
from properties.models import Property


class PropertyMessagingSettingsModelTests(TestCase):
    def setUp(self):
        self.property = Property.objects.create(name="Tower", address="A")

    def test_defaults_are_off_in_india_at_half_past_eleven(self):
        settings = PropertyMessagingSettings.objects.create(property=self.property)

        settings.refresh_from_db()
        self.assertFalse(settings.enabled)
        self.assertEqual(settings.time_zone, "Asia/Kolkata")
        self.assertEqual(settings.send_time, time(11, 30))
        self.assertIsNone(settings.reminders_start)

    def test_one_row_per_property_keyed_by_it(self):
        settings = PropertyMessagingSettings.objects.create(property=self.property)

        self.assertEqual(settings.pk, self.property.pk)
        self.assertEqual(self.property.messaging_settings, settings)
        with transaction.atomic(), self.assertRaises(IntegrityError):
            PropertyMessagingSettings.objects.create(property=self.property)

    def test_a_property_without_settings_has_messaging_off(self):
        settings = PropertyMessagingSettings.for_property(self.property)

        self.assertFalse(settings.enabled)
        self.assertTrue(settings._state.adding)
        self.assertFalse(PropertyMessagingSettings.objects.exists())

    def test_for_property_returns_saved_settings(self):
        PropertyMessagingSettings.objects.create(
            property=self.property, enabled=True, reminders_start=date(2026, 12, 1)
        )

        self.assertTrue(PropertyMessagingSettings.for_property(self.property).enabled)

    def test_turning_on_needs_reminders_start(self):
        settings = PropertyMessagingSettings(property=self.property, enabled=True)

        with self.assertRaises(ValidationError) as caught:
            settings.full_clean()
        self.assertIn("reminders_start", caught.exception.message_dict)

    def test_database_refuses_on_without_reminders_start(self):
        with transaction.atomic(), self.assertRaises(IntegrityError):
            PropertyMessagingSettings.objects.create(property=self.property, enabled=True)

    def test_defaults_to_textbee_and_refuses_an_unknown_provider(self):
        settings = PropertyMessagingSettings(property=self.property, provider="pigeon")

        self.assertEqual(PropertyMessagingSettings().provider, "textbee")
        with self.assertRaises(ValidationError) as caught:
            settings.full_clean()
        self.assertIn("provider", caught.exception.message_dict)

    def test_refuses_an_unknown_time_zone(self):
        settings = PropertyMessagingSettings(property=self.property, time_zone="India")

        with self.assertRaises(ValidationError) as caught:
            settings.full_clean()
        self.assertIn("time_zone", caught.exception.message_dict)

    def test_deleted_with_its_property(self):
        PropertyMessagingSettings.objects.create(property=self.property)

        self.property.delete()

        self.assertFalse(PropertyMessagingSettings.objects.exists())


class LocalTimeTests(TestCase):
    """Days and the send time are the property's own, never the server's or settings.TIME_ZONE."""

    def settings_in(self, time_zone, send_time=time(11, 30)):
        return PropertyMessagingSettings(time_zone=time_zone, send_time=send_time)

    def test_local_date_is_the_propertys_day(self):
        # 20:00 UTC on the 21st is already the 22nd in India, still the 21st in New York.
        clock = FixedClock(datetime(2026, 11, 21, 20, 0, tzinfo=UTC))

        self.assertEqual(self.settings_in("Asia/Kolkata").local_date(clock), date(2026, 11, 22))
        self.assertEqual(self.settings_in("America/New_York").local_date(clock), date(2026, 11, 21))

    @override_settings(TIME_ZONE="UTC")
    def test_ignores_the_server_time_zone(self):
        clock = FixedClock(datetime(2026, 11, 21, 20, 0, tzinfo=UTC))

        self.assertEqual(self.settings_in("Asia/Kolkata").local_date(clock), date(2026, 11, 22))

    def test_send_time_reached_from_the_send_time_on(self):
        settings = self.settings_in("Asia/Kolkata")
        cases = {
            datetime(2026, 11, 21, 5, 59, tzinfo=UTC): False,  # 11:29 IST
            datetime(2026, 11, 21, 6, 0, tzinfo=UTC): True,  # 11:30 IST
            datetime(2026, 11, 21, 9, 0, tzinfo=UTC): True,  # 14:30 IST, a late run
            datetime(2026, 11, 21, 18, 29, tzinfo=UTC): True,  # 23:59 IST
            datetime(2026, 11, 21, 18, 30, tzinfo=UTC): False,  # 00:00 IST on the 22nd
        }
        for moment, reached in cases.items():
            with self.subTest(moment=moment):
                self.assertEqual(settings.send_time_reached(FixedClock(moment)), reached)

    def test_send_time_is_in_each_propertys_zone(self):
        # 06:00 UTC: 11:30 in India, 10:00 in Dubai.
        clock = FixedClock(datetime(2026, 11, 21, 6, 0, tzinfo=UTC))

        self.assertTrue(self.settings_in("Asia/Kolkata").send_time_reached(clock))
        self.assertFalse(self.settings_in("Asia/Dubai").send_time_reached(clock))


class PropertyMessagingSettingsAdminTests(TestCase):
    def setUp(self):
        admin = get_user_model().objects.create_superuser(username="admin", password="x")
        self.client.force_login(admin)
        self.property = Property.objects.create(name="Tower", address="A")

    def test_adds_settings_for_a_property(self):
        response = self.client.post(
            reverse("admin:messaging_propertymessagingsettings_add"),
            {
                "property": self.property.pk,
                "enabled": "on",
                "provider": "textbee",
                "time_zone": "Asia/Kolkata",
                "send_time": "11:30",
                "reminders_start": "2026-12-01",
            },
        )

        self.assertEqual(response.status_code, 302)
        settings = PropertyMessagingSettings.objects.get(property=self.property)
        self.assertTrue(settings.enabled)
        self.assertEqual(settings.reminders_start, date(2026, 12, 1))

    def test_turning_on_without_reminders_start_is_refused(self):
        response = self.client.post(
            reverse("admin:messaging_propertymessagingsettings_add"),
            {
                "property": self.property.pk,
                "enabled": "on",
                "provider": "textbee",
                "time_zone": "Asia/Kolkata",
                "send_time": "11:30",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Set when reminders start before turning messaging on.")
        self.assertFalse(PropertyMessagingSettings.objects.exists())

    def test_time_zone_is_picked_from_the_list(self):
        response = self.client.post(
            reverse("admin:messaging_propertymessagingsettings_add"),
            {"property": self.property.pk, "provider": "textbee", "time_zone": "Mars/Olympus", "send_time": "11:30"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(PropertyMessagingSettings.objects.exists())
        self.assertContains(response, '<option value="Asia/Kolkata">')

    def test_property_cannot_change_once_saved(self):
        settings = PropertyMessagingSettings.objects.create(property=self.property)
        other = Property.objects.create(name="Other", address="B")

        response = self.client.post(
            reverse("admin:messaging_propertymessagingsettings_change", args=[settings.pk]),
            {"property": other.pk, "provider": "textbee",
                "time_zone": "Asia/Kolkata", "send_time": "12:00"},
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(PropertyMessagingSettings.objects.get().property, self.property)
        self.assertEqual(PropertyMessagingSettings.objects.get().send_time, time(12, 0))

    def test_list_shows_each_property(self):
        PropertyMessagingSettings.objects.create(property=self.property)

        response = self.client.get(reverse("admin:messaging_propertymessagingsettings_changelist"))

        self.assertContains(response, "Tower")
        self.assertContains(response, "Asia/Kolkata")

    @override_settings(
        MESSAGING_ENABLED=True,
        TEXTBEE_API_KEY="test-key-not-real",
        TEXTBEE_DEVICE_ID="d",
        TEXTBEE_BASE_URL="http://api.textbee.dev",
    )
    def test_a_provider_set_up_wrong_says_so_instead_of_failing(self):
        PropertyMessagingSettings.objects.create(property=self.property)

        for url in (
            reverse("admin:messaging_propertymessagingsettings_changelist"),
            reverse("admin:messaging_propertymessagingsettings_change", args=[self.property.pk]),
            reverse("admin:properties_property_change", args=[self.property.pk]),
        ):
            with self.subTest(url=url):
                response = self.client.get(url)

                self.assertContains(response, "must be https")

    @override_settings(
        MESSAGING_ENABLED=False, TEXTBEE_API_KEY="test-key-not-real", TEXTBEE_DEVICE_ID="d"
    )
    def test_credentials_are_checked_while_messaging_is_off_on_the_server(self):
        PropertyMessagingSettings.objects.create(property=self.property)

        response = self.client.get(reverse("admin:messaging_propertymessagingsettings_changelist"))

        self.assertContains(response, "Ready, but messaging is off on this server")


class PropertyPageMessagingTests(TestCase):
    """The property's own admin page carries its messaging settings."""

    def setUp(self):
        admin = get_user_model().objects.create_superuser(username="admin", password="x")
        self.client.force_login(admin)
        self.property = Property.objects.create(name="Tower", address="A")
        self.url = reverse("admin:properties_property_change", args=[self.property.pk])

    def post_property(self, messaging=None, initial=0, url=None):
        data = {
            "name": "Tower",
            "address": "A",
            "is_active": "on",
            "payment_timing": "postpaid",
            "memberships-TOTAL_FORMS": "0",
            "memberships-INITIAL_FORMS": "0",
            "messaging_settings-TOTAL_FORMS": "1",
            "messaging_settings-INITIAL_FORMS": str(initial),
            "messaging_settings-0-property": str(self.property.pk),
            "messaging_settings-0-provider": "textbee",
            "messaging_settings-0-time_zone": "Asia/Kolkata",
            "messaging_settings-0-send_time": "11:30",
        }
        for field, value in (messaging or {}).items():
            data[f"messaging_settings-0-{field}"] = value
        if url is not None:  # a new property: no id yet
            del data["messaging_settings-0-property"]
        return self.client.post(url or self.url, data)

    def test_new_property_with_messaging_on_in_one_save(self):
        response = self.post_property(
            {"enabled": "on", "reminders_start": "2026-12-01"},
            url=reverse("admin:properties_property_add"),
        )

        self.assertEqual(response.status_code, 302)
        created = Property.objects.exclude(pk=self.property.pk).get()
        self.assertTrue(PropertyMessagingSettings.objects.get(property=created).enabled)

    def test_new_property_without_messaging_creates_no_settings(self):
        response = self.post_property(url=reverse("admin:properties_property_add"))

        self.assertEqual(response.status_code, 302)
        self.assertEqual(Property.objects.count(), 2)
        self.assertFalse(PropertyMessagingSettings.objects.exists())

    def test_property_page_shows_messaging(self):
        response = self.client.get(self.url)

        self.assertContains(response, "messaging_settings-TOTAL_FORMS")
        self.assertContains(response, "Send messages")
        self.assertContains(response, '<option value="Asia/Kolkata" selected>')

    def test_saving_the_property_untouched_creates_no_settings(self):
        response = self.post_property()

        self.assertEqual(response.status_code, 302)
        self.assertFalse(PropertyMessagingSettings.objects.exists())

    def test_turns_messaging_on_from_the_property(self):
        response = self.post_property({"enabled": "on", "reminders_start": "2026-12-01"})

        self.assertEqual(response.status_code, 302)
        settings = PropertyMessagingSettings.objects.get(property=self.property)
        self.assertTrue(settings.enabled)
        self.assertEqual(settings.reminders_start, date(2026, 12, 1))

    def test_turning_on_without_reminders_start_is_refused(self):
        response = self.post_property({"enabled": "on"})

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Set when reminders start before turning messaging on.")
        self.assertFalse(PropertyMessagingSettings.objects.exists())

    def test_turned_off_keeps_the_other_settings(self):
        PropertyMessagingSettings.objects.create(
            property=self.property,
            enabled=True,
            send_time=time(10, 0),
            reminders_start=date(2026, 12, 1),
        )

        response = self.post_property(
            {"send_time": "10:00", "reminders_start": "2026-12-01"}, initial=1
        )

        self.assertEqual(response.status_code, 302)
        settings = PropertyMessagingSettings.objects.get()
        self.assertFalse(settings.enabled)
        self.assertEqual(settings.send_time, time(10, 0))
        self.assertEqual(settings.reminders_start, date(2026, 12, 1))

    def test_cannot_be_deleted_from_the_property_page(self):
        PropertyMessagingSettings.objects.create(property=self.property)

        response = self.client.get(self.url)

        self.assertNotContains(response, "messaging_settings-0-DELETE")

    def test_can_be_deleted_from_the_messaging_list(self):
        PropertyMessagingSettings.objects.create(property=self.property)

        response = self.client.post(
            reverse("admin:messaging_propertymessagingsettings_delete", args=[self.property.pk]),
            {"post": "yes"},
        )

        self.assertEqual(response.status_code, 302)
        self.assertFalse(PropertyMessagingSettings.objects.exists())
        self.assertTrue(Property.objects.filter(pk=self.property.pk).exists())
