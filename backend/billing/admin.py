from django.contrib import admin

from .calculations import entry_amounts
from .models import RentEntry


@admin.register(RentEntry)
class RentEntryAdmin(admin.ModelAdmin):
    """View only. Bills are created through the app's API, which copies the tenancy's charges
    and checks occupancy; corrections need deliberate rules before anyone can edit them."""

    list_display = ("tenancy", "billing_month", "rent_amount", "total_due", "created_by")
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
        "notes",
        "created_by",
        "created_at",
    )
    readonly_fields = fields

    @admin.display(description="Total due (₹)")
    def total_due(self, obj):
        return entry_amounts(obj).total_due

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
