from django.contrib import admin
from django.db.models import Count, Prefetch, Q

from .models import Property, PropertyMembership, Tenancy, business_date


class GrantedByMixin:
    """Records the admin who granted a membership, on add only."""

    def save_formset(self, request, form, formset, change):
        for membership in formset.save(commit=False):
            if isinstance(membership, PropertyMembership) and membership.pk is None:
                membership.granted_by = request.user
            membership.save()
        for membership in formset.deleted_objects:
            membership.delete()
        formset.save_m2m()


class MembershipInlineBase(admin.TabularInline):
    model = PropertyMembership
    extra = 0
    readonly_fields = ("granted_by", "created_at")
    verbose_name = "property access"
    verbose_name_plural = "property access"
    # Memberships are ended (made inactive), never deleted: PROTECT keeps history.
    can_delete = False


class PersonAccessInline(MembershipInlineBase):
    """On a property: who has access."""

    fields = ("user", "role", "is_active", "granted_by", "created_at")
    autocomplete_fields = ("user",)
    verbose_name = "member"
    verbose_name_plural = "members"


@admin.register(Property)
class PropertyAdmin(GrantedByMixin, admin.ModelAdmin):
    list_display = ("name", "owners", "member_count", "contact_number", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name", "address")
    readonly_fields = ("id", "created_at", "updated_at")
    fieldsets = (
        (None, {"fields": ("name", "address", "contact_number", "is_active")}),
        ("Technical", {"classes": ("collapse",), "fields": ("id", "created_at", "updated_at")}),
    )
    inlines = (PersonAccessInline,)

    def get_queryset(self, request):
        active_owners = PropertyMembership.objects.filter(
            role=PropertyMembership.Role.OWNER, is_active=True
        ).select_related("user")
        return (
            super()
            .get_queryset(request)
            .annotate(active_members=Count("memberships", filter=Q(memberships__is_active=True)))
            .prefetch_related(Prefetch("memberships", active_owners, to_attr="active_owners"))
        )

    @admin.display(description="Owners")
    def owners(self, obj):
        return ", ".join(str(m.user) for m in obj.active_owners) or "—"

    @admin.display(description="Active members", ordering="active_members")
    def member_count(self, obj):
        return obj.active_members


@admin.register(PropertyMembership)
class PropertyMembershipAdmin(admin.ModelAdmin):
    """Grants property access. Nothing else creates memberships."""

    list_display = ("user", "property", "role", "is_active", "granted_by", "created_at")
    list_filter = ("property", "role", "is_active")
    list_select_related = ("user", "property", "granted_by")
    search_fields = (
        "user__name",
        "user__phone_number",
        "user__email",
        "user__username",
        "property__name",
    )
    autocomplete_fields = ("user", "property")
    readonly_fields = ("granted_by", "created_at")
    fields = ("user", "property", "role", "is_active", "granted_by", "created_at")

    def has_delete_permission(self, request, obj=None):
        # End access by making it inactive; deleting would lose who had access when.
        return False

    def save_model(self, request, obj, form, change):
        if not change:
            obj.granted_by = request.user
        super().save_model(request, obj, form, change)


class TenancyStatusFilter(admin.SimpleListFilter):
    title = "status"
    parameter_name = "status"

    def lookups(self, request, model_admin):
        return Tenancy.Status.choices

    def queryset(self, request, queryset):
        if self.value() in Tenancy.Status.values:
            return queryset.with_status(self.value(), business_date())
        return queryset


@admin.register(Tenancy)
class TenancyAdmin(admin.ModelAdmin):
    """Tenancies are entered here for now; the app only reads them."""

    list_display = (
        "name",
        "property",
        "flat_number",
        "rent_amount",
        "start_date",
        "end_date",
        "status",
    )
    list_filter = ("property", TenancyStatusFilter)
    list_select_related = ("property",)
    search_fields = ("name", "flat_number", "mobile_number")
    readonly_fields = ("status", "id", "created_at", "updated_at")
    fieldsets = (
        (None, {"fields": ("property", "name", "flat_number", "mobile_number")}),
        ("Rent", {"fields": ("rent_amount", "rent_due_day", "electricity_rate", "deposit_amount")}),
        (
            "Occupancy",
            {
                "fields": ("start_date", "end_date", "status"),
                "description": "A flat can have one tenancy at a time; end dates are inclusive.",
            },
        ),
        ("Technical", {"classes": ("collapse",), "fields": ("id", "created_at", "updated_at")}),
    )

    @admin.display(description="Status")
    def status(self, obj):
        if obj.pk is None or obj.start_date is None:
            return "—"
        return obj.get_status_display_on(business_date())
