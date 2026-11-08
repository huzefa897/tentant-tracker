import { api, toApiError } from '@/services/api'
import { ApiError } from '@/services/apiError'
import type {
  ElectricityMode,
  MeterPoint,
  MeterReading,
  MeterReadingCorrectionInput,
  MeterReadingInput,
  ReadingValue,
  ReceiptMeterPoint,
  TenantMeter,
} from '@/types/meterReading'

// A point on the meter as the backend sends it: the reading as a three-decimal string. Bills
// include the reading's id (null for the baseline); receipts and the baseline leave it out.
export interface MeterPointDto {
  id?: string | null
  reading: string // "2563.000"
  readOn: string // YYYY-MM-DD
}

// A receipt's opening reading: readOn is null when it's the baseline.
export interface ReceiptMeterPointDto {
  reading: string
  readOn: string | null
}

export interface MeterReadingDto {
  id: string
  reading: string
  readOn: string
  enteredUnits: string | null
  notes: string
  status: 'active' | 'void'
  consumption: string | null
  billedBy: { id: string; billingMonth: string } | null
  createdAt: string
  voidedAt: string | null
  voidedByName: string | null
  voidReason: string
  replacesReadingId: string | null
  replacedByReadingId: string | null
}

export interface TenantMeterDto {
  baseline: MeterPointDto | null
  lastBilled: MeterPointDto | null
  readings: MeterReadingDto[]
}

const READING = /^\d+\.\d{3}$/
const SIGNED_READING = /^-?\d+\.\d{3}$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const MODES: readonly ElectricityMode[] = ['manual', 'meter', 'not_charged']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(what: string): never {
  throw new ApiError('invalid-response', `Unexpected ${what} in meter reading response`)
}

function optionalId(value: unknown, what: string) {
  if (value !== null && (typeof value !== 'string' || value === '')) invalid(what)
}

// null, or a reading and its date (and, when `withId`, the reading's id or null). With
// `undated`, the date may be null too.
export function parseMeterPoint(
  value: unknown,
  what: string,
  withId: boolean,
  undated = false,
): MeterPointDto | null {
  if (value === null) return null
  if (!isRecord(value)) invalid(what)
  if (typeof value.reading !== 'string' || !READING.test(value.reading)) invalid(`${what}.reading`)
  const dated = typeof value.readOn === 'string' && DATE.test(value.readOn)
  if (!dated && !(undated && value.readOn === null)) invalid(`${what}.readOn`)
  if (withId) optionalId(value.id, `${what}.id`)
  return value as unknown as MeterPointDto
}

export function toMeterPoint(dto: MeterPointDto | null): MeterPoint | null {
  if (dto === null) return null
  return {
    ...(dto.id === undefined ? {} : { id: dto.id }),
    reading: Number(dto.reading),
    readOn: dto.readOn,
  }
}

export function toReceiptMeterPoint(dto: ReceiptMeterPointDto | null): ReceiptMeterPoint | null {
  return dto === null ? null : { reading: Number(dto.reading), readOn: dto.readOn }
}

// A bill's (`withIds`) or receipt's electricity: its mode, and readings exactly when it's a
// meter bill. A receipt's opening reading has no date when it's the baseline.
export function parseElectricity(
  value: Record<string, unknown>,
  withIds: true,
): {
  electricityMode: ElectricityMode
  openingReading: MeterPointDto | null
  closingReading: MeterPointDto | null
}
export function parseElectricity(
  value: Record<string, unknown>,
  withIds: false,
): {
  electricityMode: ElectricityMode
  openingReading: ReceiptMeterPointDto | null
  closingReading: MeterPointDto | null
}
export function parseElectricity(value: Record<string, unknown>, withIds: boolean) {
  if (!MODES.includes(value.electricityMode as ElectricityMode)) invalid('electricityMode')
  const opening = parseMeterPoint(value.openingReading, 'openingReading', withIds, !withIds)
  const closing = parseMeterPoint(value.closingReading, 'closingReading', withIds)
  const isMeter = value.electricityMode === 'meter'
  if (isMeter !== (opening !== null) || isMeter !== (closing !== null)) invalid('closingReading')
  return {
    electricityMode: value.electricityMode as ElectricityMode,
    openingReading: opening,
    closingReading: closing,
  }
}

export function parseMeterReading(value: unknown): MeterReadingDto {
  if (!isRecord(value)) invalid('reading')
  for (const key of ['id', 'createdAt'] as const) {
    if (typeof value[key] !== 'string' || value[key] === '') invalid(key)
  }
  if (typeof value.reading !== 'string' || !READING.test(value.reading)) invalid('reading')
  if (typeof value.readOn !== 'string' || !DATE.test(value.readOn)) invalid('readOn')
  if (
    value.enteredUnits !== null &&
    (typeof value.enteredUnits !== 'string' || !READING.test(value.enteredUnits))
  ) {
    invalid('enteredUnits')
  }
  if (typeof value.notes !== 'string') invalid('notes')
  if (value.status === 'void') {
    for (const key of ['voidedAt', 'voidedByName', 'voidReason'] as const) {
      if (typeof value[key] !== 'string' || value[key] === '') invalid(key)
    }
    if (value.consumption !== null) invalid('consumption')
  } else if (value.status === 'active') {
    if (value.voidedAt !== null || value.voidedByName !== null || value.voidReason !== '') {
      invalid('voidedAt')
    }
    if (
      value.consumption !== null &&
      (typeof value.consumption !== 'string' || !SIGNED_READING.test(value.consumption))
    ) {
      invalid('consumption')
    }
  } else {
    invalid('status')
  }
  if (value.billedBy !== null) {
    const billed = value.billedBy
    if (
      !isRecord(billed) ||
      typeof billed.id !== 'string' ||
      billed.id === '' ||
      typeof billed.billingMonth !== 'string' ||
      !MONTH.test(billed.billingMonth)
    ) {
      invalid('billedBy')
    }
  }
  optionalId(value.replacesReadingId, 'replacesReadingId')
  optionalId(value.replacedByReadingId, 'replacedByReadingId')
  return value as unknown as MeterReadingDto
}

