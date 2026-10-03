// 1 -> "1st", 2 -> "2nd", 11 -> "11th", 21 -> "21st"
export function formatOrdinal(value: number): string {
  const mod100 = value % 100

  if (mod100 >= 11 && mod100 <= 13) {
    return `${value}th`
  }

  switch (value % 10) {
    case 1:
      return `${value}st`
    case 2:
      return `${value}nd`
    case 3:
      return `${value}rd`
    default:
      return `${value}th`
  }
}
