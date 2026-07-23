// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fr002Adapter } from '../data/fr002'
import type { InventoryLot } from '../fr002-types'
import { addDays, localDateKey } from '../lib/fr002'
import { InventoryPage } from './InventoryPage'

vi.mock('../data/fr002', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data/fr002')>()
  return { ...original, fr002Adapter: { ...original.fr002Adapter, listInventory: vi.fn() } }
})

const lot = (change: Partial<InventoryLot>): InventoryLot => ({
  id: 'lot-1', ingredientId: null, name: '保守可读名称', receiptRawName: 'RAW RECEIPT NAME', quantity: 1, unit: '件', unitKind: 'count', gramsPerUnit: null,
  storage: '冷藏', purchaseDate: localDateKey(), expiresOn: null, status: 'active', canAutoDeduct: true, hasTrustedGrams: false, ...change,
})

describe('InventoryPage', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('groups real display names and shows local calendar purchase age without a detail action', async () => {
    vi.mocked(fr002Adapter.listInventory).mockResolvedValue([
      lot({ id: 'today', name: '牛奶', quantity: 2, unit: '盒' }),
      lot({ id: 'yesterday', name: '黄桃', storage: '常温', purchaseDate: addDays(localDateKey(), -1), quantity: 2.24, unit: 'lb' }),
      lot({ id: 'old', name: '旧库存', status: 'depleted', quantity: 0 }),
    ])
    render(<InventoryPage refreshKey={0} notice={null} onReceiptImport={vi.fn()} onBack={vi.fn()} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    expect(await screen.findByText('牛奶')).toBeTruthy()
    expect(screen.getByText('今天购入')).toBeTruthy()
    expect(screen.getByText('1 天前购入')).toBeTruthy()
    expect(screen.getByText('2.24')).toBeTruthy()
    expect(screen.getByText('lb')).toBeTruthy()
    expect(screen.queryByText('RAW RECEIPT NAME')).toBeNull()
    expect(screen.queryByText('详情')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /已用尽 1 批/ }))
    expect(screen.getByText('旧库存')).toBeTruthy()
  })

  it('sorts and marks aged room-temperature inventory without reordering frozen inventory', async () => {
    vi.mocked(fr002Adapter.listInventory).mockResolvedValue([
      lot({ id: 'cold-2', name: '冷藏 2 天', purchaseDate: addDays(localDateKey(), -2) }),
      lot({ id: 'cold-6', name: '冷藏 6 天', purchaseDate: addDays(localDateKey(), -6) }),
      lot({ id: 'frozen-2', name: '冷冻 2 天', storage: '冷冻', purchaseDate: addDays(localDateKey(), -2) }),
      lot({ id: 'frozen-8', name: '冷冻 8 天', storage: '冷冻', purchaseDate: addDays(localDateKey(), -8) }),
    ])
    render(<InventoryPage refreshKey={0} notice={null} onReceiptImport={vi.fn()} onBack={vi.fn()} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    expect(await screen.findByText('冷藏 6 天')).toBeTruthy()

    const chilledSection = screen.getByText('冷藏').closest('section')
    const frozenSection = screen.getByText('冷冻').closest('section')
    const names = (section: Element | null) => Array.from(section?.querySelectorAll('.inventory-lot > span > b') ?? []).map((node) => node.textContent)

    expect(names(chilledSection)).toEqual(['冷藏 6 天', '冷藏 2 天'])
    expect(screen.getByText('6 天前购入').classList.contains('aged')).toBe(true)
    expect(names(frozenSection)).toEqual(['冷冻 2 天', '冷冻 8 天'])
    expect(screen.getByText('8 天前购入').classList.contains('aged')).toBe(false)
  })
})
