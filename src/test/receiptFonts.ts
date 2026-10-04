import { readFileSync } from 'node:fs'

import type { ReceiptFonts } from '@/utils/receiptPdf'

// The real Poppins files, as the app loads them, for rendering PDFs in tests.
function read(path: string): string {
  return readFileSync(`node_modules/@expo-google-fonts/poppins/${path}`).toString('base64')
}

export const receiptFonts: ReceiptFonts = {
  regular: read('400Regular/Poppins_400Regular.ttf'),
  semibold: read('600SemiBold/Poppins_600SemiBold.ttf'),
  bold: read('700Bold/Poppins_700Bold.ttf'),
}
