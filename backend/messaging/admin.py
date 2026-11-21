from django import forms
from django.contrib import admin

from properties.admin import PropertyAdmin

from .clock import DEFAULT_TIME_ZONE, time_zone_choices
from .models import PropertyMessagingSettings

SETTINGS_FIELDS = ("enabled", "time_zone", "send_time", "reminders_start")


class MessagingSettingsForm(forms.ModelForm):
    # A list to pick from rather than free text; the choices are read when the form is built,
    # so they're never frozen into a migration.
    time_zone = forms.ChoiceField(choices=time_zone_choices, initial=DEFAULT_TIME_ZONE)

    class Meta:
        model = PropertyMessagingSettings
        fields = SETTINGS_FIELDS


class PropertyMessagingSettingsForm(MessagingSettingsForm):
    class Meta(MessagingSettingsForm.Meta):
        fields = ("property", *SETTINGS_FIELDS)


@admin.register(PropertyMessagingSettings)
class PropertyMessagingSettingsAdmin(admin.ModelAdmin):
    """Every property's messaging settings in one list: which are sending, and when. Deleting a
    row here turns messaging off for that property and forgets its settings."""

    form = PropertyMessagingSettingsForm
    list_display = ("property", "enabled", "time_zone", "send_time", "reminders_start")
    list_filter = ("enabled",)
    search_fields = ("property__name",)
    autocomplete_fields = ("property",)
    fieldsets = (
        (None, {"fields": ("property", "enabled")}),
        ("When", {"fields": ("time_zone", "send_time", "reminders_start")}),
        ("Technical", {"classes": ("collapse",), "fields": ("created_at", "updated_at")}),
    )

    def get_readonly_fields(self, request, obj=None):
        readonly = ("created_at", "updated_at")
        # The property is the row's key: a property's settings never move to another one.
        return ("property", *readonly) if obj else readonly


class PropertyMessagingSettingsInline(admin.StackedInline):
    """The property's messaging settings on its own admin page. Left untouched, saving the
    property creates no row (messaging stays off). Turned off with Send messages, never
    deleted here, so the time zone, send time and start are kept for turning it back on."""

    model = PropertyMessagingSettings
    form = MessagingSettingsForm
    fields = SETTINGS_FIELDS
    can_delete = False
    max_num = 1
    verbose_name = "messaging"
    verbose_name_plural = "messaging"


# Added from here, not listed in properties/admin.py, so `properties` never imports messaging
# (docs/messaging.md, "Where it lives"). The property admin reads its inlines on each request.
if PropertyMessagingSettingsInline not in PropertyAdmin.inlines:
    PropertyAdmin.inlines = (*PropertyAdmin.inlines, PropertyMessagingSettingsInline)
