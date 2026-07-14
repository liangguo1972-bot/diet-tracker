// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Fr002Error } from '../data/errors'
import { receiptAdapter } from '../data/receipts'
import type { ReceiptImport } from '../receipt-types'
import { ReceiptReviewPage } from './ReceiptReviewPage'

vi.mock('../data/receipts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data/receipts')>()
  return { ...original, receiptAdapter: { ...original.receiptAdapter, get: vi.fn(), update: vi.fn(), confirm: vi.fn() } }
})

const receipt: ReceiptImport = {
  receiptImportId: 'receipt-1', status: 'ready_for_review', fileName: 'receipt.jpg', contentType: 'image/jpeg', storagePath: 'p', merchantName: null, purchasedOn: null, errorCode: null,
  items: [{ receiptItemId: 'item-1', position: 0, rawName: 'A VERY LONG UNMATCHED PRODUCT NAME', rawQuantity: 1, rawUnit: '袋', ingredientId: null, ingredientName: null, matchStatus: 'unmatched', matchConfidence: null, confirmedName: 'A VERY LONG UNMATCHED PRODUCT NAME', confirmedQuantity: 1, confirmedUnit: '袋', storage: '', action: 'add_to_inventory' }],
}

describe('ReceiptReviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(receiptAdapter.get).mockResolvedValue(receipt)
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '11111111-1111-4111-8111-111111111111') })
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('keeps all edits after confirm failure and blocks duplicate clicks', async () => {
    vi.mocked(receiptAdapter.update).mockResolvedValue(receipt)
    vi.mocked(receiptAdapter.confirm).mockRejectedValue(new Fr002Error('CONFLICT'))
    render(<ReceiptReviewPage receiptImportId="receipt-1" onBack={vi.fn()} onConfirmed={vi.fn()} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    const name = await screen.findByDisplayValue('A VERY LONG UNMATCHED PRODUCT NAME')
    fireEvent.change(name, { target: { value: '用户修正后的名称' } })
    const button = screen.getByRole('button', { name: /确认入库/ })
    fireEvent.click(button)
    fireEvent.click(button)
    await screen.findByText(/数据状态已经变化/)
    expect(screen.getByDisplayValue('用户修正后的名称')).toBeTruthy()
    expect(receiptAdapter.confirm).toHaveBeenCalledTimes(1)
    expect(receiptAdapter.update).toHaveBeenCalledWith('receipt-1', expect.arrayContaining([expect.objectContaining({ confirmedName: '用户修正后的名称', ingredientId: null })]))
  })

  it('allows an unmatched line to be ignored and requires at least one inventory item', async () => {
    render(<ReceiptReviewPage receiptImportId="receipt-1" onBack={vi.fn()} onConfirmed={vi.fn()} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    await screen.findByText('A VERY LONG UNMATCHED PRODUCT NAME')
    fireEvent.click(screen.getByRole('button', { name: '忽略此项' }))
    await waitFor(() => expect((screen.getByRole('button', { name: /确认入库/ }) as HTMLButtonElement).disabled).toBe(true))
    expect(screen.getByRole('button', { name: '恢复此项' })).toBeTruthy()
  })
})
