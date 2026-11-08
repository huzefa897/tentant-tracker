import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, isUncertainFailure, RATE_LIMITED_MESSAGE } from '@/services/apiError'
import { meterReadingService } from '@/services/meterReading.service'
import { useAccessStore } from '@/stores/access'
import type {
  MeterReadingCorrectionInput,
  MeterReadingInput,
  TenantMeter,
} from '@/types/meterReading'
import { hasAtMostDecimals } from '@/utils/money'
import { validateReason } from '@/utils/meterReadingValidation'

export type MeterLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

// One tenant's meter as the backend last returned it. A failed load is an error with Retry,
// never an empty meter.
export interface MeterState {
  status: MeterLoadStatus
  meter: TenantMeter | null
  error: string | null
}

// A bill that must be voided before a reading can change.
export interface BlockingEntry {
  id: string
  billingMonth: string // YYYY-MM
}

// A reading entered as units that must be voided before the reading it was added to can change.
export interface BlockingReading {
  id: string
  reading: string // three decimals
  readOn: string // YYYY-MM-DD
}

// A reading that couldn't be recorded, voided or corrected: nothing changed, unless uncertain
// (no usable response), when it may have; trying again is safe (the same key or reason).
// blockingEntries: every bill to void first, newest first (reading_in_use).
// blockingReadings: every units-entered reading to void first, newest first (reading_feeds_units).
export class MeterReadingError extends Error {
  constructor(
    message: string,
    readonly uncertain = false,
    readonly blockingEntries: BlockingEntry[] = [],
    readonly blockingReadings: BlockingReading[] = [],
  ) {
    super(message)
    this.name = 'MeterReadingError'
  }
}

export const METER_LOAD_ERROR_MESSAGE = "Couldn't load the meter readings. Please try again."
const UNCONFIRMED_MESSAGE =
  "Couldn't confirm whether this was saved. Try again: it won't be recorded twice."

export function meterLoadErrorMessage(error: unknown): string {
  const kind = error instanceof ApiError ? error.kind : 'unknown'
  if (kind === 'network') return "Couldn't reach the server. Check your connection and try again."
  if (kind === 'rate-limited') return RATE_LIMITED_MESSAGE
  if (kind === 'unauthorized')
    return "Your sign-in couldn't be verified. Log out and sign in again."
  return METER_LOAD_ERROR_MESSAGE
}

// An idempotency key and the request it was first sent with.
interface KeptKey {
  key: string
  fingerprint: string
}

function blockingEntriesOf(error: ApiError): BlockingEntry[] {
  const entries = error.details.entries
  if (!Array.isArray(entries)) return []
  return entries.filter(
    (item): item is BlockingEntry =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as BlockingEntry).id === 'string' &&
      typeof (item as BlockingEntry).billingMonth === 'string',
  )
}

function blockingReadingsOf(error: ApiError): BlockingReading[] {
  const readings = error.details.readings
  if (!Array.isArray(readings)) return []
  return readings.filter(
    (item): item is BlockingReading =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as BlockingReading).id === 'string' &&
      typeof (item as BlockingReading).reading === 'string' &&
      typeof (item as BlockingReading).readOn === 'string',
  )
}

function writeError(err: unknown): MeterReadingError {
  if (isUncertainFailure(err)) return new MeterReadingError(UNCONFIRMED_MESSAGE, true)
  if (!(err instanceof ApiError)) return new MeterReadingError("Couldn't save the reading.")
  switch (err.code) {
    case 'duplicate_reading_day':
      return new MeterReadingError(
        'There’s already a reading on that day. Correct that one instead.',
      )
    case 'reading_in_use':
      return new MeterReadingError(
        'Bills are measured from this reading. Void the bills listed, in that order, then try again.',
        false,
        blockingEntriesOf(err),
      )
    case 'reading_feeds_units':
      return new MeterReadingError(
        'Readings entered as units were worked out from this one. Void the readings listed, in that order, then try again.',
        false,
        [],
        blockingReadingsOf(err),
      )
    case 'reading_void':
      return new MeterReadingError('This reading is void already.')
    case 'reading_void_conflict':
      return new MeterReadingError('This reading was already voided, for another reason.')
    case 'idempotency_conflict':
      return new MeterReadingError(
        'An earlier attempt saved a different reading. The readings have been reloaded: check them.',
      )
  }
  if (err.kind === 'invalid-request') {
    return new MeterReadingError(
      Object.values(err.fieldErrors)[0] ?? 'This reading is not valid. Check it and try again.',
    )
  }
  if (err.kind === 'forbidden') {
    return new MeterReadingError("You don't have permission to record meter readings.")
  }
  if (err.kind === 'rate-limited') return new MeterReadingError(RATE_LIMITED_MESSAGE)
  return new MeterReadingError("Couldn't save the reading. Please try again.")
}

// The reading or the units entered (exactly one) and the day.
function validInput(input: { reading?: number; units?: number; readOn: string }): boolean {
  const values = [input.reading, input.units].filter((value) => value !== undefined)
  return (
    values.length === 1 &&
    Number.isFinite(values[0]) &&
    values[0]! >= 0 &&
    hasAtMostDecimals(values[0]!, 3) &&
    /^\d{4}-\d{2}-\d{2}$/.test(input.readOn)
  )
}

