from django import forms
from django.contrib import admin

from .clock import time_zone_choices
from .models import PropertyMessagingSettings


class PropertyMessagingSettingsForm(forms.ModelForm):
    # A list to pick from rather than free text; the choices are read when the form is built,
    # so they're never frozen into a migration.
    time_zone = forms.ChoiceField(choices=time_zone_choices)

    class Meta:
        model = PropertyMessagingSettings
        fields = ("property", "enabled", "time_zone", "send_time", "reminders_start")


@admin.register(PropertyMessagingSettings)
class PropertyMessagingSettingsAdmin(admin.ModelAdmin):
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
