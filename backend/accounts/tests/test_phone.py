from django.core.exceptions import ValidationError
from django.test import SimpleTestCase

from accounts.phone import (
    format_phone_number,
    is_valid_phone_number,
    normalize_phone_number,
    validate_phone_number,
)


class PhoneNumberTests(SimpleTestCase):
    def test_normalizes_what_people_type(self):
        self.assertEqual(normalize_phone_number(" +91 89778-67546 "), "+918977867546")
        self.assertEqual(normalize_phone_number("+1 (650) 555.1234"), "+16505551234")
        self.assertEqual(normalize_phone_number(""), "")

    def test_accepts_the_countries_login_accepts(self):
        for number in ["+918341413827", "+61412345678", "+16505551234"]:
            with self.subTest(number):
                self.assertTrue(is_valid_phone_number(number))

    def test_rejects_other_numbers(self):
        for number in [
            "8341413827",  # no country code
            "+915341413827",  # Indian mobiles start 6-9
            "+9183414138270",  # too long
            "+61212345678",  # Australian landline
            "+16501551234",  # US exchange can't start with 1
            "+447911123456",  # unsupported country
        ]:
            with self.subTest(number):
                self.assertFalse(is_valid_phone_number(number))

    def test_validator_allows_blank_and_rejects_invalid(self):
        validate_phone_number("")
        with self.assertRaises(ValidationError):
            validate_phone_number("+447911123456")

    def test_formats_for_display(self):
        self.assertEqual(format_phone_number("+918977867546"), "+91 89778 67546")
        self.assertEqual(format_phone_number("+61412345678"), "+61 412 345 678")
        self.assertEqual(format_phone_number("+16505551234"), "+1 650 555 1234")
        self.assertEqual(format_phone_number("+447911123456"), "+447911123456")
