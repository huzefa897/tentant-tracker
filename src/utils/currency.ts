const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

// 15000 -> "₹15,000", 100000 -> "₹1,00,000"
export function formatINR(value: number): string {
  return inrFormatter.format(value)
}
