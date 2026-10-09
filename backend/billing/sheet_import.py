"""Importing the owners' Google Sheet from a property's admin page (docs/data-import.md).

The same converter and all-or-nothing import as the sheet_to_ledger and import_legacy_ledger
commands, in three steps on one page: upload the .xlsx, match each tab to one of the property's
tenancies and check it (a dry run), then import exactly what was checked.

The file is read in memory and never stored. Between steps the converted ledger travels in the
form, signed for this property and admin, so it can't be altered, and it expires after an hour.
"""

import io
import uuid
import zipfile

import openpyxl
from django import forms
from django.contrib import messages
from django.core import signing
from django.core.exceptions import PermissionDenied, ValidationError
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.urls import reverse
from openpyxl.utils.exceptions import InvalidFileException

from properties.models import business_date

from .legacy_import import import_ledger
from .legacy_ledger import LedgerError, parse_ledger
from .sheet_ledger import Conversion, convert_workbook

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
# An .xlsx is a zip, whose contents can be far larger than the file: refuse anything that would
# unpack to much more than a spreadsheet does.
MAX_UNPACKED_BYTES = 50 * 1024 * 1024
MAX_ZIP_ENTRIES = 2000
SIGNING_SALT = "billing.sheet-import"
LEDGER_MAX_AGE = 60 * 60
SKIP = "skip"


class UploadForm(forms.Form):
    workbook = forms.FileField(
        label="The Sheet (.xlsx)",
        help_text="In Google Sheets: File > Download > Microsoft Excel (.xlsx).",
    )

    def clean_workbook(self):
        upload = self.cleaned_data["workbook"]
        if upload.size > MAX_UPLOAD_BYTES:
            raise ValidationError("The file is over 5 MB, far larger than the Sheet.")
        data = upload.read()
        # Checked by content, never by its name or type.
        if not data.startswith(b"PK\x03\x04"):
            raise ValidationError(
                "This isn't an .xlsx file. Download the Sheet as Microsoft Excel (.xlsx)."
            )
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                entries = archive.infolist()
        except zipfile.BadZipFile:
            raise ValidationError("This .xlsx file is damaged. Download it again.") from None
        # Reading an entry never yields more than its declared size, so these bound it.
        unpacked = sum(entry.file_size for entry in entries)
        if len(entries) > MAX_ZIP_ENTRIES or unpacked > MAX_UNPACKED_BYTES:
            raise ValidationError("This file unpacks to far more than a spreadsheet would.")
        try:
            # data_only: the values formulas showed when the file was saved. openpyxl parses its
            # XML through defusedxml (installed alongside it).
            return openpyxl.load_workbook(io.BytesIO(data), data_only=True)
        except (InvalidFileException, zipfile.BadZipFile, KeyError, ValueError, TypeError,
                OSError):
            raise ValidationError(
                "This file couldn't be read as a spreadsheet. Download the Sheet again."
            ) from None


def _tenancy_label(tenancy) -> str:
    dates = f"from {tenancy.start_date:%d %b %Y}"
    if tenancy.end_date:
        dates += f" to {tenancy.end_date:%d %b %Y}"
    return f"{tenancy.name}, flat {tenancy.flat_number} ({dates})"


def _tab_summary(tenant: dict) -> str:
    months = [bill["billingMonth"] for bill in tenant["bills"]]
    name = tenant["name"] or "no name"
    if not months:
        return f"{name}: no months to import"
    return f"{name}: {len(months)} month(s), {min(months)} to {max(months)}"


class MappingForm(forms.Form):
    """Each tab's tenancy, chosen from this property's: never matched by name."""

    def __init__(self, *args, tenants, tenancies, **kwargs):
        super().__init__(*args, **kwargs)
        choices = [
            ("", "Choose its tenancy…"),
            *((str(tenancy.pk), _tenancy_label(tenancy)) for tenancy in tenancies),
            (SKIP, "Don't import this tab"),
        ]
        self.tabs = [tenant["sourceId"] for tenant in tenants]
        for index, tenant in enumerate(tenants):
            self.fields[f"tab_{index}"] = forms.ChoiceField(
                label=tenant["sourceId"], choices=choices, help_text=_tab_summary(tenant)
            )

    def clean(self):
        cleaned = super().clean()
        if self.is_bound and not self.errors and not self.mapping():
            raise ValidationError("Choose a tenancy for at least one tab.")
        return cleaned

    def mapping(self) -> dict[str, uuid.UUID]:
        return {
            tab: uuid.UUID(self.cleaned_data[f"tab_{index}"])
            for index, tab in enumerate(self.tabs)
            if self.cleaned_data.get(f"tab_{index}") not in (None, "", SKIP)
        }


