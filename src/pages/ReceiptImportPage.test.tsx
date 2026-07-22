// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileSha256, receiptAdapter } from '../data/receipts'
import type { ReceiptImport, ReceiptImportSummary } from '../receipt-types'
import { ReceiptImportPage } from './ReceiptImportPage'

vi.mock('../data/receipts', () => ({
  fileSha256: vi.fn(),
  receiptAdapter: { create: vi.fn(), upload: vi.fn(), process: vi.fn(), get: vi.fn(), list: vi.fn() },
}))

const created = { receiptImportId: 'receipt-1', storagePath: 'user/receipt-1/source.png', status: 'uploaded' as const, reused: false }
const uploadedReceipt: ReceiptImport = { receiptImportId: 'receipt-1', status: 'uploaded', fileName: 'IMG_4067.png', contentType: 'image/png', storagePath: created.storagePath, merchantName: null, purchasedOn: null, errorCode: null, quantityReviewStatus: 'not_applicable', quantityReviewParser: null, quantityReviewEvidence: {}, items: [] }
const summary: ReceiptImportSummary = { receiptImportId: 'receipt-1', status: 'uploaded', fileName: 'IMG_4067.png', merchantName: null, purchasedOn: null, errorCode: null, createdAt: '2026-07-15T12:00:00Z', confirmedAt: null }

function renderPage() {
  const props: React.ComponentProps<typeof ReceiptImportPage> = { onBack: vi.fn(), onReview: vi.fn(), onInventory: vi.fn(), onTab: vi.fn(), onSessionExpired: vi.fn() }
  const result = render(<ReceiptImportPage {...props} />)
  return { ...result, props }
}

function uploadFile(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File([new Uint8Array(128)], 'IMG_4067.png', { type: 'image/png' })
  Object.defineProperty(file, 'size', { value: Math.floor(9.49 * 1024 * 1024) })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('ReceiptImportPage failure recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fileSha256).mockResolvedValue('a'.repeat(64))
    vi.mocked(receiptAdapter.create).mockResolvedValue(created)
    vi.mocked(receiptAdapter.upload).mockResolvedValue()
    vi.mocked(receiptAdapter.list).mockResolvedValueOnce([]).mockResolvedValue([summary])
    vi.mocked(receiptAdapter.get).mockResolvedValue(uploadedReceipt)
  })
  afterEach(cleanup)

  it('shows the real import and hides the English Edge Function error after a request failure', async () => {
    vi.mocked(receiptAdapter.process).mockRejectedValue(new Error('Failed to send a request to the Edge Function'))
    const { container } = renderPage()
    uploadFile(container)

    expect(await screen.findByText('暂时无法连接识别服务，照片已保留，稍后可重试。')).toBeTruthy()
    expect(screen.queryByText(/Failed to send a request/)).toBeNull()
    await waitFor(() => expect(screen.getAllByText('IMG_4067.png')).toHaveLength(2))
    expect(receiptAdapter.process).toHaveBeenCalledWith('receipt-1', expect.any(File))
    expect(screen.queryByText('还没有导入记录')).toBeNull()
    expect(receiptAdapter.get).toHaveBeenCalledWith('receipt-1')
  })

  it('shows OCR_NOT_CONFIGURED and never opens an empty confirmation draft', async () => {
    const failed: ReceiptImport = { ...uploadedReceipt, status: 'failed', errorCode: 'OCR_NOT_CONFIGURED' }
    vi.mocked(receiptAdapter.process).mockResolvedValue(failed)
    vi.mocked(receiptAdapter.list).mockResolvedValue([{ ...summary, status: 'failed', errorCode: 'OCR_NOT_CONFIGURED' }])
    const { container, props } = renderPage()
    uploadFile(container)

    expect(await screen.findByText('识别服务尚未配置，照片已保留，稍后可重试。')).toBeTruthy()
    expect(props.onReview).not.toHaveBeenCalled()
  })

  it('requires real receipt items before opening confirmation', async () => {
    vi.mocked(receiptAdapter.process).mockResolvedValue({ ...uploadedReceipt, status: 'ready_for_review', items: [] })
    const { container, props } = renderPage()
    uploadFile(container)

    expect(await screen.findByText('没有识别到可确认的商品，照片已保留，稍后可重试。')).toBeTruthy()
    expect(props.onReview).not.toHaveBeenCalled()
  })
})
