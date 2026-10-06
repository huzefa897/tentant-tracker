from django.contrib import admin

from .calculations import entry_amounts
from .models import Payment, RentEntry


class ViewOnlyAdminMixin:
    """Bills and payments are created through the app's API, which copies the tenancy's charges,
    checks occupancy and locks the bill so payments never exceed it. Changing them here would
    bypass those rules and the balances built on them; corrections need deliberate rules first."""

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class PaymentInline(ViewOnlyAdminMixin, admin.TabularInline):
    model = Payment
    fields = ("paid_date", "amount", "notes", "created_by", "created_at")
    readonly_fields = fields
    extra = 0
    show_change_link = True


@admin.register(RentEntry)
class RentEntryAdmin(ViewOnlyAdminMixin, admin.ModelAdmin):
    list_display = (
        "tenancy",
        "billing_month",
        "rent_amount",
        "total_due",
        "total_paid",
        "outstanding",
        "created_by",
    )
    list_filter = ("tenancy__property",)
    list_select_related = ("tenancy", "created_by")
    search_fields = ("tenancy__name", "tenancy__flat_number")
    date_hierarchy = "billing_month"
    fields = (
        "id",
        "tenancy",
        "billing_month",
        "rent_amount",
        "electricity_units",
        "electricity_rate",
        "water_amount",
        "total_due",
        "total_paid",
        "outstanding",
        "notes",
        "created_by",
        "created_at",
    )
    readonly_fields = fields
    inlines = (PaymentInline,)

    def get_queryset(self, request):
        # Payments summed in the list's own query.
        return super().get_queryset(request).with_amounts()

    @admin.display(description="Total due (₹)")
    def total_due(self, obj):
        return entry_amounts(obj).total_due

    @admin.display(description="Total paid (₹)")
    def total_paid(self, obj):
        return entry_amounts(obj).total_paid

    @admin.display(description="Outstanding (₹)")
    def outstanding(self, obj):
        return entry_amounts(obj).outstanding_amount


@admin.register(Payment)
class PaymentAdmin(ViewOnlyAdminMixin, admin.ModelAdmin):
    list_display = ("entry", "paid_date", "amount", "created_by", "created_at")
    list_filter = ("entry__tenancy__property",)
    list_select_related = ("entry__tenancy", "created_by")
    search_fields = ("entry__tenancy__name", "entry__tenancy__flat_number", "notes")
    date_hierarchy = "paid_date"
    fields = ("id", "entry", "amount", "paid_date", "notes", "created_by", "created_at")
    readonly_fields = fields
