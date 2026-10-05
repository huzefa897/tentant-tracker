"""Mobile numbers: stored as E.164 (+918341413827), limited to the countries login
accepts, and formatted for display. Mirrors src/utils/phoneCountries.ts: change both
together."""

import re
from dataclasses import dataclass

from django.core.exceptions import ValidationError


@dataclass(frozen=True)
class PhoneCountry:
    name: str
    dial_code: str
    national_number: re.Pattern[str]
    groups: tuple[int, ...]


PHONE_COUNTRIES = (
    PhoneCountry("India", "+91", re.compile(r"[6-9]\d{9}"), (5, 5)),
    PhoneCountry("Australia", "+61", re.compile(r"4\d{8}"), (3, 3, 3)),
    PhoneCountry("United States", "+1", re.compile(r"[2-9]\d{2}[2-9]\d{6}"), (3, 3, 4)),
)

_SEPARATORS = re.compile(r"[\s\-().]")


def normalize_phone_number(value: str) -> str:
    """Drop spaces and punctuation people type: '+91 89778-67546' -> '+918977867546'."""
    return _SEPARATORS.sub("", value or "")


def _split(phone_number: str) -> tuple[PhoneCountry, str] | None:
    for country in PHONE_COUNTRIES:
        if phone_number.startswith(country.dial_code):
            national = phone_number[len(country.dial_code) :]
            if country.national_number.fullmatch(national):
                return country, national
    return None


def is_valid_phone_number(phone_number: str) -> bool:
    return _split(phone_number) is not None


def validate_phone_number(value: str) -> None:
    if value and not is_valid_phone_number(value):
        raise ValidationError(
            "Enter a mobile number with its country code, e.g. +91 83414 13827 "
            "(India, Australia or the United States).",
            code="invalid_phone_number",
        )


def format_phone_number(phone_number: str) -> str:
    """'+918977867546' -> '+91 89778 67546'. Anything unrecognised is returned as is."""
    parts = _split(phone_number)
    if parts is None:
        return phone_number

    country, national = parts
    chunks, start = [], 0
    for size in country.groups:
        chunks.append(national[start : start + size])
        start += size
    return " ".join([country.dial_code, *chunks])
