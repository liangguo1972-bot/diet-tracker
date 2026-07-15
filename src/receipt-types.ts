export type ReceiptImportStatus = 'uploaded' | 'processing' | 'ready_for_review' | 'failed' | 'confirmed' | 'cancelled'
export type ReceiptMatchStatus = 'matched' | 'possible_match' | 'unmatched' | 'ignored'
export type ReceiptAction = 'add_to_inventory' | 'ignore'

export type ReceiptImportCreated = {
  receiptImportId: string
  storagePath: string
  status: ReceiptImportStatus
  reused: boolean
}

export type ReceiptItem = {
  receiptItemId: string
  position: number
  rawName: string
  rawQuantity: number | null
  rawUnit: string | null
  rawPrice: number | null
  ingredientId: string | null
  ingredientName: string | null
  matchStatus: ReceiptMatchStatus
  matchConfidence: number | null
  confirmedName: string
  confirmedQuantity: number | null
  confirmedUnit: string
  storage: string
  action: ReceiptAction
}

export type ReceiptImport = {
  receiptImportId: string
  status: ReceiptImportStatus
  fileName: string
  contentType: string
  storagePath: string
  merchantName: string | null
  purchasedOn: string | null
  errorCode: string | null
  items: ReceiptItem[]
}

export type ReceiptImportSummary = {
  receiptImportId: string
  status: ReceiptImportStatus
  fileName: string
  merchantName: string | null
  purchasedOn: string | null
  errorCode: string | null
  createdAt: string
  confirmedAt: string | null
}

export type ReceiptItemInput = Pick<ReceiptItem, 'receiptItemId' | 'ingredientId' | 'confirmedName' | 'confirmedQuantity' | 'confirmedUnit' | 'storage' | 'action'>

export type ConfirmReceiptResult = {
  receiptImportId: string
  status: 'confirmed'
  inventoryCount: number
  alreadyConfirmed: boolean
}
