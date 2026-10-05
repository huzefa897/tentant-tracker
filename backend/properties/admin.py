from django.contrib import admin

from .models import Property, PropertyMembership


class PropertyMembershipInline(admin.TabularInline):
    model = PropertyMembership
    extra = 0
    autocomplete_fields = ("user",)
    readonly_fields = ("created_at",)


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
    list_display = ("name", "contact_number", "is_active", "created_at")
    list_filter = ("is_active",)
    search_fields = ("name", "address")
    readonly_fields = ("id", "created_at", "updated_at")
    inlines = (PropertyMembershipInline,)


@admin.register(PropertyMembership)
class PropertyMembershipAdmin(admin.ModelAdmin):
    """Grants property access. Nothing else creates memberships."""

    list_display = ("user", "property", "role", "is_active", "created_at")
    list_filter = ("role", "is_active", "property")
    search_fields = ("user__username", "user__phone_number", "property__name")
    autocomplete_fields = ("user", "property")
    readonly_fields = ("created_at",)