def _sign(prop, request, payload: dict) -> str:
    return signing.dumps(
        {**payload, "property": str(prop.pk), "user": request.user.pk},
        salt=SIGNING_SALT,
        compress=True,
    )


def _unsign(prop, request, token: str) -> dict | None:
    try:
        payload = signing.loads(token, salt=SIGNING_SALT, max_age=LEDGER_MAX_AGE)
    except signing.BadSignature:  # Altered, or expired (SignatureExpired is a BadSignature).
        return None
    if payload.get("property") != str(prop.pk) or payload.get("user") != request.user.pk:
        return None
    return payload


def _summary(report) -> str:
    kinds = ("bill", "payment", "receipt")
    counts = ", ".join(f"{report.created[kind]} {kind}(s)" for kind in kinds)
    return f"Imported from the Google Sheet: {counts}."


def sheet_import_view(model_admin, request, prop):
    """The import page for one property (PropertyAdmin's import-sheet URL)."""
    # It creates bills, payments and receipts, which admin otherwise never does.
    if not request.user.is_superuser:
        raise PermissionDenied
    tenancies = list(prop.tenancies.order_by("flat_number", "start_date"))
    here = request.path
    context = {
        **model_admin.admin_site.each_context(request),
        "opts": model_admin.model._meta,
        "original": prop,
        "title": "Import from the Google Sheet",
        "max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
        "has_tenancies": bool(tenancies),
    }

    def render(**extra):
        return TemplateResponse(request, "admin/billing/sheet_import.html", {**context, **extra})

    step = request.POST.get("step") if request.method == "POST" else None
    if step is None:
        return render(upload_form=UploadForm())

    if step == "upload":
        form = UploadForm(request.POST, request.FILES)
        if not form.is_valid():
            return render(upload_form=form)
        conversion = convert_workbook(form.cleaned_data["workbook"], today=business_date())
        if conversion.problems or not conversion.ledger["tenants"]:
            return render(upload_form=UploadForm(), conversion=conversion)
        payload = {"ledger": conversion.ledger, "warnings": conversion.warnings}
        return render(
            conversion=conversion,
            mapping_form=MappingForm(tenants=conversion.ledger["tenants"], tenancies=tenancies),
            token=_sign(prop, request, payload),
        )

    payload = _unsign(prop, request, request.POST.get("token", ""))
    if payload is None:
        messages.error(request, "That upload has expired or was altered. Upload the Sheet again.")
        return redirect(here)
    conversion = Conversion(ledger=payload["ledger"], warnings=payload["warnings"])
    tenants = payload["ledger"]["tenants"]

    if step == "import":
        # Exactly what was checked: the mapping comes from the signed check, not the form.
        checked = payload.get("checked")
        if checked is None:
            return redirect(here)
        mapping = {tab: uuid.UUID(tenancy_id) for tab, tenancy_id in checked.items()}
        form = None
    else:
        form = MappingForm(request.POST, tenants=tenants, tenancies=tenancies)
        if not form.is_valid():
            return render(conversion=conversion, mapping_form=form, token=request.POST["token"])
        mapping = form.mapping()

    chosen = [tenant for tenant in tenants if tenant["sourceId"] in mapping]
    ledger_data = {**payload["ledger"], "tenants": chosen}
    try:
        ledger = parse_ledger(ledger_data, today=business_date())
    except LedgerError as error:
        return render(conversion=conversion, upload_form=UploadForm(), problems=error.problems)

    report = import_ledger(ledger, mapping, imported_by=request.user, dry_run=step != "import")
    if report.saved:
        model_admin.log_change(request, prop, _summary(report))
        messages.success(request, _summary(report))
        return redirect(reverse("admin:properties_property_change", args=[prop.pk]))

    checked_ok = step == "check" and not report.rejected and report.reconciled
    names = {str(tenancy.pk): _tenancy_label(tenancy) for tenancy in tenancies}
    return render(
        conversion=conversion,
        mapping_form=form or MappingForm(tenants=tenants, tenancies=tenancies),
        token=request.POST["token"],
        report=report,
        checked_ok=checked_ok,
        checked_mapping=[(tab, names.get(str(tenancy), "")) for tab, tenancy in mapping.items()],
        import_token=_sign(
            prop, request, {**payload, "checked": {t: str(i) for t, i in mapping.items()}}
        )
        if checked_ok
        else None,
    )
