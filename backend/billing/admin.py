from django.contrib import admin

from .calculations import entry_amounts
from .models import LegacyRecord, Payment, PaymentReversal, Receipt, RentalPeriod, RentEntry


class ViewOnlyAdminMixin:
    """Bills, payments and receipts are created through the app's API, which copies the
    tenancy's charges, checks occupancy and locks the bill so payments never exceed it.
    Changing them here would bypass those rules and the balances built on them. Corrections
    (reversing a payment, which voids its receipt; voiding or correcting a bill) go through the
    app too, so who did it, when and why are recorded with them."""

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


def payment_status(payment) -> str:
    try:
        payment.reversal
    except PaymentReversal.DoesNotExist:
        return "Recorded"
    return "Reversed (not counted)"


class PaymentInline(ViewOnlyAdminMixin, admin.TabularInline):
    model = Payment
    fields = ("paid_date", "amount", "status", "notes", "created_by", "created_at")
    readonly_fields = fields

    @admin.display(description="Status")
    def status(self, obj):
        return payment_status(obj)
    extra = 0
    show_change_link = True


@admin.register(RentalPeriod)
class RentalPeriodAdmin(ViewOnlyAdminMixin, admin.ModelAdmin):
    """Created from the tenancy schedule and with bills (billing/periods.py); marked not owed
    through the app."""

    list_display = ("tenancy", "period_month", "due_date", "payment_timing", "not_owed_at")
    list_filter = ("tenancy__property", "payment_timing")
    list_select_related = ("tenancy",)
    search_fields = ("tenancy__name", "tenancy__flat_number")
    date_hierarchy = "period_month"
    fields = (
        "id",
        "tenancy",
        "period_month",
        "payment_timing",
        "due_day",
        "due_date",
        "created_at",
        "not_owed_at",
        "not_owed_by",
        "not_owed_reason",
    )
    readonly_fields = fields


@admin.register(RentEntry)
class RentEntryAdmin(ViewOnlyAdminMixin, admin.ModelAdmin):
    list_display = (
        "tenancy",
        "billing_month",
        "status",
        "rent_amount",
        "total_due",
        "total_paid",
        "outstanding",
        "created_by",
    )
    list_filter = ("tenancy__property", "status")
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
        "status",
        "voided_at",
        "voided_by",
        "void_reason",
        "replaces_entry",
        "replaced_by",
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

    @admin.display(description="Replaced by")
    def replaced_by(self, obj):
        try:
            return obj.replaced_by
        except RentEntry.DoesNotExist:
            return None


@admin.register(Payment)
class PaymentAdmin(ViewOnlyAdminMixin, admin.ModelAdmin):
    list_display = ("entry", "paid_date", "amount", "status", "created_by", "created_at")
    list_filter = ("entry__tenancy__property",)
    list_select_related = ("entry__tenancy", "created_by", "reversal")
    search_fields = ("entry__tenancy__name", "entry__tenancy__flat_number", "notes")
    date_hierarchy = "paid_date"
    fields = (
        "id",
        "entry",
        "amount",
        "paid_date",
        "notes",
        "status",
        "created_by",
        "created_at",
    )
    readonly_fields = fields

    @admin.display(description="Status")
    def status(self, obj):
        return payment_status(obj)


@admin.register(PaymentReversal)
class PaymentReversalAdmin(ViewOnlyAdminMixin, admin.ModelAdmin):
    """Payments reversed in the app, to inspect. Read-only: every reversal is made by
    billing/services.py reverse_payment, which voids the payment's receipt with it."""

    list_display = ("payment", "reason", "created_by", "created_at")
    list_filter = ("payment__entry__tenancy__property",)
    list_select_related = ("payment__entry__tenancy", "created_by")
    search_fields = ("payment__entry__tenancy__name", "payment__entry__tenancy__flat_number")
    date_hierarchy = "created_at"
    fields = ("id", "payment", "reason", "created_by", "created_at")
    readonly_fields = fields


@admin.register(Receipt)
class ReceiptAdmin(ViewOnlyAdminMixin, admin.ModelAdmin):
    """Issued receipts, to inspect. Read-only here (not database-level immutability): every
    receipt is written by billing/services.py issue_payment_receipt, and voided only by
    reverse_payment."""

    list_display = (
        "reference",
        "tenant_name",
        "flat_number",
        "payment_amount",
        "issued_at",
        "voided_at",
    )
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
        "authorized_by_name",
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
        "voided_at",
        "voided_by",
        "void_reason",
    )
    readonly_fields = fields


@admin.register(LegacyRecord)
class LegacyRecordAdmin(ViewOnlyAdminMixin, admin.ModelAdmin):
    """What `manage.py import_legacy_ledger` imported: which source record became which bill,
    payment or receipt. Read-only: reruns rely on it to create nothing twice."""

    list_display = ("source_id", "kind", "object_id", "imported_by", "imported_at")
    list_filter = ("kind",)
    search_fields = ("source_id",)
    fields = ("source_id", "kind", "object_id", "fingerprint", "imported_by", "imported_at")
    readonly_fields = fields
