from django.contrib import admin

from .calculations import entry_amounts
from .models import Payment, Receipt, RentEntry


class ViewOnlyAdminMixin:
    """Bills, payments and receipts are created through the app's API, which copies the
    tenancy's charges, checks occupancy and locks the bill so payments never exceed it.
    Changing them here would bypass those rules and the balances built on them; corrections
    need deliberate rules first."""

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


@admin.register(Receipt)
class ReceiptAdmin(ViewOnlyAdminMixin, admin.ModelAdmin):
    """Issued receipts, to inspect. Read-only here (not database-level immutability): every
    receipt is written by billing/services.py issue_payment_receipt, and corrections or voiding
    need their own workflow."""

    list_display = ("reference", "tenant_name", "flat_number", "payment_amount", "issued_at")
    list_filter = ("payment__entry__tenancy__property",)
    search_fields = ("reference", "tenant_name", "flat_number")
    date_hierarchy = "issued_at"
    fields = (
        "id",
        "reference",
        "payment",
        "issued_by",
        "issued_at",
        "issued_date",
        "issuer_name",
        "issuer_address",
        "issuer_contact_number",
        "received_by_name",
        "tenant_name",
        "flat_number",
        "tenant_mobile_number",
        "deposit_amount",
        "rent_due_day",
        "billing_month",
        "rent_amount",
        "electricity_units",
        "electricity_rate",
        "electricity_amount",
        "water_amount",
        "total_due",
        "total_paid",
        "outstanding_amount",
        "previous_month_outstanding",
        "payment_amount",
        "paid_date",
        "payment_notes",
    )
    readonly_fields = fields