export function toMeterReading(dto: MeterReadingDto): MeterReading {
  return {
    id: dto.id,
    reading: Number(dto.reading),
    readOn: dto.readOn,
    enteredUnits: dto.enteredUnits === null ? null : Number(dto.enteredUnits),
    notes: dto.notes,
    status: dto.status,
    consumption: dto.consumption === null ? null : Number(dto.consumption),
    billedBy: dto.billedBy,
    createdAt: dto.createdAt,
    voided:
      dto.status === 'void'
        ? { at: dto.voidedAt ?? '', byName: dto.voidedByName ?? '', reason: dto.voidReason }
        : null,
    replacesReadingId: dto.replacesReadingId,
    replacedByReadingId: dto.replacedByReadingId,
  }
}

export function parseTenantMeter(data: unknown): TenantMeter {
  if (!isRecord(data) || !Array.isArray(data.readings)) invalid('meter')
  const baseline = parseMeterPoint(data.baseline, 'baseline', false)
  const lastBilled = parseMeterPoint(data.lastBilled, 'lastBilled', true)
  if ((baseline === null) !== (lastBilled === null)) invalid('lastBilled')
  return {
    baseline: toMeterPoint(baseline),
    lastBilled: toMeterPoint(lastBilled),
    readings: data.readings.map((item) => toMeterReading(parseMeterReading(item))),
  }
}

// The reading or the units entered, as the backend takes them. Validation
// (utils/meterReadingValidation.ts) has limited the decimals, so toFixed rounds nothing away.
export function toReadingValueDto(value: ReadingValue): { reading: string } | { units: string } {
  return value.units !== undefined
    ? { units: value.units.toFixed(3) }
    : { reading: value.reading.toFixed(3) }
}

export function toMeterReadingDto(input: MeterReadingInput) {
  return { ...toReadingValueDto(input), readOn: input.readOn, notes: input.notes }
}

// The new or replacement reading's id and the meter as it is now.
function parseWrite(data: unknown): { readingId: string; meter: TenantMeter } {
  if (!isRecord(data) || typeof data.reading !== 'string' || data.reading === '') invalid('reading')
  return { readingId: data.reading, meter: parseTenantMeter(data.meter) }
}

function readingsUrl(propertyId: string, tenancyId: string) {
  return `/properties/${encodeURIComponent(propertyId)}/tenancies/${encodeURIComponent(tenancyId)}/meter-readings/`
}

export interface MeterWrite {
  readingId: string
  meter: TenantMeter
  // True when the backend had already done it (a retry after a lost response).
  replayed: boolean
}

async function post(url: string, body: unknown, idempotencyKey?: string): Promise<MeterWrite> {
  let response
  try {
    response = await api.post(
      url,
      body,
      idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined,
    )
  } catch (error) {
    throw toApiError(error)
  }
  return { ...parseWrite(response.data), replayed: response.status === 200 }
}

export const meterReadingService = {
  // The tenancy's meter: baseline, last billed reading and every reading, newest first.
  async getMeter(propertyId: string, tenancyId: string): Promise<TenantMeter> {
    let data: unknown
    try {
      data = (await api.get(readingsUrl(propertyId, tenancyId))).data
    } catch (error) {
      throw toApiError(error)
    }
    return parseTenantMeter(data)
  },

  // Records a reading. idempotencyKey: one per intended reading, reused by a retry. Errors:
  // 'invalid-request' with fieldErrors (reading/readOn: doesn't fit the others; code
  // 'meter_not_set_up'); 'conflict' with code 'duplicate_reading_day' or 'idempotency_conflict';
  // 'forbidden'.
  recordReading(
    propertyId: string,
    tenancyId: string,
    input: MeterReadingInput,
    idempotencyKey: string,
  ): Promise<MeterWrite> {
    return post(readingsUrl(propertyId, tenancyId), toMeterReadingDto(input), idempotencyKey)
  },

  // Voids a reading recorded by mistake. A retry with the same reason is safe. Errors:
  // 'conflict' with code 'reading_in_use' (details.entries: every bill to void first, newest first) or
  // 'reading_void_conflict'.
  voidReading(
    propertyId: string,
    tenancyId: string,
    readingId: string,
    reason: string,
  ): Promise<MeterWrite> {
    return post(`${readingsUrl(propertyId, tenancyId)}${encodeURIComponent(readingId)}/void/`, {
      reason,
    })
  },

  // Voids a wrong reading and records its replacement together. Errors as recordReading, and
  // 'conflict' with code 'reading_in_use' or 'reading_void'.
  correctReading(
    propertyId: string,
    tenancyId: string,
    readingId: string,
    input: MeterReadingCorrectionInput,
    idempotencyKey: string,
  ): Promise<MeterWrite> {
    return post(
      `${readingsUrl(propertyId, tenancyId)}${encodeURIComponent(readingId)}/correction/`,
      {
        reason: input.reason,
        reading: input.reading.toFixed(3),
        readOn: input.readOn,
        notes: input.notes,
      },
      idempotencyKey,
    )
  },
}
