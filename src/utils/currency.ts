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

const twoDecimals = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

// 17000 -> "17,000.00", for amount columns headed "(₹)".
export function formatAmount(value: number): string {
  return twoDecimals.format(Math.round(value * 100) / 100 + 0)
}

// 17654 -> "₹17,654.00": always with paise, as on receipts.
export function formatINRWithPaise(value: number): string {
  return withPaise.format(Math.round(value * 100) / 100 + 0)
}
