const wholeRupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

const withPaise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

// 15000 -> "₹15,000", 100000 -> "₹1,00,000", 450.5 -> "₹450.50"
export function formatINR(value: number): string {
  // `+ 0` turns -0 into 0 so tiny negative rounding errors don't print as "-₹0".
  const rounded = Math.round(value * 100) / 100 + 0

  return (Number.isInteger(rounded) ? wholeRupees : withPaise).format(rounded)
}
