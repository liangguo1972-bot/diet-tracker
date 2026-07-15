import { describe, expect, it } from 'vitest'
import { parseConfirmReceipt, parseReceiptCreated, parseReceiptImport, parseReceiptImports } from './receipts'

describe('FR-001 response parsing', () => {
  it('keeps real matched, possible, unmatched and ignored states', () => {
    const result = parseReceiptImport({
      receiptImportId: 'receipt-1', status: 'ready_for_review', fileName: 'very-long-receipt-name.jpg', contentType: 'image/jpeg', storagePath: 'user/receipt/source.jpg', merchantName: null, purchasedOn: null, errorCode: null,
      items: [
        { receiptItemId: 'a', position: 0, rawName: '牛奶', rawPrice: 6.5, ingredientId: 'i-1', ingredientName: '牛奶', matchStatus: 'matched', confirmedName: '牛奶', confirmedQuantity: 1, confirmedUnit: '盒', storage: '冷藏', action: 'add_to_inventory' },
        { receiptItemId: 'b', position: 1, rawName: 'TOMATO', ingredientId: 'i-2', ingredientName: '番茄', matchStatus: 'possible_match', confirmedName: 'TOMATO', confirmedQuantity: 2, confirmedUnit: '个', storage: '', action: 'add_to_inventory' },
        { receiptItemId: 'c', position: 2, rawName: 'LONG UNKNOWN PRODUCT NAME', ingredientId: null, ingredientName: null, matchStatus: 'unmatched', confirmedName: 'LONG UNKNOWN PRODUCT NAME', confirmedQuantity: 1.5, confirmedUnit: '袋', storage: '冷藏', action: 'add_to_inventory' },
        { receiptItemId: 'd', position: 3, rawName: 'BAG FEE', ingredientId: null, ingredientName: null, matchStatus: 'ignored', confirmedName: null, confirmedQuantity: null, confirmedUnit: null, storage: null, action: 'ignore' },
      ],
    })
    expect(result.items.map((item) => item.matchStatus)).toEqual(['matched', 'possible_match', 'unmatched', 'ignored'])
    expect(result.items[0].rawPrice).toBe(6.5)
    expect(result.items[2]).toMatchObject({ confirmedQuantity: 1.5, ingredientId: null })
    expect(result.items[3].action).toBe('ignore')
  })

  it('keeps duplicate create and idempotent confirm semantics', () => {
    expect(parseReceiptCreated({ receiptImportId: 'r', storagePath: 'p', status: 'uploaded', reused: true }).reused).toBe(true)
    expect(parseConfirmReceipt({ receiptImportId: 'r', status: 'confirmed', inventoryCount: 0, alreadyConfirmed: true })).toMatchObject({ alreadyConfirmed: true, inventoryCount: 0 })
  })

  it('keeps OCR_NOT_CONFIGURED without inventing item rows', () => {
    const result = parseReceiptImport({ receiptImportId: 'r', status: 'failed', fileName: 'receipt.jpg', contentType: 'image/jpeg', storagePath: 'p', merchantName: null, purchasedOn: null, errorCode: 'OCR_NOT_CONFIGURED', items: [] })
    expect(result.errorCode).toBe('OCR_NOT_CONFIGURED')
    expect(result.items).toEqual([])
  })

  it('parses real recent imports without sample fallbacks', () => {
    const result = parseReceiptImports([{ receiptImportId: 'r', status: 'failed', fileName: 'receipt.jpg', merchantName: null, purchasedOn: null, errorCode: 'OCR_NOT_CONFIGURED', createdAt: '2026-07-14T12:00:00Z', confirmedAt: null }])
    expect(result).toEqual([expect.objectContaining({ receiptImportId: 'r', status: 'failed', errorCode: 'OCR_NOT_CONFIGURED' })])
  })
})
