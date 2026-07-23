// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Fr002Error } from '../data/errors'
import { receiptAdapter } from '../data/receipts'
import type { ReceiptImport } from '../receipt-types'
import { ReceiptReviewPage } from './ReceiptReviewPage'

vi.mock('../data/receipts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data/receipts')>()
  return { ...original, receiptAdapter: { ...original.receiptAdapter, get: vi.fn(), update: vi.fn(), confirm: vi.fn(), searchIngredients: vi.fn() } }
})

const receipt: ReceiptImport = {
  receiptImportId: 'receipt-1', status: 'ready_for_review', fileName: 'receipt.jpg', contentType: 'image/jpeg', storagePath: 'p', merchantName: null, purchasedOn: null, errorCode: null,
  quantityReviewStatus: 'not_applicable', quantityReviewParser: null, quantityReviewEvidence: {},
  items: [{ receiptItemId: 'item-1', position: 0, rawName: 'A VERY LONG UNMATCHED PRODUCT NAME', rawQuantity: 1, rawUnit: '袋', rawPrice: 5.99, ingredientId: null, ingredientName: null, matchStatus: 'unmatched', matchConfidence: null, confirmedName: 'A VERY LONG UNMATCHED PRODUCT NAME', confirmedQuantity: 1, confirmedUnit: '袋', storage: '常温', action: 'add_to_inventory', quantitySource: 'fallback', quantityNeedsConfirmation: false, quantityEvidence: {} }],
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
    await screen.findByDisplayValue('A VERY LONG UNMATCHED PRODUCT NAME')
    fireEvent.click(screen.getByRole('button', { name: '忽略此项' }))
    await waitFor(() => expect((screen.getByRole('button', { name: /确认入库/ }) as HTMLButtonElement).disabled).toBe(true))
    expect(screen.getByRole('button', { name: '恢复此项' })).toBeTruthy()
  })

  it('allows confirmation without a unit and uses the backend safe default label', async () => {
    vi.mocked(receiptAdapter.get).mockResolvedValue({ ...receipt, items: [{ ...receipt.items[0], rawQuantity: 5.99, rawUnit: null, rawPrice: 5.99, confirmedQuantity: 1, confirmedUnit: '' }] })
    render(<ReceiptReviewPage receiptImportId="receipt-1" onBack={vi.fn()} onConfirmed={vi.fn()} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    expect(await screen.findByText('件')).toBeTruthy()
    expect((screen.getByRole('button', { name: /确认入库/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows non-blocking receipt and line quantity review guidance', async () => {
    vi.mocked(receiptAdapter.get).mockResolvedValue({
      ...receipt,
      quantityReviewStatus: 'needs_review',
      quantityReviewParser: 'whole_foods_v1',
      quantityReviewEvidence: { netSalesVerified: true, soldItemsVerified: true, needsConfirmationItemCount: 1 },
      items: [{ ...receipt.items[0], confirmedQuantity: 1, confirmedUnit: '件', quantityNeedsConfirmation: true }],
    })
    render(<ReceiptReviewPage receiptImportId="receipt-1" onBack={vi.fn()} onConfirmed={vi.fn()} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    expect(await screen.findByText(/合计与商品件数已核对/)).toBeTruthy()
    expect(screen.getByText(/还有 1 项数量需要确认/)).toBeTruthy()
    expect(screen.getByText('请确认数量')).toBeTruthy()
    expect(screen.getByText('估')).toBeTruthy()
    expect((screen.getByRole('button', { name: /确认入库/ }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.change(screen.getByRole('spinbutton', { name: '数量' }), { target: { value: '2' } })
    await waitFor(() => expect(screen.queryByText('请确认数量')).toBeNull())
  })

  it('shows the purchase date as read-only and preserves the receipt original name', async () => {
    vi.mocked(receiptAdapter.get).mockResolvedValue({ ...receipt, purchasedOn: '2026-07-20' })
    render(<ReceiptReviewPage receiptImportId="receipt-1" onBack={vi.fn()} onConfirmed={vi.fn()} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    expect(await screen.findByText('7月20日')).toBeTruthy()
    expect(screen.getByText('小票原文')).toBeTruthy()
    expect(screen.getByText('A VERY LONG UNMATCHED PRODUCT NAME')).toBeTruthy()
    expect(screen.queryByText('点击修改')).toBeNull()
    expect(screen.queryByRole('button', { name: /7月20日/ })).toBeNull()
  })

  it('shows a verified Whole Foods quantity without converting its unit', async () => {
    vi.mocked(receiptAdapter.get).mockResolvedValue({ ...receipt, items: [{ ...receipt.items[0], confirmedQuantity: 2.24, confirmedUnit: 'lb', quantitySource: 'whole_foods_verified', quantityNeedsConfirmation: false }] })
    render(<ReceiptReviewPage receiptImportId="receipt-1" onBack={vi.fn()} onConfirmed={vi.fn()} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    expect(await screen.findByDisplayValue('2.24')).toBeTruthy()
    expect(screen.getByText('lb')).toBeTruthy()
    expect(screen.getByText('数量已核对')).toBeTruthy()
    expect(screen.queryByText('估')).toBeNull()
  })

  it('allows a backend-prefilled conservative name to confirm without manual editing', async () => {
    vi.mocked(receiptAdapter.update).mockResolvedValue(receipt)
    vi.mocked(receiptAdapter.confirm).mockResolvedValue({ receiptImportId: 'receipt-1', status: 'confirmed', inventoryCount: 1, alreadyConfirmed: false })
    render(<ReceiptReviewPage receiptImportId="receipt-1" onBack={vi.fn()} onConfirmed={vi.fn()} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    await screen.findByDisplayValue('A VERY LONG UNMATCHED PRODUCT NAME')
    const button = screen.getByRole('button', { name: /确认入库/ }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(receiptAdapter.update).toHaveBeenCalledWith('receipt-1', expect.arrayContaining([expect.objectContaining({ confirmedName: 'A VERY LONG UNMATCHED PRODUCT NAME' })])))
  })

  it('searches real ingredients and stores the selected ingredient id', async () => {
    vi.mocked(receiptAdapter.searchIngredients).mockResolvedValue([{ ingredientId: 'ingredient-1', name: '香蕉', category: '水果', packageSpec: null, storageGuidance: null, isVerified: true }])
    vi.mocked(receiptAdapter.update).mockResolvedValue(receipt)
    vi.mocked(receiptAdapter.confirm).mockResolvedValue({ receiptImportId: 'receipt-1', status: 'confirmed', inventoryCount: 1, alreadyConfirmed: false })
    render(<ReceiptReviewPage receiptImportId="receipt-1" onBack={vi.fn()} onConfirmed={vi.fn()} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    await screen.findByDisplayValue('A VERY LONG UNMATCHED PRODUCT NAME')
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(receiptAdapter.searchIngredients).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索已有食材' }), { target: { value: '香蕉' } })
    fireEvent.click(screen.getAllByRole('button', { name: '搜索' }).at(-1)!)
    await waitFor(() => expect(receiptAdapter.searchIngredients).toHaveBeenCalledWith('香蕉'))
    expect(await screen.findByText('香蕉')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /香蕉/ }))
    expect(screen.getByText('已选择：香蕉')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /确认入库/ }))
    await waitFor(() => expect(receiptAdapter.update).toHaveBeenCalledWith('receipt-1', expect.arrayContaining([expect.objectContaining({ receiptItemId: 'item-1', ingredientId: 'ingredient-1' })])))
  })

  it('does not search with an empty query and explains the inventory placeholder fallback', async () => {
    vi.mocked(receiptAdapter.searchIngredients).mockResolvedValue([])
    render(<ReceiptReviewPage receiptImportId="receipt-1" onBack={vi.fn()} onConfirmed={vi.fn()} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    await screen.findByDisplayValue('A VERY LONG UNMATCHED PRODUCT NAME')
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    fireEvent.change(screen.getByRole('textbox', { name: '搜索已有食材' }), { target: { value: '   ' } })
    expect((screen.getAllByRole('button', { name: '搜索' }).at(-1) as HTMLButtonElement).disabled).toBe(true)
    expect(receiptAdapter.searchIngredients).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索已有食材' }), { target: { value: '不存在食材' } })
    fireEvent.click(screen.getAllByRole('button', { name: '搜索' }).at(-1)!)
    expect(await screen.findByText('没有匹配，可保留为库存占位')).toBeTruthy()
  })

  it('keeps manual search available when the backend provides a suggestion', async () => {
    vi.mocked(receiptAdapter.get).mockResolvedValue({ ...receipt, items: [{ ...receipt.items[0], ingredientId: 'suggestion-1', ingredientName: '普通酸奶', matchStatus: 'possible_match' }] })
    vi.mocked(receiptAdapter.update).mockResolvedValue(receipt)
    vi.mocked(receiptAdapter.confirm).mockResolvedValue({ receiptImportId: 'receipt-1', status: 'confirmed', inventoryCount: 1, alreadyConfirmed: false })
    render(<ReceiptReviewPage receiptImportId="receipt-1" onBack={vi.fn()} onConfirmed={vi.fn()} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    await screen.findByDisplayValue('A VERY LONG UNMATCHED PRODUCT NAME')
    expect(screen.getByText('建议：普通酸奶')).toBeTruthy()
    expect(screen.getByRole('button', { name: '采用建议' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(screen.getByRole('textbox', { name: '搜索已有食材' })).toBeTruthy()
    expect(receiptAdapter.searchIngredients).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    fireEvent.click(screen.getByRole('button', { name: /确认入库/ }))
    await waitFor(() => expect(receiptAdapter.update).toHaveBeenCalledWith('receipt-1', expect.arrayContaining([expect.objectContaining({ ingredientId: null })])))
  })
})
