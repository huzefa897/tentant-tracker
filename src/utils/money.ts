// Rupee amounts are stored as numbers but compared and summed as integer paise, so
// 0.1 + 0.2 never leaves a stray balance.

export function toPaise(amount: number): number {
  return Math.round(amount * 100)
}

export function fromPaise(paise: number): number {
  // `+ 0` turns -0 into 0.
  return paise / 100 + 0
}

// hasAtMostDecimals(10.25, 2) passes; 10.255 doesn't. The tolerance absorbs binary noise such
// as 0.29 * 100 = 28.999999999999996.
export function hasAtMostDecimals(amount: number, places: number): boolean {
  const scale = 10 ** places
  return Number.isFinite(amount) && Math.abs(amount * scale - Math.round(amount * scale)) < 1e-6
}

export function hasAtMostTwoDecimals(amount: number): boolean {
  return hasAtMostDecimals(amount, 2)
}
