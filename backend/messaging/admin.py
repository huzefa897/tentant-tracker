from django import forms
from django.contrib import admin

from properties.admin import PropertyAdmin

from .clock import DEFAULT_TIME_ZONE, time_zone_choices
from .senders.providers import DEFAULT_PROVIDER, provider_choices, registry
from .models import Message, MessagingRun, PropertyMessagingSettings, RentDueReminderItem

SETTINGS_FIELDS = ("enabled", "provider", "time_zone", "send_time", "reminders_start")


class MessagingSettingsForm(forms.ModelForm):
    # A list to pick from rather than free text; the choices are read when the form is built,
    # so they're never frozen into a migration.
    time_zone = forms.ChoiceField(choices=time_zone_choices, initial=DEFAULT_TIME_ZONE)
    # The registered providers (messaging/senders/providers.py), read the same way.
    provider = forms.ChoiceField(
        choices=provider_choices,
        initial=DEFAULT_PROVIDER,
        help_text=PropertyMessagingSettings._meta.get_field("provider").help_text,
    )

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
    list_display = (
        "property",
        "enabled",
        "provider",
        "provider_ready",
        "time_zone",
        "send_time",
        "reminders_start",
    )
    list_filter = ("enabled", "provider")
    search_fields = ("property__name",)
    autocomplete_fields = ("property",)
    fieldsets = (
        (None, {"fields": ("property", "enabled", "provider", "provider_ready")}),
        ("When", {"fields": ("time_zone", "send_time", "reminders_start")}),
        ("Technical", {"classes": ("collapse",), "fields": ("created_at", "updated_at")}),
    )

    def get_readonly_fields(self, request, obj=None):
        readonly = ("provider_ready", "created_at", "updated_at")
        # The property is the row's key: a property's settings never move to another one.
        return ("property", *readonly) if obj else readonly

    @admin.display(description="Provider set up")
    def provider_ready(self, settings):
        return provider_status(settings.provider)


def provider_status(name: str) -> str:
    """Whether this server can send with the provider: its credentials are environment
    settings, so admin can only say whether they're there, never show them."""
    return registry.status(name)


class PropertyMessagingSettingsInline(admin.StackedInline):
    """The property's messaging settings on its own admin page. Left untouched, saving the
    property creates no row (messaging stays off). Turned off with Send messages, never
    deleted here, so the time zone, send time and start are kept for turning it back on."""

    model = PropertyMessagingSettings
    form = MessagingSettingsForm
    fields = (*SETTINGS_FIELDS, "provider_ready")
    readonly_fields = ("provider_ready",)
    can_delete = False
    max_num = 1
    verbose_name = "messaging"
    verbose_name_plural = "messaging"

    @admin.display(description="Provider set up")
    def provider_ready(self, settings):
        return provider_status(settings.provider if settings and settings.pk else DEFAULT_PROVIDER)


# Added from here, not listed in properties/admin.py, so `properties` never imports messaging
# (docs/messaging.md, "Where it lives"). The property admin reads its inlines on each request.
# PropertyAdmin's GrantedByMixin.save_formset saves every inline's objects, this one's too.
if PropertyMessagingSettingsInline not in PropertyAdmin.inlines:
    PropertyAdmin.inlines = (*PropertyAdmin.inlines, PropertyMessagingSettingsInline)


# The history: what was sent, and whether each run happened. Read-only: nothing is added,
# edited or deleted here, so the record stays what the runner wrote.
class ReadOnlyAdmin(admin.ModelAdmin):
    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


def masked(number: str) -> str:
    """The last four digits only, for lists: the full number is on the message's own page."""
    return f"…{number[-4:]}" if number else ""


class RentDueReminderItemInline(admin.TabularInline):
    model = RentDueReminderItem
    fields = ("month", "due_date", "stage", "released_at")
    readonly_fields = fields
    extra = 0
    can_delete = False
    verbose_name = "month"
    verbose_name_plural = "months"

    def get_queryset(self, request):
        # Each row reads its rental period twice (month, due date).
        return super().get_queryset(request).select_related("rental_period")

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    @admin.display(description="Month")
    def month(self, item):
        return f"{item.rental_period.period_month:%B %Y}"

    @admin.display(description="Due date")
    def due_date(self, item):
        return item.rental_period.due_date


@admin.register(Message)
class MessageAdmin(ReadOnlyAdmin):
    list_display = (
        "created_at",
        "property",
        "tenant",
        "type",
        "months",
        "status",
        "reason",
        "provider",
        "to",
    )
    list_filter = ("status", "type", "tenancy__property", "created_at")
    date_hierarchy = "created_at"
    search_fields = ("tenancy__name", "tenancy__flat_number")
    list_select_related = ("tenancy__property",)
    inlines = (RentDueReminderItemInline,)
    fieldsets = (
        (None, {"fields": ("tenancy", "type", "status", "reason", "local_date")}),
        ("Sent", {"fields": ("channel", "recipient", "body", "provider", "provider_message_id")}),
        ("When", {"fields": ("created_at", "attempted_at", "updated_at", "run")}),
    )

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .prefetch_related("reminder_items__rental_period")
        )

    @admin.display(description="Property", ordering="tenancy__property__name")
    def property(self, message):
        return message.tenancy.property

    @admin.display(description="Tenant", ordering="tenancy__name")
    def tenant(self, message):
        return f"{message.tenancy.name} ({message.tenancy.flat_number})"

    @admin.display(description="Months")
    def months(self, message):
        return ", ".join(
            f"{item.rental_period.period_month:%b %Y} ({item.get_stage_display()})"
            for item in message.reminder_items.all()
        )

    @admin.display(description="To")
    def to(self, message):
        return masked(message.recipient)


@admin.register(MessagingRun)
class MessagingRunAdmin(ReadOnlyAdmin):
    list_display = (
        "started_at",
        "finished_at",
        "trigger",
        "dry_run",
        "properties_checked",
        "planned",
        "sent",
        "failed",
        "unknown",
        "skipped",
        "held",
        "has_errors",
        "stopped_early",
    )
    list_filter = ("trigger", "dry_run", "stopped_early", "started_at")
    date_hierarchy = "started_at"

    @admin.display(description="Errors", boolean=True)
    def has_errors(self, run):
        return bool(run.errors)
