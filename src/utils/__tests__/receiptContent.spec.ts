import { describe, expect, it } from 'vitest'

import { makeReceipt } from '@/test/rentEntries'
import type { PaymentReceipt } from '@/types/receipt'
import { getReceiptContent } from '@/utils/receiptContent'

// A September bill: ₹17,000 rent, 109 units at ₹6, paid in full on 4 Oct.
const paidInFull: Partial<PaymentReceipt> = {
  reference: 'RCP-102-202609',
  issuedAt: '2026-10-04T06:30:00.000Z',
  issuedDate: '2026-10-04',
  issuer: {
    name: 'Saleem Towers',
    managerName: 'Test Manager',
    address: '1 Example Road,\nHyderabad – 500001',
    contactNumber: '+919876543210',
    email: 'owner@example.com',
  },
  tenant: {
    name: 'Test Tenant',
    flatNumber: '102',
    mobileNumber: '+919123456789',
    depositAmount: 50000,
  },
  billingMonth: '2026-09',
  rentDueDay: 1,
  charges: { rentAmount: 17000, electricityUnits: 109, electricityRate: 6, waterAmount: 0 },
  totalDue: 17654,
  totalPaid: 17654,
  outstanding: 0,
  previousMonthOutstanding: 0,
  paymentAmount: 17654,
  paidDate: '2026-10-04',
}

