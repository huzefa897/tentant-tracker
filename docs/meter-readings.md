# Electricity meter readings

A tenancy's electricity can be measured from its meter instead of typed in as units. Readings, bills and payments are kept apart: recording a reading never creates, changes or settles a bill, a bill can leave electricity off, and rent can be paid without a reading.

## Baseline (admin)

`Tenancy.meter_baseline_reading` and `meter_baseline_date`, set in admin (Tenancies → **Electricity meter**): the move-in reading, or for an existing tenancy the latest known one. Both or neither (check constraint `tenancy_meter_baseline_complete`); the date is within the occupancy. **Empty means the meter isn't set up**, never zero: the tenancy's bills take typed units, as before. Nothing earlier is reinterpreted: every bill and receipt from before is `manual`.

The baseline is fixed once the tenancy has an active reading (`Tenancy.clean()`, and `save()` under the row lock that recording a reading takes, `TenancyHasReadingsError`; admin shows it read-only). Void the readings in the app to change it. The tenancy API returns it as `meterBaseline: {reading, readOn}` or `null`.

## Readings

`billing.MeterReading`: tenancy, reading (≥ 0, three decimals), `read_on` (the day it was taken: the bill form defaults it to the initial payment's date, else today), notes, creator, an idempotency key and fingerprint, and the bill-style lifecycle (`status` active | void, `voided_*`, `replaces_reading`). One active reading per tenancy and day. Never edited or deleted; view-only in admin.

`billing/meter.py` `record_meter_reading` (owners and managers, `Capability.RECORD_READINGS`) locks the tenancy `FOR UPDATE` (bill creation's lock), then checks: the meter is set up; the date is within the tenancy, after the baseline's date and not after `business_date()`; the value isn't below the baseline, below the active reading before it or above the one after it (so a backdated reading must fit between its neighbours). Readings never go down: **a meter replaced or reset isn't supported yet**. A missed month needs nothing: the next reading covers it, and no reading is ever invented.

**Consumption** (units since the active reading before, or the baseline) is derived for the list, never stored.

## Bills

`RentEntry.electricity_mode`:

| Mode          | When                                                           | Units                                        |
| ------------- | -------------------------------------------------------------- | -------------------------------------------- |
| `manual`      | No baseline, electricity included (and every bill from before) | Typed in                                     |
| `meter`       | Baseline, electricity included                                 | Closing reading − last billed reading        |
| `not_charged` | Electricity left off (`includeElectricity: false`)             | 0; the readings wait for the next meter bill |

A meter bill saves `closing_reading`, `opening_reading` (null when it starts from the baseline) and `meter_opening`/`meter_opening_date` (the opening's figures when it was created, so a later baseline change never changes it), and stores its units in `electricity_units` like any bill: totals, balances, the dashboard and receipts are worked out as before.

- **Last billed reading**: the closing reading of the tenancy's latest active meter bill, else the baseline. A meter bill always starts there. A `not_charged` bill doesn't move it, so October billed at 2563, November read at 2876 but not charged, December billed at 2985 charges **422** units.
- **Each stretch is billed once.** Conditional unique constraints on active bills (`unique_active_entry_closing_reading`, `unique_active_entry_opening_reading`, `unique_active_meter_entry_from_baseline`) and the tenancy's lock keep the active meter bills one chain from the baseline. The closing reading must be after the last billed one (`reading_already_billed`).
- Creating a bill (`create_rent_entry` → `meter.electricity_for_new_bill`): `closingReading {reading, readOn, notes?}` records a new reading in the same transaction (rolled back with the bill, `closing_reading_required` without one), or `closingReadingId` picks an unbilled one. A baseline tenancy's typed units are refused; a tenancy without one refuses readings. With electricity left off, a reading sent is recorded as a reading only.
- **Voiding** a meter bill frees its stretch for the next meter bill. While a later active meter bill starts from its closing reading it's refused (409 `later_meter_bill`, with that bill): void newest first. It takes the tenancy's lock (`NO KEY`, after the bill's).
- **Correcting** a bill keeps its mode and readings (rent, water and notes change). A meter or not-charged bill's units can't change there (400 on `electricityUnits`): void it and create a new bill.
- Bills in the API carry `electricityMode`, `openingReading` and `closingReading` (`{id, reading, readOn}`, the opening's id null for the baseline, or null).

## Corrections

`void_meter_reading` and `correct_meter_reading` (owners and managers; reason, and for a correction an Idempotency-Key) lock the tenancy, then the reading. **A reading an active bill opens or closes on is refused** (409 `reading_in_use`, listing those bills): reverse their payments, void them newest first, correct the reading, then bill again. No saved amount ever changes underneath a bill. A replacement passes the same order checks against the other readings.

## Receipts

`Receipt.electricity_mode`, `opening_reading`, `opening_read_on`, `closing_reading`, `closing_read_on`, copied from the bill when issued (old receipts are `manual` with none). In the API under `charges`: `electricityMode`, `openingReading`, `closingReading` (`{reading, readOn}` or null).

## API

Under `/api/v1/properties/{id}/tenancies/{id}/meter-readings/`, scoped through `properties_for_user` then the tenancy:

- `GET` → `{baseline, lastBilled, readings}`: readings newest first (void ones too), each `{id, reading, readOn, notes, status, consumption, billedBy: {id, billingMonth} | null, createdAt, voidedAt, voidedByName, voidReason, replacesReadingId, replacedByReadingId}`. Unpaginated.
- `POST` `{reading, readOn, notes?}` with an Idempotency-Key: 201 `{reading: id, meter}`, 200 for a retry; 400 with the field that doesn't fit, or `meter_not_set_up`; 409 `duplicate_reading_day`, `idempotency_conflict`.
- `POST .../{readingId}/void/` `{reason}` and `POST .../{readingId}/correction/` `{reason, reading, readOn, notes?}` (Idempotency-Key): 409 `reading_in_use` (`entries`), `reading_void`, `reading_void_conflict`.

Migration `billing.0013` added these; undoing it stops while any reading, meter or not-charged bill or such receipt exists.
