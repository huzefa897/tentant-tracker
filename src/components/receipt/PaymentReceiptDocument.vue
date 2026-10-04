<script setup lang="ts">
import { computed } from 'vue'

import type { PaymentReceipt } from '@/types/receipt'
import { formatAmount, formatINR, formatINRWithPaise } from '@/utils/currency'
import {
  formatDateValueNumeric,
  formatMonthValue,
  formatOrdinal,
  isValidIsoTimestamp,
  toDateValue,
} from '@/utils/date'
import { formatPhoneNumber } from '@/utils/phone'
import { calculateElectricity } from '@/utils/rentCalculations'

// Shows the saved snapshot exactly as issued: nothing here reads current tenant, issuer, bill
// or payment data.
const props = defineProps<{
  receipt: PaymentReceipt
}>()

const paidInFull = computed(() => props.receipt.outstanding <= 0)

// Only differs from this payment's amount when earlier payments went towards the same bill.
const paidEarlier = computed(() => props.receipt.totalPaid !== props.receipt.paymentAmount)

const receiptDate = computed(() =>
  isValidIsoTimestamp(props.receipt.issuedAt)
    ? formatDateValueNumeric(toDateValue(new Date(props.receipt.issuedAt)))
    : props.receipt.issuedAt,
)

const issuerRows = computed(() => {
  const { issuer } = props.receipt
  return [
    { label: 'Received By / Property Manager', value: issuer.managerName },
    { label: 'Property / Building Name', value: issuer.name },
    { label: 'Address', value: issuer.address },
    {
      label: 'Contact Number',
      value: issuer.contactNumber && formatPhoneNumber(issuer.contactNumber),
    },
    { label: 'Email', value: issuer.email },
  ].filter((row) => row.value)
})

const tenantRows = computed(() => {
  const { tenant } = props.receipt
  return [
    { label: 'Tenant Name', value: tenant.name },
    { label: 'Flat Number', value: tenant.flatNumber },
    {
      label: 'Tenant Mobile Number',
      value: tenant.mobileNumber && formatPhoneNumber(tenant.mobileNumber),
    },
    { label: 'Tenant Deposit Amount', value: formatINR(tenant.depositAmount) },
  ].filter((row) => row.value)
})

const chargeRows = computed(() => {
  const { charges } = props.receipt
  const rows = [
    {
      description: 'Rent Amount',
      details: 'Monthly Rent',
      amount: formatAmount(charges.rentAmount),
    },
    {
      description: 'Electricity Units',
      details: 'Units Consumed',
      amount: String(charges.electricityUnits),
    },
    {
      description: 'Electricity Per Unit',
      details: 'Rate per Unit',
      amount: formatAmount(charges.electricityRate),
    },
    {
      description: 'Electricity Charge',
      details: `${charges.electricityUnits} Units × ${formatINR(charges.electricityRate)}`,
      amount: formatAmount(calculateElectricity(charges.electricityUnits, charges.electricityRate)),
    },
  ]

  if (charges.waterAmount > 0) {
    rows.push({
      description: 'Water Charge',
      details: 'Monthly Water',
      amount: formatAmount(charges.waterAmount),
    })
  }

  return rows
})
</script>

