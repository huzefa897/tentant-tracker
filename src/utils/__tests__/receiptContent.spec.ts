import { describe, expect, it } from 'vitest'

import { makeReceipt } from '@/test/rentEntries'
import type { PaymentReceipt } from '@/types/receipt'
import { getReceiptContent } from '@/utils/receiptContent'

// A September bill: ₹17,000 rent, 109 units at ₹6, paid in full on 4 Oct.
const paidInFull: Partial<PaymentReceipt> = {
  reference: 'Test_Tenant_102_Rent_September 2026',
  issuedAt: '2026-10-04T06:30:00.000Z',
  issuedDate: '2026-10-04',
  issuer: {
    name: 'Saleem Towers',
    address: '1 Example Road,\nHyderabad – 500001',
    contactNumber: '+919876543210',
    receivedBy: 'Test Manager',
    authorizedBy: 'Test Manager',
  },
  tenant: {
    name: 'Test Tenant',
    flatNumber: '102',
    mobileNumber: '+919123456789',
    depositAmount: 50000,
  },
  billingMonth: '2026-09',
  rentDueDay: 1,
  charges: {
    rentAmount: 17000,
    electricityUnits: 109,
    electricityRate: 6,
    electricityAmount: 654,
    electricityMode: 'manual',
    openingReading: null,
    closingReading: null,
    waterAmount: 0,
  },
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
      'Test_Tenant_102_Rent_September 2026.pdf',
    )
  })

  it('keeps characters file systems reject out of the file name', () => {
    const content = getReceiptContent(makeReceipt({ reference: 'A/B:_"C"?_1*2_Rent_May 2026' }))

    expect(content.fileName).toBe('A-B-_-C-_1-2_Rent_May 2026.pdf')
  })

  it('gives the header, status and facts', () => {
    const content = getReceiptContent(makeReceipt(paidInFull))

    expect(content).toMatchObject({
      propertyName: 'Saleem Towers',
      title: 'Payment Receipt',
      subtitle: 'Rental payment receipt',
      receiptNumber: 'Test_Tenant_102_Rent_September 2026',
      status: 'PAID',
    })
    expect(content.facts).toEqual([
      { label: 'Receipt reference', value: 'Test_Tenant_102_Rent_September 2026' },
      { label: 'Receipt date', value: '04/10/2026' },
      { label: 'Billing period', value: 'September 2026' },
      { label: 'Payment date', value: '04/10/2026' },
    ])
  })

  // 15:30 UTC on 3 Oct is already 4 Oct in Sydney: the saved date wins, wherever it's downloaded.
  it('prints the saved issue date, not one worked out from the issue time', () => {
    const content = getReceiptContent(
      makeReceipt({ issuedAt: '2026-10-03T15:30:00.000Z', issuedDate: '2026-10-03' }),
    )

    expect(content.facts[1]).toEqual({ label: 'Receipt date', value: '03/10/2026' })
  })

  it('says who issued it and who paid', () => {
    const content = getReceiptContent(makeReceipt(paidInFull))

    expect(content.issuedBy).toEqual({
      heading: 'Issued by',
      name: 'Saleem Towers',
      lines: [
        '1 Example Road,\nHyderabad – 500001',
        '+91 98765 43210',
        'Received by: Test Manager',
      ],
    })
    expect(content.receivedFrom).toEqual({
      heading: 'Received from (tenant)',
      name: 'Test Tenant',
      lines: ['Flat 102', '+91 91234 56789', 'Security deposit: ₹50,000'],
    })
  })

  it('leaves out details that are not set, and is authorized by the property then', () => {
    const content = getReceiptContent(
      makeReceipt({
        issuer: {
          name: 'Saleem Towers',
          address: 'Addr',
          contactNumber: '',
          receivedBy: '',
          authorizedBy: '',
        },
        tenant: { name: 'Test Tenant', flatNumber: '102', mobileNumber: '', depositAmount: 0 },
      }),
    )

    expect(content.issuedBy.lines).toEqual(['Addr'])
    expect(content.receivedFrom.lines).toEqual(['Flat 102', 'Security deposit: ₹0'])
    expect(content.authorizedBy).toBe('Authorized by Saleem Towers')
  })

  it('names who received the money and who authorized the receipt separately', () => {
    // A manager recorded the payment; an owner issued its receipt later.
    const content = getReceiptContent(
      makeReceipt({
        ...paidInFull,
        issuer: { ...paidInFull.issuer!, receivedBy: 'Test Manager', authorizedBy: 'Test Owner' },
      }),
    )

    expect(content.issuedBy.lines).toContain('Received by: Test Manager')
    expect(content.authorizedBy).toBe('Authorized by Test Owner')
  })

  it('prints the saved electricity amount, never recalculating it', () => {
    const content = getReceiptContent(
      makeReceipt({ charges: { ...makeReceipt().charges, electricityAmount: 451 } }),
    )

    expect(content.charges[1]?.amount).toBe('451.00')
    expect(content.summary[1]).toMatchObject({ label: 'Electricity charge', value: '₹451.00' })
  })

  it('gives the rental details, charges, summary and outcome of a bill paid in full', () => {
    const content = getReceiptContent(makeReceipt(paidInFull))

    expect(content.rental).toEqual([
      { label: 'Rent due day', value: '1st' },
      { label: 'Billing month', value: 'September 2026' },
    ])
    expect(content.charges).toEqual([
      { description: 'Rent amount', details: 'Monthly Rent', amount: '17,000.00' },
      {
        description: 'Electricity charge',
        details: '109 Units × ₹6.00 per unit',
        amount: '654.00',
      },
    ])
    expect(content.summary).toEqual([
      { label: 'Rent amount', value: '₹17,000.00', style: 'row', tone: 'default' },
      { label: 'Electricity charge', value: '₹654.00', style: 'row', tone: 'default' },
      { label: 'Total due', value: '₹17,654.00', style: 'total', tone: 'default' },
      { label: 'Amount paid', value: '₹17,654.00', style: 'row', tone: 'default' },
      { label: 'Outstanding balance', value: '₹0.00', style: 'strong', tone: 'default' },
      { label: 'Previous month overdue', value: '₹0.00', style: 'strong', tone: 'default' },
    ])
    expect(content.consumption).toBeNull()
    expect(content.outcome).toEqual({
      heading: 'Payment received in full.',
      message: 'Thank you for your payment. Please retain this receipt for your records.',
      tick: true,
    })
    expect(content.authorizedBy).toBe('Authorized by Test Manager')
  })

  it('shows a meter bill’s readings as saved in its consumption details (TC-13)', () => {
    const charges = {
      ...makeReceipt().charges,
      electricityMode: 'meter' as const,
      electricityUnits: 422,
      electricityRate: 8,
      electricityAmount: 3376,
      openingReading: { reading: 2563, readOn: '2026-10-31' },
      closingReading: { reading: 2985, readOn: '2026-12-31' },
    }
    const content = getReceiptContent(makeReceipt({ charges }))

    expect(content.charges[1]).toEqual({
      description: 'Electricity charge',
      details: '422 Units × ₹8.00 per unit',
      amount: '3,376.00',
    })
    expect(content.consumption).toEqual({
      fields: [
        { label: 'Opening reading', value: '2,563' },
        { label: 'Closing reading', value: '2,985' },
        { label: 'Units consumed', value: '422 units' },
        { label: 'Rate per unit', value: '₹8.00' },
      ],
      note: 'Opening reading recorded: 31 Oct 2026 · Closing reading recorded: 31 Dec 2026',
    })
  })

  it('shows the reading tracking started from without a date', () => {
    const charges = {
      ...makeReceipt().charges,
      electricityMode: 'meter' as const,
      openingReading: { reading: 2400, readOn: null },
      closingReading: { reading: 2563, readOn: '2026-10-31' },
    }
    const content = getReceiptContent(makeReceipt({ charges }))

    expect(content.consumption?.fields[0]).toEqual({ label: 'Opening reading', value: '2,400' })
    expect(content.consumption?.note).toBe(
      'Opening reading: the starting reading · Closing reading recorded: 31 Oct 2026',
    )
  })

  it('shows electricity left off as "Not charged", never ₹0 (TC-12)', () => {
    const charges = {
      ...makeReceipt().charges,
      electricityMode: 'not_charged' as const,
      electricityUnits: 0,
      electricityAmount: 0,
    }
    const content = getReceiptContent(makeReceipt({ charges }))

    expect(content.charges[1]).toEqual({
      description: 'Electricity',
      details: 'Not charged on this bill',
      amount: 'Not charged',
    })
    expect(content.summary[1]).toMatchObject({ label: 'Electricity charge', value: 'Not charged' })
    expect(content.consumption).toBeNull()
  })

  it('adds a water row when the bill has water charges', () => {
    const content = getReceiptContent(makeReceipt())

    expect(content.charges.slice(-1)[0]).toEqual({
      description: 'Water charge',
      details: 'Monthly Water',
      amount: '300.00',
    })
    expect(content.summary[2]).toMatchObject({ label: 'Water charge', value: '₹300.00' })
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
    expect(content.outcome.tick).toBe(true)
    expect(content.summary.slice(3).map(({ label, value, tone }) => [label, value, tone])).toEqual([
      ['Total due', '₹15,750.00', 'default'],
      ['Total paid to date', '₹13,000.00', 'default'],
      ['This payment', '₹3,000.00', 'default'],
      ['Outstanding balance', '₹2,750.00', 'overdue'],
      ['Previous month overdue', '₹750.00', 'previous'],
    ])
    expect(content.outcome).toEqual({
      heading: 'Part payment received.',
      message:
        '₹2,750.00 remains due for September 2026. Please retain this receipt for your records.',
      tick: true,
    })
  })

  it('keeps the payment notes as written, and none when blank', () => {
    expect(getReceiptContent(makeReceipt({ paymentNotes: '<b>Cash</b>' })).notes).toBe(
      '<b>Cash</b>',
    )
    expect(getReceiptContent(makeReceipt({ paymentNotes: '  ' })).notes).toBeNull()
  })

  it('reads only the saved snapshot', () => {
    const receipt = makeReceipt(paidInFull)
    const before = getReceiptContent(receipt)

    expect(getReceiptContent(structuredClone(receipt))).toEqual(before)
  })

  describe('a void receipt', () => {
    const voided = makeReceipt({
      ...paidInFull,
      status: 'void',
      voidedAt: '2026-10-07T08:00:00.000Z',
      voidReason: 'Entered ₹17,654 for the wrong month.',
    })

    it('says prominently that it is void, why, and that it confirms nothing', () => {
      const content = getReceiptContent(voided)

      expect(content.voided?.banner).toBe('VOID — Payment reversed')
      expect(content.voided?.details).toContain('Reason: Entered ₹17,654 for the wrong month.')
      expect(content.voided?.details).toContain('no longer confirms a payment')
      expect(content.status).toBe('VOID')
      expect(content.outcome.heading).toBe('Payment reversed.')
      expect(content.outcome.tick).toBe(false)
    })

    it('keeps the snapshot as issued and names the file void', () => {
      const content = getReceiptContent(voided)
      const issued = getReceiptContent(makeReceipt(paidInFull))

      expect(content.receiptNumber).toBe(issued.receiptNumber)
      expect(content.summary).toEqual(issued.summary)
      expect(content.charges).toEqual(issued.charges)
      expect(content.fileName).toBe('Test_Tenant_102_Rent_September 2026 (VOID).pdf')
    })

    it('is not void while issued', () => {
      expect(getReceiptContent(makeReceipt(paidInFull)).voided).toBeNull()
    })
  })
})