// Meter readings of the selected property's tenants, from the backend. A write shows only once
// the backend has returned the meter after it.
export const useMeterReadingStore = defineStore('meterReading', () => {
  const accessStore = useAccessStore()
  const meters = ref<Record<string, MeterState>>({})

  // Responses are discarded once reset() runs (another property, or logout), and a load once a
  // newer load or a write for that tenant starts.
  let generation = 0
  const loadSeq = new Map<string, number>()
  // Idempotency keys kept until a definite answer, so a retry after a lost response is one the
  // backend recognises: the new reading per tenant, a correction per reading. A key belongs to
  // the input it was first sent with: changed input (a dialog that stayed editable, or was
  // closed and reopened) gets a new key, so it isn't refused as a different request.
  const recordKeys = new Map<string, KeptKey>()
  const correctionKeys = new Map<string, KeptKey>()

  function keyFor(keys: Map<string, KeptKey>, id: string, fingerprint: string): string {
    const kept = keys.get(id)
    if (kept && kept.fingerprint === fingerprint) return kept.key
    const key = crypto.randomUUID()
    keys.set(id, { key, fingerprint })
    return key
  }

  function nextSeq(tenantId: string) {
    const seq = (loadSeq.get(tenantId) ?? 0) + 1
    loadSeq.set(tenantId, seq)
    return seq
  }

  function setMeter(tenantId: string, meter: TenantMeter) {
    meters.value = { ...meters.value, [tenantId]: { status: 'ready', meter, error: null } }
  }

  function requireProperty(): string {
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) throw new MeterReadingError('Select a property first.')
    return propertyId
  }

  function meterFor(tenantId: string): MeterState {
    return meters.value[tenantId] ?? { status: 'idle', meter: null, error: null }
  }

  // The tenant's meter. Also Retry. Keeps the meter shown while it reloads.
  async function loadMeter(tenantId: string) {
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) return
    const gen = generation
    const seq = nextSeq(tenantId)
    const current = meterFor(tenantId)
    meters.value = {
      ...meters.value,
      [tenantId]: { status: 'loading', meter: current.meter, error: null },
    }
    try {
      const meter = await meterReadingService.getMeter(propertyId, tenantId)
      if (gen === generation && loadSeq.get(tenantId) === seq) setMeter(tenantId, meter)
    } catch (err) {
      if (gen !== generation || loadSeq.get(tenantId) !== seq) return
      meters.value = {
        ...meters.value,
        [tenantId]: { status: 'error', meter: null, error: meterLoadErrorMessage(err) },
      }
    }
  }

  // Drops a tenant's meter, e.g. after a bill was saved with a reading (it moves the last billed
  // reading): the next page that needs it loads it again.
  function forgetMeter(tenantId: string) {
    nextSeq(tenantId)
    const next = { ...meters.value }
    delete next[tenantId]
    meters.value = next
  }

  async function write(tenantId: string, send: (propertyId: string) => Promise<TenantMeter>) {
    const propertyId = requireProperty()
    const gen = generation
    nextSeq(tenantId) // a load already under way predates this write
    const meter = await send(propertyId)
    if (gen === generation) setMeter(tenantId, meter)
  }

  // An idempotency conflict means the readings on screen aren't what the backend has: load
  // them again, without waiting for a click.
  function reloadAfterConflict(tenantId: string, err: unknown) {
    if (err instanceof ApiError && err.code === 'idempotency_conflict') void loadMeter(tenantId)
  }

  async function recordReading(tenantId: string, input: MeterReadingInput) {
    if (!validInput(input)) throw new MeterReadingError('This reading is not valid.')
    const key = keyFor(
      recordKeys,
      tenantId,
      // Units and the same figure as a reading are different requests.
      JSON.stringify([input.reading ?? null, input.units ?? null, input.readOn, input.notes]),
    )
    try {
      await write(tenantId, async (propertyId) => {
        const result = await meterReadingService.recordReading(propertyId, tenantId, input, key)
        return result.meter
      })
      recordKeys.delete(tenantId)
    } catch (err) {
      const error = err instanceof MeterReadingError ? err : writeError(err)
      if (!error.uncertain) recordKeys.delete(tenantId)
      reloadAfterConflict(tenantId, err)
      throw error
    }
  }

  async function voidReading(tenantId: string, readingId: string, reason: string) {
    const problem = validateReason(reason, 'reading is being voided')
    if (problem) throw new MeterReadingError(problem)
    try {
      await write(tenantId, async (propertyId) => {
        const result = await meterReadingService.voidReading(
          propertyId,
          tenantId,
          readingId,
          reason.trim(),
        )
        return result.meter
      })
    } catch (err) {
      throw err instanceof MeterReadingError ? err : writeError(err)
    }
  }

  async function correctReading(
    tenantId: string,
    readingId: string,
    input: MeterReadingCorrectionInput,
  ) {
    const problem = validateReason(input.reason, 'reading is being corrected')
    if (problem) throw new MeterReadingError(problem)
    if (!validInput(input)) throw new MeterReadingError('This reading is not valid.')
    const key = keyFor(
      correctionKeys,
      readingId,
      JSON.stringify([input.reading, input.readOn, input.notes, input.reason.trim()]),
    )
    try {
      await write(tenantId, async (propertyId) => {
        const result = await meterReadingService.correctReading(
          propertyId,
          tenantId,
          readingId,
          { ...input, reason: input.reason.trim() },
          key,
        )
        return result.meter
      })
      correctionKeys.delete(readingId)
    } catch (err) {
      const error = err instanceof MeterReadingError ? err : writeError(err)
      if (!error.uncertain) correctionKeys.delete(readingId)
      reloadAfterConflict(tenantId, err)
      throw error
    }
  }

  function reset() {
    generation++
    loadSeq.clear()
    recordKeys.clear()
    correctionKeys.clear()
    meters.value = {}
  }

  watch(
    () => accessStore.selectedPropertyId,
    (next, previous) => {
      if (next !== previous) reset()
    },
    { flush: 'sync' },
  )

  return {
    meters,
    meterFor,
    loadMeter,
    forgetMeter,
    recordReading,
    voidReading,
    correctReading,
    reset,
  }
})
