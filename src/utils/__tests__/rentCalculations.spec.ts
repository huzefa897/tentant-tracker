import { describe, expect, it } from 'vitest'

import type { Payment } from '@/types/payment'
import {
  calculateElectricity,
  calculateOutstanding,
  calculateTotalDue,
  formatPaymentStatus,
  getEntryAmounts,
  getPaymentStatus,
  sortPaymentsNewestFirst,
  sumEntryAmounts,
  sumPayments,
} from '@/utils/rentCalculations'

const charges = { rentAmount: 15000, electricityUnits: 75, electricityRate: 6, waterAmount: 300 }

describe('calculateElectricity', () => {
  it('multiplies units by the rate', () => {
    expect(calculateElectricity(75, 6)).toBe(450)
  })

  it('is zero when nothing was consumed', () => {
    expect(calculateElectricity(0, 6)).toBe(0)
  })

  it('rounds to paise', () => {
    expect(calculateElectricity(75, 6.01)).toBe(450.75)
    expect(calculateElectricity(3, 0.1)).toBe(0.3)
    expect(calculateElectricity(1, 1.005)).toBe(1.01)
  })
})

describe('calculateTotalDue', () => {
  it('adds rent, electricity and water', () => {
    expect(calculateTotalDue(charges)).toBe(15750)
  })

  it('handles no electricity or water', () => {
    expect(calculateTotalDue({ ...charges, electricityUnits: 0, waterAmount: 0 })).toBe(15000)
  })

  it('avoids floating point drift', () => {
    expect(
      calculateTotalDue({
        ...charges,
        electricityUnits: 3,
        electricityRate: 0.1,
        waterAmount: 0.2,
      }),
    ).toBe(15000.5)
  })
})

describe('calculateOutstanding', () => {
  it.each([
    [15750, 0, 15750],
    [15750, 10000, 5750],
    [15750, 15750, 0],
    [0.3, 0.1, 0.2],
  ])('due %s, paid %s -> %s outstanding', (due, paid, expected) => {
    expect(calculateOutstanding(due, paid)).toBe(expected)
  })
})

describe('getPaymentStatus', () => {
  it.each([
    [15750, 0, 'unpaid'],
    [15750, 10000, 'partially_paid'],
    [15750, 0.01, 'partially_paid'],
    [15750, 15750, 'paid'],
    [0.3, 0.1 + 0.2, 'paid'],
  ] as const)('due %s, paid %s -> %s', (due, paid, expected) => {
    expect(getPaymentStatus(due, paid)).toBe(expected)
  })
})

describe('formatPaymentStatus', () => {
  it.each([
    ['unpaid', 'Unpaid'],
    ['partially_paid', 'Partially paid'],
    ['paid', 'Paid'],
  ] as const)('labels %s as %s', (status, label) => {
    expect(formatPaymentStatus(status)).toBe(label)
  })
})

describe('sumPayments', () => {
  it('adds every payment', () => {
    expect(sumPayments([{ amount: 10000 }, { amount: 3000 }, { amount: 2750 }])).toBe(15750)
  })

  it('is zero with no payments', () => {
    expect(sumPayments([])).toBe(0)
  })

  it('adds in paise, without floating point drift', () => {
    expect(sumPayments([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3)
  })
})

describe('sortPaymentsNewestFirst', () => {
  const payment = (id: string, paidDate: string, createdAt: string): Payment => ({
    id,
    entryId: 'entry-1',
    amount: 100,
    paidDate,
    notes: '',
    createdAt,
  })

  it('sorts by paid date, then by when it was recorded, newest first', () => {
    const payments = [
      payment('a', '2026-10-03', '2026-10-03T06:00:00.000Z'),
      payment('b', '2026-10-15', '2026-10-15T06:00:00.000Z'),
      payment('c', '2026-10-10', '2026-10-10T06:00:00.000Z'),
      payment('d', '2026-10-10', '2026-10-11T06:00:00.000Z'),
    ]

    expect(sortPaymentsNewestFirst(payments).map((p) => p.id)).toEqual(['b', 'd', 'c', 'a'])
  })

  it('does not reorder the given array', () => {
    const payments = [
      payment('a', '2026-10-03', '2026-10-03T06:00:00.000Z'),
      payment('b', '2026-10-15', '2026-10-15T06:00:00.000Z'),
    ]

    sortPaymentsNewestFirst(payments)

    expect(payments.map((p) => p.id)).toEqual(['a', 'b'])
  })
})

describe('getEntryAmounts', () => {
  it('derives totals and status from the charges and the amount paid', () => {
    expect(getEntryAmounts(charges, 10000)).toEqual({
      totalDue: 15750,
      totalPaid: 10000,
      outstanding: 5750,
      status: 'partially_paid',
    })
  })

  it('marks a fully paid bill as paid with nothing outstanding', () => {
    expect(getEntryAmounts(charges, 15750)).toMatchObject({
      outstanding: 0,
      status: 'paid',
    })
  })
})

describe('sumEntryAmounts', () => {
  it('adds up every given bill', () => {
    expect(
      sumEntryAmounts([
        { entry: charges, totalPaid: 10000 },
        { entry: charges, totalPaid: 15750 },
        { entry: { ...charges, waterAmount: 0 }, totalPaid: 0 },
      ]),
    ).toEqual({ totalBilled: 46950, totalPaid: 25750, outstanding: 21200 })
  })

  it('returns zeros for no bills', () => {
    expect(sumEntryAmounts([])).toEqual({ totalBilled: 0, totalPaid: 0, outstanding: 0 })
  })

  it('rounds away floating-point noise', () => {
    const cents = { rentAmount: 0.1, electricityUnits: 0, electricityRate: 0, waterAmount: 0 }
    expect(
      sumEntryAmounts([
        { entry: cents, totalPaid: 0 },
        { entry: { ...cents, rentAmount: 0.2 }, totalPaid: 0 },
      ]),
    ).toEqual({ totalBilled: 0.3, totalPaid: 0, outstanding: 0.3 })
  })
})
