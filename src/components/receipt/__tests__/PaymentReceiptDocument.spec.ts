import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PaymentReceiptDocument from '@/components/receipt/PaymentReceiptDocument.vue'
import { makeReceipt } from '@/test/rentEntries'
import type { PaymentReceipt } from '@/types/receipt'

function render(overrides: Partial<PaymentReceipt> = {}) {
  return mount(PaymentReceiptDocument, { props: { receipt: makeReceipt(overrides) } })
}

// "Label" -> ": value" rows of a details list.
function details(wrapper: VueWrapper, testId: string) {
  return Object.fromEntries(
    wrapper
      .get(`[data-testid="${testId}"]`)
      .findAll('dl > div')
      .map((row) => [row.get('dt').text(), row.get('dd').text()]),
  )
}

function rows(wrapper: VueWrapper, selector: string) {
  return wrapper.findAll(selector).map((row) => row.findAll('td, dt, dd').map((c) => c.text()))
}

// A full September bill: ₹17,000 rent, 109 units at ₹6, paid in full on 4 Oct.
const paidInFull: Partial<PaymentReceipt> = {
  reference: 'RCP-102-202609',
  issuedAt: new Date(2026, 9, 4, 12).toISOString(),
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

describe('PaymentReceiptDocument', () => {
  it('shows the receipt number, date and status', () => {
    const wrapper = render(paidInFull)

    expect(wrapper.get('h1').text()).toBe('PAYMENT RECEIPT')
    expect(wrapper.get('[data-testid="receipt-reference"]').text()).toBe('RCP-102-202609')
    expect(wrapper.get('[data-testid="receipt-issued"]').text()).toBe('04/10/2026')
    expect(wrapper.get('[data-testid="receipt-status"]').text()).toBe('✔ PAID')
  })

  it('shows the issuer and tenant details', () => {
    const wrapper = render(paidInFull)

    expect(details(wrapper, 'receipt-issuer')).toEqual({
      'Received By / Property Manager': ': Test Manager',
      'Property / Building Name': ': Saleem Towers',
      Address: ': 1 Example Road,\nHyderabad – 500001',
      'Contact Number': ': +91 98765 43210',
      Email: ': owner@example.com',
    })
    expect(details(wrapper, 'receipt-tenant-details')).toEqual({
      'Tenant Name': ': Test Tenant',
      'Flat Number': ': 102',
      'Tenant Mobile Number': ': +91 91234 56789',
      'Tenant Deposit Amount': ': ₹50,000',
    })
  })

  it('leaves out issuer and tenant details that are not set', () => {
    const wrapper = render({
      issuer: {
        name: 'Saleem Towers',
        managerName: '',
        address: 'Addr',
        contactNumber: '',
        email: '',
      },
      tenant: { name: 'Test Tenant', flatNumber: '102', mobileNumber: '', depositAmount: 0 },
    })

    expect(Object.keys(details(wrapper, 'receipt-issuer'))).toEqual([
      'Property / Building Name',
      'Address',
    ])
    expect(details(wrapper, 'receipt-tenant-details')['Tenant Mobile Number']).toBeUndefined()
    expect(details(wrapper, 'receipt-tenant-details')['Tenant Deposit Amount']).toBe(': ₹0')
    expect(wrapper.get('[data-testid="receipt-authorized"]').text()).toBe(
      'Authorized by · Saleem Towers',
    )
  })

  it('shows the rental details, charges and totals of a bill paid in full', () => {
    const wrapper = render(paidInFull)

    expect(wrapper.text()).toContain('September 2026')
    expect(wrapper.text()).toContain('1st')
    expect(wrapper.get('[data-testid="receipt-paid-date"]').text()).toBe('04/10/2026')
    expect(rows(wrapper, '[data-testid="receipt-charges"] tbody tr')).toEqual([
      ['1', 'Rent Amount', 'Monthly Rent', '17,000.00'],
      ['2', 'Electricity Units', 'Units Consumed', '109'],
      ['3', 'Electricity Per Unit', 'Rate per Unit', '6.00'],
      ['4', 'Electricity Charge', '109 Units × ₹6', '654.00'],
    ])
    expect(rows(wrapper, '[data-testid="receipt-totals"] > div')).toEqual([
      ['Total Due', '17,654.00'],
      ['Amount Paid', '17,654.00'],
      ['Overdue Amount', '0.00'],
      ['Last Month Overdue', '0.00'],
    ])
    expect(wrapper.get('[data-testid="receipt-summary"]').text()).toContain(
      'Payment received in full.',
    )
    expect(wrapper.get('[data-testid="receipt-amount"]').text()).toBe('₹17,654.00')
    expect(wrapper.get('[data-testid="receipt-authorized"]').text()).toBe(
      'Authorized by · Test Manager',
    )
  })

  it('adds a water row when the bill has water charges', () => {
    const wrapper = render()

    expect(rows(wrapper, '[data-testid="receipt-charges"] tbody tr').slice(-1)).toEqual([
      ['5', 'Water Charge', 'Monthly Water', '300.00'],
    ])
  })

  it('shows a part payment with the balance left and earlier payments to date', () => {
    // The second payment of ₹3,000 on a ₹15,750 bill; ₹10,000 was paid before it.
    const wrapper = render({
      paymentAmount: 3000,
      totalPaid: 13000,
      outstanding: 2750,
      previousMonthOutstanding: 750,
    })

    expect(wrapper.get('[data-testid="receipt-status"]').text()).toBe('PARTIALLY PAID')
    expect(rows(wrapper, '[data-testid="receipt-totals"] > div')).toEqual([
      ['Total Due', '15,750.00'],
      ['Total Paid to Date', '13,000.00'],
      ['Overdue Amount', '2,750.00'],
      ['Last Month Overdue', '750.00'],
    ])
    expect(wrapper.get('[data-testid="receipt-summary"]').text()).toContain(
      '₹2,750.00 remains due for September 2026.',
    )
    expect(wrapper.text()).toContain('This Payment')
    expect(wrapper.get('[data-testid="receipt-amount"]').text()).toBe('₹3,000.00')
  })

  it('shows payment notes as text, never HTML, before the standard remarks', () => {
    const wrapper = render({ paymentNotes: '<b>Cash</b>' })

    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.get('[data-testid="receipt-notes"]').text()).toBe('<b>Cash</b>')
    expect(wrapper.text()).toContain('Please retain this receipt for your records.')
  })

  it('shows only the standard remarks without notes', () => {
    expect(render({ paymentNotes: '  ' }).find('[data-testid="receipt-notes"]').exists()).toBe(
      false,
    )
  })

  it('shows a long reference, a long name and maximum-length notes in full', () => {
    const reference = `RCP-202-202609-${'c'.repeat(36)}`
    const name = 'Mohammed Abdul Rahman Siddiqui Khan Bahadur'.repeat(2)
    const notes = 'n'.repeat(500)
    const wrapper = render({
      reference,
      tenant: { ...makeReceipt().tenant, name },
      paymentNotes: notes,
    })

    expect(wrapper.get('[data-testid="receipt-reference"]').text()).toBe(reference)
    expect(wrapper.get('[data-testid="receipt-tenant"]').text()).toBe(`: ${name}`)
    expect(wrapper.get('[data-testid="receipt-notes"]').text()).toBe(notes)
  })

  it('is a white document with dark text whatever the app theme', () => {
    const classes = render().get('.receipt-document').classes()

    expect(classes).toContain('bg-white')
    expect(classes).toContain('text-neutral-900')
  })
})