<template>
  <!-- A paper document: white with dark text in any app theme, and when printed. These raw
       colours are deliberate; theme tokens would follow the app theme. -->
  <article
    class="receipt-document mx-auto w-full max-w-3xl border-2 border-neutral-900 bg-white p-5 text-neutral-900 sm:p-8"
    aria-labelledby="receipt-title"
  >
    <header class="border-b border-neutral-300 pb-3 text-center">
      <h1 id="receipt-title" class="text-2xl font-bold tracking-[0.15em] sm:text-3xl">
        PAYMENT RECEIPT
      </h1>
      <p class="mt-1 text-sm tracking-widest text-neutral-700">Rental / Tenant Payment Receipt</p>
    </header>

    <section class="mt-5 grid gap-3 sm:grid-cols-3 sm:gap-5">
      <div class="receipt-box">
        <p class="receipt-box-label">Receipt No.</p>
        <p class="receipt-box-value break-all" data-testid="receipt-reference">
          {{ receipt.reference }}
        </p>
      </div>
      <div class="receipt-box">
        <p class="receipt-box-label">Receipt Date</p>
        <p class="receipt-box-value" data-testid="receipt-issued">{{ receiptDate }}</p>
      </div>
      <div class="receipt-box">
        <p class="receipt-box-label">Payment Status</p>
        <p class="receipt-box-value" data-testid="receipt-status">
          {{ paidInFull ? '✔ PAID' : 'PARTIALLY PAID' }}
        </p>
      </div>
    </section>

    <div class="mt-6 grid gap-6 sm:grid-cols-2 sm:gap-0">
      <section
        class="sm:border-r sm:border-neutral-300 sm:pr-5"
        aria-labelledby="receipt-issuer-heading"
        data-testid="receipt-issuer"
      >
        <h2 id="receipt-issuer-heading" class="receipt-heading">Property / Issuer Details</h2>
        <dl class="receipt-details">
          <div v-for="row in issuerRows" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd class="whitespace-pre-line">: {{ row.value }}</dd>
          </div>
        </dl>
      </section>

      <section
        class="sm:pl-5"
        aria-labelledby="receipt-tenant-heading"
        data-testid="receipt-tenant-details"
      >
        <h2 id="receipt-tenant-heading" class="receipt-heading">Tenant Details</h2>
        <dl class="receipt-details">
          <div v-for="row in tenantRows" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd :data-testid="row.label === 'Tenant Name' ? 'receipt-tenant' : undefined">
              : {{ row.value }}
            </dd>
          </div>
        </dl>
      </section>
    </div>

    <section class="mt-6" aria-labelledby="receipt-rental-heading">
      <h2 id="receipt-rental-heading" class="text-sm font-bold tracking-widest uppercase">
        Rental Details
      </h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-3 sm:gap-5">
        <div class="receipt-box">
          <p class="receipt-box-label">Billing Month</p>
          <p class="receipt-box-value">{{ formatMonthValue(receipt.billingMonth) }}</p>
        </div>
        <div class="receipt-box">
          <p class="receipt-box-label">Rent Due Day</p>
          <p class="receipt-box-value">{{ formatOrdinal(receipt.rentDueDay) }}</p>
        </div>
        <div class="receipt-box">
          <p class="receipt-box-label">Paid Date</p>
          <p class="receipt-box-value" data-testid="receipt-paid-date">
            {{ formatDateValueNumeric(receipt.paidDate) }}
          </p>
        </div>
      </div>
    </section>

    <section class="mt-6" aria-label="Charges and payment">
      <div class="overflow-x-auto">
        <table class="w-full text-sm" data-testid="receipt-charges">
          <thead class="text-left text-neutral-500 uppercase">
            <tr>
              <th scope="col" class="py-2 pr-3 font-normal">#</th>
              <th scope="col" class="py-2 pr-3 font-normal">Description</th>
              <th scope="col" class="py-2 pr-3 font-normal">Details</th>
              <th scope="col" class="py-2 text-right font-normal">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, index) in chargeRows"
              :key="row.description"
              class="border-b border-neutral-300"
            >
              <td class="py-2 pr-3">{{ index + 1 }}</td>
              <td class="py-2 pr-3 whitespace-nowrap">{{ row.description }}</td>
              <td class="py-2 pr-3 text-neutral-600">{{ row.details }}</td>
              <td class="py-2 text-right tabular-nums">{{ row.amount }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <dl class="mt-1 text-sm font-bold uppercase" data-testid="receipt-totals">
        <div class="receipt-total border-b border-neutral-300">
          <dt>Total Due</dt>
          <dd>{{ formatAmount(receipt.totalDue) }}</dd>
        </div>
        <div class="receipt-total">
          <dt>{{ paidEarlier ? 'Total Paid to Date' : 'Amount Paid' }}</dt>
          <dd>{{ formatAmount(receipt.totalPaid) }}</dd>
        </div>
        <div class="receipt-total text-red-700">
          <dt>Overdue Amount</dt>
          <dd>{{ formatAmount(receipt.outstanding) }}</dd>
        </div>
        <div class="receipt-total text-amber-700">
          <dt>Last Month Overdue</dt>
          <dd>{{ formatAmount(receipt.previousMonthOutstanding) }}</dd>
        </div>
      </dl>
    </section>

    <section
      class="mt-5 grid border border-neutral-300 sm:grid-cols-[3fr_2fr]"
      aria-label="Payment summary"
    >
      <div class="p-5 sm:border-r sm:border-neutral-300" data-testid="receipt-summary">
        <template v-if="paidInFull">
          <p class="text-lg font-bold">✔ Payment received in full.</p>
          <p class="mt-1 text-sm text-neutral-600">
            Thank you! Your payment has been received successfully.
          </p>
        </template>
        <template v-else>
          <p class="text-lg font-bold">✔ Part payment received.</p>
          <p class="mt-1 text-sm text-neutral-600">
            {{ formatINRWithPaise(receipt.outstanding) }} remains due for
            {{ formatMonthValue(receipt.billingMonth) }}.
          </p>
        </template>
      </div>
      <div
        class="flex flex-col items-center justify-center border-t border-neutral-300 p-5 text-center sm:border-t-0"
      >
        <p class="text-sm tracking-widest text-neutral-700 uppercase">
          {{ paidEarlier ? 'This Payment' : 'Amount Paid' }}
        </p>
        <p class="mt-1 text-3xl font-bold tabular-nums" data-testid="receipt-amount">
          {{ formatINRWithPaise(receipt.paymentAmount) }}
        </p>
      </div>
    </section>

    <section class="mt-5" aria-labelledby="receipt-notes-heading">
      <h2 id="receipt-notes-heading" class="text-sm font-bold tracking-widest uppercase">
        Notes / Remarks
      </h2>
      <div class="mt-2 border border-neutral-300 px-5 py-3 text-sm">
        <!-- Text interpolation, never v-html: notes are user input. -->
        <p
          v-if="receipt.paymentNotes.trim()"
          class="mb-2 break-words whitespace-pre-wrap"
          data-testid="receipt-notes"
        >
          {{ receipt.paymentNotes }}
        </p>
        <p>Thank you for your payment.</p>
        <p>Please retain this receipt for your records.</p>
      </div>
    </section>

    <section class="mt-10 grid grid-cols-2 gap-8 text-center text-xs tracking-widest uppercase">
      <p class="border-t border-neutral-900 pt-2 text-neutral-700">Signature</p>
      <p class="border-t border-neutral-900 pt-2 text-neutral-700" data-testid="receipt-authorized">
        Authorized by · {{ receipt.issuer.managerName || receipt.issuer.name }}
      </p>
    </section>

    <p class="mt-4 text-center text-sm">Thank you for your payment.</p>
  </article>
</template>

<style scoped>
@reference '@/style.css';

.receipt-box {
  @apply border border-neutral-300 px-4 py-2.5;
}
.receipt-box-label {
  @apply text-xs tracking-widest text-neutral-700 uppercase;
}
.receipt-box-value {
  @apply mt-0.5 text-base font-bold;
}
.receipt-heading {
  @apply border-b-2 border-neutral-900 pb-1 text-sm font-bold tracking-widest uppercase;
}
.receipt-details {
  @apply mt-3 space-y-1.5 text-sm;
}
.receipt-details > div {
  @apply grid grid-cols-[minmax(0,10rem)_1fr] gap-3;
}
.receipt-details dt {
  @apply text-neutral-600;
}
.receipt-details dd {
  @apply break-words;
}
.receipt-total {
  @apply flex justify-end gap-6 py-2 tabular-nums sm:gap-16;
}
.receipt-total dd {
  @apply w-28 text-right;
}
</style>
