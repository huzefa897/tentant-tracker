import type { Payment } from '@/types/payment'
import type { PaymentReceipt } from '@/types/receipt'
import type { RentEntry } from '@/types/rentEntry'
import {
  calculateElectricity,
  calculateOutstanding,
  calculateTotalDue,
  getPaymentStatus,
} from '@/utils/rentCalculations'

// Plain fixtures, with no app imports beyond types and pure utils, so service fakes can use
// them without importing the router.

// A saved bill as the backend returns it; tests override what they care about. The figures
// follow the charges (and totalPaid) unless overridden too. billStatus: 'void' gives it void
// details and the figures of a void bill.
export function makeEntry(overrides: Partial<RentEntry> = {}): RentEntry {
  const charges = {
    rentAmount: 15000,
    electricityUnits: 75,
    electricityRate: 6,
    waterAmount: 300,
    ...overrides,
  }
  const totalPaid = overrides.totalPaid ?? 0
  const totalDue = calculateTotalDue(charges)
  // A void bill owes nothing and has no payment status.
  const isVoid = overrides.billStatus === 'void'

  return {
    id: 'entry-1',
    tenantId: 'tenant-001',
    billingMonth: '2026-09',
    rentAmount: charges.rentAmount,
    electricityUnits: charges.electricityUnits,
    electricityRate: charges.electricityRate,
    electricityAmount: calculateElectricity(charges.electricityUnits, charges.electricityRate),
    waterAmount: charges.waterAmount,
    totalDue,
    totalPaid,
    outstanding: isVoid ? 0 : calculateOutstanding(totalDue, totalPaid),
    status: isVoid ? null : getPaymentStatus(totalDue, totalPaid),
    // September, postpaid, due on the 11th: due in October, not yet past.
    paymentTiming: 'postpaid',
    dueDate: '2026-10-11',
    dueStatus: isVoid
      ? null
      : calculateOutstanding(totalDue, totalPaid) <= 0
        ? 'settled'
        : 'upcoming',
    notes: '',
    createdAt: '2026-10-03T06:00:00.000Z',
    billStatus: 'active',
    voided: isVoid
      ? { at: '2026-10-08T06:00:00.000Z', byName: 'Test Owner', reason: 'Entered twice' }
      : null,
    replacesEntryId: null,
    replacedByEntryId: null,
    ...overrides,
  }
}

// A valid saved payment against entry-1; tests override what they care about.
export function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'payment-1',
    entryId: 'entry-1',
    amount: 10000,
    paidDate: '2026-10-03',
    notes: '',
    createdAt: '2026-10-03T06:00:00.000Z',
    status: 'recorded',
    reversal: null,
    receipt: null,
    ...overrides,
  }
}

// A valid saved receipt for payment-1 against entry-1 (the make* defaults: ₹10,000 of a
// ₹15,750 bill); tests override what they care about.
export function makeReceipt(overrides: Partial<PaymentReceipt> = {}): PaymentReceipt {
  return {
    id: 'receipt-1',
    reference: 'Shaik_Zahid_Ali_202_Rent_September 2026',
    paymentId: 'payment-1',
    entryId: 'entry-1',
    issuedAt: '2026-10-03T07:00:00.000Z',
    issuedDate: '2026-10-03',
    issuer: {
      name: 'Saleem Towers',
      address: '1 Example Road\nHyderabad',
      contactNumber: '',
      receivedBy: 'Test Manager',
      authorizedBy: 'Test Manager',
    },
    tenant: {
      name: 'Shaik Zahid Ali',
      flatNumber: '202',
      mobileNumber: '+918341413827',
      depositAmount: 90000,
    },
    billingMonth: '2026-09',
    rentDueDay: 11,
    charges: {
      rentAmount: 15000,
      electricityUnits: 75,
      electricityRate: 6,
      electricityAmount: 450,
      waterAmount: 300,
    },
    totalDue: 15750,
    totalPaid: 10000,
    outstanding: 5750,
    previousMonthOutstanding: 0,
    paymentAmount: 10000,
    paidDate: '2026-10-03',
    paymentNotes: '',
    status: 'issued',
    voidedAt: null,
    voidReason: '',
    ...overrides,
  }
}
