"""A tenancy's electricity meter readings: list and record, void and correct
(billing/meter.py). Reached through the property and tenancy (ScopedLookupMixin), so another
property's readings 404."""

from rest_framework import exceptions, status, viewsets
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response

from properties.roles import Capability, role_can

from .meter import (
    DuplicateReadingDayError,
    InvalidReadingError,
    MeterNotSetUpError,
    NothingToCorrectReadingError,
    ReadingIdempotencyConflictError,
    ReadingNotAllowedError,
    ReadingNotFoundError,
    ReadingVoidConflictError,
    ReadingVoidError,
    baseline,
    correct_meter_reading,
    meter_readings_with_consumption,
    record_meter_reading,
    void_meter_reading,
)
from .models import MeterReading
from .serializers import (
    MeterReadingCorrectionSerializer,
    MeterReadingCreateSerializer,
    MeterReadingVoidSerializer,
    meter_point,
    meter_reading_data,
)
from .views import IdempotencyConflict, ScopedLookupMixin, idempotency_key

READINGS_FORBIDDEN = "Your role can't record meter readings."


class Conflict(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self, code: str, detail: str, **extra):
        super().__init__({"code": code, "detail": detail, **extra})


def meter_not_set_up() -> exceptions.ValidationError:
    return exceptions.ValidationError(
        {"reading": ["This tenancy's meter isn't set up: an owner sets its baseline in admin."]}
    )


def invalid_reading(error: InvalidReadingError) -> exceptions.ValidationError:
    return exceptions.ValidationError({error.field: [error.detail]})


def duplicate_day() -> Conflict:
    return Conflict("duplicate_reading_day", "This tenancy already has a reading on that day.")


def readings_response(tenancy) -> dict:
    """{baseline, readings}: the meter's start and every reading newest first (void ones too,
    marked), with its consumption."""
    start = baseline(tenancy)
    return {
        "baseline": None if start is None else meter_point(start.reading, start.read_on, False),
        "readings": [
            meter_reading_data(reading, consumption)
            for reading, consumption in meter_readings_with_consumption(tenancy)
        ],
    }


class MeterReadingViewSet(ScopedLookupMixin, viewsets.GenericViewSet):
    """GET: the tenancy's meter (readings_response), unpaginated (a reading a month or so).
    POST {reading, readOn, notes?} with an Idempotency-Key header records one (owners and
    managers): 201 with the meter, 200 for a retry, 400 when it doesn't fit the others (the
    field says why) or the meter isn't set up, 409 duplicate_reading_day."""

    pagination_class = None

    def list(self, request, *args, **kwargs):
        return Response(readings_response(self.get_tenancy()))

    def create(self, request, *args, **kwargs):
        tenancy = self.get_tenancy()
        if not role_can(self.get_property().role, Capability.RECORD_READINGS):
            raise exceptions.PermissionDenied(READINGS_FORBIDDEN)
        serializer = MeterReadingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        key = idempotency_key(request, required=True)
        try:
            result = record_meter_reading(
                tenancy_id=tenancy.pk,
                actor=request.user,
                validated_data=serializer.validated_data,
                idempotency_key=key,
            )
        except ReadingNotFoundError:
            raise exceptions.NotFound() from None
        except ReadingNotAllowedError:
            raise exceptions.PermissionDenied(READINGS_FORBIDDEN) from None
        except MeterNotSetUpError:
            raise meter_not_set_up() from None
        except InvalidReadingError as error:
            raise invalid_reading(error) from None
        except DuplicateReadingDayError:
            raise duplicate_day() from None
        except ReadingIdempotencyConflictError:
            raise IdempotencyConflict() from None

        tenancy.refresh_from_db()
        return Response(
            {"reading": str(result.reading.pk), "meter": readings_response(tenancy)},
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )


class ReadingLookupMixin(ScopedLookupMixin):
    def get_reading(self):
        return get_object_or_404(
            MeterReading.objects.filter(tenancy=self.get_tenancy()), pk=self.kwargs["reading_id"]
        )

    def check_role(self):
        if not role_can(self.get_property().role, Capability.RECORD_READINGS):
            raise exceptions.PermissionDenied(READINGS_FORBIDDEN)


class MeterReadingVoidViewSet(ReadingLookupMixin, viewsets.GenericViewSet):
    """POST {reason}: voids a reading recorded by mistake (201 with the meter; 200 for a retry
    with the same reason). 409 reading_void_conflict."""

    pagination_class = None

    def create(self, request, *args, **kwargs):
        reading = self.get_reading()
        self.check_role()
        serializer = MeterReadingVoidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = void_meter_reading(
                tenancy_id=reading.tenancy_id,
                reading_id=reading.pk,
                actor=request.user,
                reason=serializer.validated_data["reason"],
            )
        except ReadingNotFoundError:
            raise exceptions.NotFound() from None
        except ReadingNotAllowedError:
            raise exceptions.PermissionDenied(READINGS_FORBIDDEN) from None
        except ReadingVoidConflictError:
            raise Conflict(
                "reading_void_conflict", "This reading was already voided with another reason."
            ) from None
        return Response(
            {"reading": str(result.reading.pk), "meter": readings_response(self.get_tenancy())},
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )


class MeterReadingCorrectionViewSet(ReadingLookupMixin, viewsets.GenericViewSet):
    """POST {reason, reading, readOn, notes?} with an Idempotency-Key header: voids the reading
    and records its replacement together (201 with the replacement's id and the meter; 200 for
    a retry). 400 when the replacement doesn't fit the other readings or changes nothing; 409
    reading_void, duplicate_reading_day, idempotency_conflict."""

    pagination_class = None

    def create(self, request, *args, **kwargs):
        reading = self.get_reading()
        self.check_role()
        serializer = MeterReadingCorrectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        key = idempotency_key(request, required=True)
        data = dict(serializer.validated_data)
        reason = data.pop("reason")
        try:
            result = correct_meter_reading(
                tenancy_id=reading.tenancy_id,
                reading_id=reading.pk,
                actor=request.user,
                reason=reason,
                validated_data=data,
                idempotency_key=key,
            )
        except ReadingNotFoundError:
            raise exceptions.NotFound() from None
        except ReadingNotAllowedError:
            raise exceptions.PermissionDenied(READINGS_FORBIDDEN) from None
        except ReadingVoidError:
            raise Conflict("reading_void", "This reading is void: it can't be corrected.") from None
        except NothingToCorrectReadingError:
            raise exceptions.ValidationError(
                {"nonFieldErrors": ["Change the reading, its date or the notes."]}
            ) from None
        except MeterNotSetUpError:
            raise meter_not_set_up() from None
        except InvalidReadingError as error:
            raise invalid_reading(error) from None
        except DuplicateReadingDayError:
            raise duplicate_day() from None
        except ReadingIdempotencyConflictError:
            raise IdempotencyConflict() from None
        return Response(
            {
                "reading": str(result.replacement.pk),
                "meter": readings_response(self.get_tenancy()),
            },
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )
