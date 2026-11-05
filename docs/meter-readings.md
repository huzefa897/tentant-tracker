# Electricity meter readings

A tenancy's electricity can be measured from its meter instead of typed in as units. Readings, bills and payments are kept apart: recording a reading never creates, changes or settles a bill, a bill can leave electricity off, and rent can be paid without a reading.

## Baseline (admin)

Admin (Tenancies → **Electricity meter**, `TenancyAdminForm`): **Enable meter reading tracking**, the **Initial meter reading** (`Tenancy.meter_baseline_reading`: the move-in reading, or the meter's reading now for an existing tenancy) and **Baseline recorded at** (`meter_baseline_recorded_at`, read-only). Ticked needs the reading; unticked clears it. The time is never typed in: `Tenancy.save()` sets it to now whenever the reading is entered or changed, and clears it with the reading (a time the caller sets, as tests do, is kept). Both or neither (check constraint `tenancy_meter_baseline_complete`). **Empty means tracking is off**, never zero: the tenancy's bills take typed units, as before. Nothing earlier is reinterpreted: every bill and receipt from before is `manual`.

The day it was recorded (`Tenancy.meter_baseline_date()`, at the property) is where the meter starts: readings are dated from that day on, and a meter bill from the baseline opens on it. It isn't printed on receipts.

Once the tenancy has an active reading, tracking stays on and the initial reading is fixed (`Tenancy.clean()`, and `save()` under the row lock that recording a reading takes, `TenancyHasReadingsError`; admin shows both read-only). Turning tracking off and on again would leave readings and unbilled units with nothing to measure from, so it isn't offered: void the readings in the app first. The tenancy API returns the baseline as `meterBaseline: {reading, readOn}` (`readOn`: the day it was recorded) or `null`.

## Readings

`billing.MeterReading`: tenancy, reading (≥ 0, three decimals), `read_on` (the day it was taken: the bill form defaults it to the initial payment's date, else today), notes, creator, an idempotency key and fingerprint, and the bill-style lifecycle (`status` active | void, `voided_*`, `replaces_reading`). One active reading per tenancy and day. Never edited or deleted; view-only in admin.

`billing/meter.py` `record_meter_reading` (owners and managers, `Capability.RECORD_READINGS`) locks the tenancy `FOR UPDATE` (bill creation's lock), then checks: the meter is set up; the date is within the tenancy, not before the day the baseline was recorded and not after `business_date()`; the value isn't below the baseline, below the active reading before it or above the one after it (so a backdated reading must fit between its neighbours). Readings never go down: **a meter replaced or reset isn't supported yet**. A missed month needs nothing: the next reading covers it, and no reading is ever invented.

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
- **Each stretch is billed once.** Conditional unique constraints on active bills (`unique_active_entry_closing_reading`, `unique_active_entry_opening_reading`, `unique_active_meter_entry_from_baseline`) and the tenancy's lock keep the active meter bills one chain from the baseline. The closing reading must be after the last billed one (400 on `closingReading`).
- Creating a bill (`create_rent_entry` → `meter.electricity_for_new_bill`): `closingReading {reading, readOn, notes?}` records a new reading in the same transaction (rolled back with the bill; 400 on `closingReading` without one), or `closingReadingId` picks an unbilled one. A baseline tenancy's typed units are refused; a tenancy without one refuses readings. With electricity left off, a reading sent is recorded as a reading only.
- **Voiding** a meter bill frees its stretch for the next meter bill. While a later active meter bill starts from its closing reading it's refused (409 `later_meter_bill`, with that bill): void newest first. It takes the tenancy's lock (`NO KEY`, after the bill's).
- **Correcting** a bill keeps its mode and readings (rent, water and notes change). A meter or not-charged bill's units can't change there (400 on `electricityUnits`): void it and create a new bill.
- Bills in the API carry `electricityMode`, `openingReading` and `closingReading` (`{id, reading, readOn}`, the opening's id null for the baseline, or null).

## Corrections

`void_meter_reading` and `correct_meter_reading` (owners and managers; reason, and for a correction an Idempotency-Key) lock the tenancy, then the reading. **A reading an active bill opens or closes on is refused** (409 `reading_in_use`, listing those bills): reverse their payments, void them newest first, correct the reading, then bill again. No saved amount ever changes underneath a bill. A replacement passes the same order checks against the other readings.

## Receipts

`Receipt.electricity_mode`, `opening_reading`, `opening_read_on`, `closing_reading`, `closing_read_on`, copied from the bill when issued (old receipts are `manual` with none). A bill that opens on the baseline has no `opening_read_on`: the day tracking was switched on isn't printed. In the API under `charges`: `electricityMode`, `openingReading`, `closingReading` (`{reading, readOn}` or null; the opening's `readOn` is null when it's the baseline).

## App

- **Types and service:** `types/meterReading.ts`; `services/meterReading.service.ts` validates every response strictly (readings are three-decimal strings, a meter bill has both readings and no other bill has any) and returns `MeterWrite {readingId, meter, replayed}` for writes. Bills and receipts parse their `electricityMode` and readings through its `parseElectricity`.
- **Store:** `stores/meterReading.ts` keeps each tenant's meter as the backend last returned it (`meterFor`, `loadMeter`, `forgetMeter`); a failed load is an error with Retry, never an empty meter. Writes show only the meter the backend returns; the record key (per tenant) and correction key (per reading) are kept after an uncertain failure, so a retry is recognised. `MeterReadingError.blockingEntries` lists the bills a `reading_in_use` names. It resets on a property change.
- **Bill form** (`RentEntryForm`, wired in `NewRentEntryView`): an "Include electricity charges" switch. With a baseline it loads the meter and shows the opening (last billed) reading, a closing reading and its date (the initial payment's date, else today, until edited), the units and the charge; without one, typed units as before. Off: "Not charged". The confirmation shows the backend's figures (`utils/electricity.ts`: "Electricity (2,563 → 2,985: 422 units × ₹8)", or "Not charged", never ₹0). After a bill with a reading, the meter is forgotten so the next page loads it afresh.
- **Bills:** the latest bill card, the bill details (opening and closing readings with their dates) and the receipt (`utils/receiptContent.ts`: Opening Reading ("Starting reading" when it's the baseline, else its date), Closing Reading, Units, Rate, Charge; or one "Electricity · Not charged" row) show the saved mode and readings. `EntryCorrectionForm` keeps a meter or not-charged bill's electricity read-only and sends its units back unchanged.
- **Tenant:** `TenantDetails` shows **Meter** ("From 2,804", or "Not set up") and, once set up, a **Meter readings** button to `/tenants/:tenantId/meter` (`MeterReadingsView`): the starting and last billed readings, **Record reading**, and `MeterReadingHistory` (consumption, which bill each was billed on, void ones muted with why) with **Correct** and **Void** dialogs (`MeterReadingForm`, `VoidReadingForm`). When the backend refuses because bills are measured from the reading, the dialog stays open and links those bills.

## API

Under `/api/v1/properties/{id}/tenancies/{id}/meter-readings/`, scoped through `properties_for_user` then the tenancy:

- `GET` → `{baseline, lastBilled, readings}`: readings newest first (void ones too), each `{id, reading, readOn, notes, status, consumption, billedBy: {id, billingMonth} | null, createdAt, voidedAt, voidedByName, voidReason, replacesReadingId, replacedByReadingId}`. Unpaginated.
- `POST` `{reading, readOn, notes?}` with an Idempotency-Key: 201 `{reading: id, meter}`, 200 for a retry; 400 with the field that doesn't fit (`reading` when the meter isn't set up); 409 `duplicate_reading_day`, `idempotency_conflict`.
- `POST .../{readingId}/void/` `{reason}` and `POST .../{readingId}/correction/` `{reason, reading, readOn, notes?}` (Idempotency-Key): 409 `reading_in_use` (`entries`), `reading_void`, `reading_void_conflict`.

Migrations `billing.0013` (readings) and `billing.0014` (the bills' and receipts' electricity mode and readings) added these. Undoing `0013` stops while any reading exists; undoing `0014`, while any meter or not-charged bill or such receipt exists.