describe('getReceiptContent', () => {
  it('names the file like the owners’ receipts', () => {
    expect(getReceiptContent(makeReceipt(paidInFull)).fileName).toBe(
      'Test Tenant 102 Rent September 2026 RCP-102-202609.pdf',
    )
  })

  it('keeps characters file systems reject out of the file name', () => {
    const content = getReceiptContent(
      makeReceipt({ tenant: { ...makeReceipt().tenant, name: 'A/B: "C"?', flatNumber: '1*2' } }),
    )

    expect(content.fileName).toBe('A-B- -C- 1-2 Rent September 2026 RCP-202-202609.pdf')
  })

  it('gives the receipt number, date and status', () => {
    const content = getReceiptContent(makeReceipt(paidInFull))

    expect(content).toMatchObject({
      title: 'PAYMENT RECEIPT',
      receiptNumber: 'RCP-102-202609',
      receiptDate: '04/10/2026',
      paidInFull: true,
      status: 'PAID',
    })
  })

  // 15:30 UTC on 3 Oct is already 4 Oct in Sydney: the saved date wins, wherever it's downloaded.
  it('prints the saved issue date, not one worked out from the issue time', () => {
    const content = getReceiptContent(
      makeReceipt({ issuedAt: '2026-10-03T15:30:00.000Z', issuedDate: '2026-10-03' }),
    )

    expect(content.receiptDate).toBe('03/10/2026')
  })

  it('lists the issuer and tenant details', () => {
    const content = getReceiptContent(makeReceipt(paidInFull))

    expect(content.issuer).toEqual([
      { label: 'Received By / Property Manager', value: 'Test Manager' },
      { label: 'Property / Building Name', value: 'Saleem Towers' },
      { label: 'Address', value: '1 Example Road,\nHyderabad – 500001' },
      { label: 'Contact Number', value: '+91 98765 43210' },
      { label: 'Email', value: 'owner@example.com' },
    ])
    expect(content.tenant).toEqual([
      { label: 'Tenant Name', value: 'Test Tenant' },
      { label: 'Flat Number', value: '102' },
      { label: 'Tenant Mobile Number', value: '+91 91234 56789' },
      { label: 'Tenant Deposit Amount', value: '₹50,000' },
    ])
  })

  it('leaves out details that are not set, and is authorized by the property then', () => {
    const content = getReceiptContent(
      makeReceipt({
        issuer: {
          name: 'Saleem Towers',
          managerName: '',
          address: 'Addr',
          contactNumber: '',
          email: '',
        },
        tenant: { name: 'Test Tenant', flatNumber: '102', mobileNumber: '', depositAmount: 0 },
      }),
    )

    expect(content.issuer.map((field) => field.label)).toEqual([
      'Property / Building Name',
      'Address',
    ])
    expect(content.tenant.map((field) => field.label)).not.toContain('Tenant Mobile Number')
    expect(content.tenant.slice(-1)[0]).toEqual({ label: 'Tenant Deposit Amount', value: '₹0' })
    expect(content.authorizedBy).toBe('AUTHORIZED BY · Saleem Towers')
  })

  it('gives the rental details, charges, totals and summary of a bill paid in full', () => {
    const content = getReceiptContent(makeReceipt(paidInFull))

    expect(content.rental).toEqual([
      { label: 'Billing Month', value: 'September 2026' },
      { label: 'Rent Due Day', value: '1st' },
      { label: 'Paid Date', value: '04/10/2026' },
    ])
    expect(content.charges).toEqual([
      { description: 'Rent Amount', details: 'Monthly Rent', amount: '17,000.00' },
      { description: 'Electricity Units', details: 'Units Consumed', amount: '109' },
      { description: 'Electricity Per Unit', details: 'Rate per Unit', amount: '6.00' },
      { description: 'Electricity Charge', details: '109 Units × ₹6', amount: '654.00' },
    ])
    expect(content.totals).toEqual([
      { label: 'TOTAL DUE', value: '17,654.00', tone: 'default' },
      { label: 'AMOUNT PAID', value: '17,654.00', tone: 'default' },
      { label: 'OVERDUE AMOUNT', value: '0.00', tone: 'overdue' },
      { label: 'LAST MONTH OVERDUE', value: '0.00', tone: 'previous' },
    ])
    expect(content.summary).toEqual({
      heading: 'Payment received in full.',
      message: 'Thank you! Your payment has been received successfully.',
      amountLabel: 'AMOUNT PAID',
      amount: '₹17,654.00',
    })
    expect(content.authorizedBy).toBe('AUTHORIZED BY · Test Manager')
  })

  it('adds a water row when the bill has water charges', () => {
    expect(getReceiptContent(makeReceipt()).charges.slice(-1)[0]).toEqual({
      description: 'Water Charge',
      details: 'Monthly Water',
      amount: '300.00',
    })
  })

  it('shows a part payment with the balance left and earlier payments to date', () => {
    // The second payment of ₹3,000 on a ₹15,750 bill; ₹10,000 was paid before it.
    const content = getReceiptContent(
      makeReceipt({
        paymentAmount: 3000,
        totalPaid: 13000,
        outstanding: 2750,
        previousMonthOutstanding: 750,
      }),
    )

    expect(content.status).toBe('PARTIALLY PAID')
    expect(content.paidInFull).toBe(false)
    expect(content.totals.map((total) => [total.label, total.value])).toEqual([
      ['TOTAL DUE', '15,750.00'],
      ['TOTAL PAID TO DATE', '13,000.00'],
      ['OVERDUE AMOUNT', '2,750.00'],
      ['LAST MONTH OVERDUE', '750.00'],
    ])
    expect(content.summary).toEqual({
      heading: 'Part payment received.',
      message: '₹2,750.00 remains due for September 2026.',
      amountLabel: 'THIS PAYMENT',
      amount: '₹3,000.00',
    })
  })

  it('puts the payment notes, as written, before the standard remarks', () => {
    expect(getReceiptContent(makeReceipt({ paymentNotes: '<b>Cash</b>' })).remarks).toEqual([
      '<b>Cash</b>',
      'Thank you for your payment.\nPlease retain this receipt for your records.',
    ])
    expect(getReceiptContent(makeReceipt({ paymentNotes: '  ' })).remarks).toHaveLength(1)
  })

  it('reads only the saved snapshot', () => {
    const receipt = makeReceipt(paidInFull)
    const before = getReceiptContent(receipt)

    expect(getReceiptContent(structuredClone(receipt))).toEqual(before)
  })
})
