// Turns a saved receipt into a PDF file the browser downloads. jsPDF and the fonts are only
// fetched on the first download, then reused.

import boldFontUrl from '@expo-google-fonts/poppins/700Bold/Poppins_700Bold.ttf?url'
import regularFontUrl from '@expo-google-fonts/poppins/400Regular/Poppins_400Regular.ttf?url'

import type { PaymentReceipt } from '@/types/receipt'
import { getReceiptContent } from '@/utils/receiptContent'
import type { ReceiptFonts } from '@/utils/receiptPdf'

async function fetchBase64(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Unable to load ${url}`)

  const bytes = new Uint8Array(await response.arrayBuffer())
  let binary = ''
  // In chunks: spreading a whole font into one call overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

let fonts: Promise<ReceiptFonts> | null = null

function loadFonts(): Promise<ReceiptFonts> {
  fonts ??= Promise.all([fetchBase64(regularFontUrl), fetchBase64(boldFontUrl)]).then(
    ([regular, bold]) => ({ regular, bold }),
    (error: unknown) => {
      // Let the next download try again.
      fonts = null
      throw error
    },
  )
  return fonts
}

// Rejects if the PDF can't be made (e.g. offline before the fonts were ever loaded). The browser
// saves the file; there's no way to know whether the user kept it.
export async function downloadReceiptPdf(receipt: PaymentReceipt): Promise<void> {
  const [{ renderReceiptPdf }, loadedFonts] = await Promise.all([
    import('@/utils/receiptPdf'),
    loadFonts(),
  ])
  const content = getReceiptContent(receipt)
  renderReceiptPdf(content, loadedFonts).save(content.fileName)
}
