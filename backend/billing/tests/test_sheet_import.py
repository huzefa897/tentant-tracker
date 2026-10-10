import io
import zipfile
from datetime import date, datetime
from unittest.mock import patch

from django.contrib.admin.models import LogEntry
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse

from billing.models import LegacyRecord, Payment, Receipt, RentEntry

from .factories import make_property, make_tenancy, make_user
from .test_sheet_ledger import row, workbook_with


def xlsx(*tabs) -> SimpleUploadedFile:
    buffer = io.BytesIO()
    workbook_with(*tabs).save(buffer)
    return SimpleUploadedFile("TenantTracker.xlsx", buffer.getvalue())


def tenant_a():
    # Fictional data, in months already past.
    return (
        "Tenant A",
        [
            row(datetime(2026, 8, 1), 75, 15750, datetime(2026, 8, 16), water=300),
            row(datetime(2026, 9, 1), 80, 5000, datetime(2026, 9, 20)),
        ],
        {},
    )


class SheetImportAdminTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_superuser(username="admin", password="pass")
        self.client.force_login(self.admin)
        self.property = make_property(name="Saleem Towers")
        self.tenancy = make_tenancy(self.property, start_date=date(2026, 1, 1))
        self.url = reverse("admin:properties_property_import_sheet", args=[self.property.pk])

    def upload(self, file=None):
        return self.client.post(self.url, {"step": "upload", "workbook": file or xlsx(tenant_a())})

    def check(self, choice=None):
        token = self.upload().context["token"]
        choice = str(self.tenancy.pk) if choice is None else choice
        return self.client.post(self.url, {"step": "check", "token": token, "tab_0": choice})

    def test_the_property_page_links_to_it_for_superusers_only(self):
        change = reverse("admin:properties_property_change", args=[self.property.pk])
        self.assertContains(self.client.get(change), self.url)

        staff = make_user(username="staff", is_staff=True)
        self.client.force_login(staff)
        self.assertNotContains(self.client.get(change), self.url, status_code=403)
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_refuses_a_file_that_isnt_an_xlsx(self):
        response = self.upload(SimpleUploadedFile("TenantTracker.xlsx", b"Month,Rent\n"))

        self.assertContains(response, "isn&#x27;t an .xlsx file")
        self.assertNotIn("mapping_form", response.context)

    def test_refuses_a_file_that_unpacks_to_too_much(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("xl/workbook.xml", b"0" * 5000)

        with patch("billing.sheet_import.MAX_UNPACKED_BYTES", 1000):
            response = self.upload(SimpleUploadedFile("TenantTracker.xlsx", buffer.getvalue()))

        self.assertContains(response, "unpacks to far more than a spreadsheet")

    def test_shows_the_sheets_problems_and_offers_no_matching(self):
        soon = row(datetime(2026, 9, 1), 75, 1000, "soon")

        response = self.upload(xlsx(("Tenant A", [soon], {})))

        self.assertContains(response, "Paid Date &#x27;soon&#x27; isn&#x27;t a date")
        self.assertNotIn("mapping_form", response.context)

    def test_offers_only_this_propertys_tenancies(self):
        other = make_tenancy(make_property(name="Property B"), name="Someone Else")

        response = self.upload()

        choices = dict(response.context["mapping_form"].fields["tab_0"].choices)
        self.assertIn(str(self.tenancy.pk), choices)
        self.assertNotIn(str(other.pk), choices)
        tampered = self.client.post(
            self.url, {"step": "check", "token": response.context["token"], "tab_0": str(other.pk)}
        )
        self.assertTrue(tampered.context["mapping_form"].errors)

    def test_a_check_saves_nothing_then_import_saves_what_was_checked(self):
        checked = self.check()

        self.assertTrue(checked.context["checked_ok"])
        self.assertFalse(RentEntry.objects.exists())

        response = self.client.post(
            self.url,
            # A tab choice sent now is ignored: only the signed, checked mapping is imported.
            {"step": "import", "token": checked.context["import_token"], "tab_0": "skip"},
        )

        self.assertRedirects(
            response, reverse("admin:properties_property_change", args=[self.property.pk])
        )
        self.assertEqual(RentEntry.objects.filter(tenancy=self.tenancy).count(), 2)
        self.assertEqual(Payment.objects.count(), 2)
        receipt = Receipt.objects.get(reference="RCP-202-202608")
        self.assertEqual(receipt.property, self.property)
        self.assertEqual(LegacyRecord.objects.filter(imported_by=self.admin).count(), 6)
        log = LogEntry.objects.get(object_id=str(self.property.pk))
        self.assertIn("2 bill(s), 2 payment(s), 2 receipt(s)", log.get_change_message())

    def test_refuses_a_tenancy_moved_to_another_property_since_the_check(self):
        checked = self.check()
        # A tenancy without bills can still move: say an admin corrects its property now.
        self.tenancy.property = make_property(name="Property B")
        self.tenancy.save()

        response = self.client.post(
            self.url, {"step": "import", "token": checked.context["import_token"]}
        )

        self.assertContains(response, "isn&#x27;t one of this property&#x27;s tenancies any more")
        self.assertFalse(RentEntry.objects.exists())
        self.assertFalse(Receipt.objects.exists())
        self.assertFalse(LogEntry.objects.filter(object_id=str(self.property.pk)).exists())

    def test_importing_again_creates_nothing_twice(self):
        self.client.post(
            self.url, {"step": "import", "token": self.check().context["import_token"]}
        )

        again = self.check()

        self.assertEqual(again.context["report"].already["bill"], 2)
        self.assertEqual(again.context["report"].created["bill"], 0)
        self.assertEqual(RentEntry.objects.count(), 2)

    def test_shows_rejections_and_offers_no_import(self):
        self.tenancy.start_date = date(2026, 9, 1)
        self.tenancy.save()

        response = self.check()

        self.assertContains(response, "outside the tenancy")
        self.assertFalse(response.context["checked_ok"])
        self.assertNotContains(response, 'value="import"')

    def test_needs_at_least_one_tab_to_import(self):
        response = self.check(choice="skip")

        self.assertContains(response, "Choose a tenancy for at least one tab.")

    def test_refuses_an_altered_or_borrowed_token(self):
        token = self.upload().context["token"]
        other = make_property(name="Property B")
        other_url = reverse("admin:properties_property_import_sheet", args=[other.pk])

        for url, sent in ((self.url, token[:-2] + "xx"), (other_url, token)):
            with self.subTest(url=url):
                response = self.client.post(
                    url, {"step": "check", "token": sent, "tab_0": str(self.tenancy.pk)}
                )
                self.assertRedirects(response, url)

        self.assertFalse(RentEntry.objects.exists())

    def test_an_import_without_a_check_does_nothing(self):
        token = self.upload().context["token"]

        response = self.client.post(self.url, {"step": "import", "token": token})

        self.assertRedirects(response, self.url)
        self.assertFalse(RentEntry.objects.exists())
