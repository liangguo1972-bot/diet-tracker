// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Fr002Error } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { ShoppingListData } from '../fr002-types'
import { ShoppingListPage } from './ShoppingListPage'

vi.mock('../data/fr002', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data/fr002')>()
  return {
    ...original,
    fr002Adapter: {
      ...original.fr002Adapter,
      getShoppingList: vi.fn(),
      completePurchase: vi.fn(),
      getOperationResult: vi.fn(),
    },
  }
})

const list: ShoppingListData = {
  id: 'list-1', weeklyPlanId: 'plan-1', status: 'generated', createdAt: '2026-07-13T12:00:00Z', completedAt: null,
  items: [{ id: 'line-1', ingredientId: 'ingredient-1', name: '牛肉', requiredGrams: 500, inventoryCoveredGrams: 100, toPurchaseGrams: 400, purchaseQuantity: null, purchaseUnit: null, completedQuantity: null, completedUnit: null, storage: null, status: 'pending' }],
}

const completed: ShoppingListData = {
  ...list,
  status: 'completed',
  completedAt: '2026-07-13T13:00:00Z',
  items: [{ ...list.items[0], purchaseQuantity: 400, purchaseUnit: 'g', completedQuantity: 400, completedUnit: 'g', storage: '冷藏', status: 'completed' }],
}

const renderPage = () => {
  const props: React.ComponentProps<typeof ShoppingListPage> = {
    planId: 'plan-1', initialList: list, onBack: vi.fn(), onDone: vi.fn(), onTab: vi.fn(), onSessionExpired: vi.fn(),
  }
  render(<ShoppingListPage {...props} />)
  return props
}

describe('ShoppingListPage idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '22222222-2222-4222-8222-222222222222') })
    vi.mocked(fr002Adapter.getShoppingList).mockResolvedValue(list)
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('keeps purchase input and checks the original key after an unknown network result', async () => {
    vi.mocked(fr002Adapter.completePurchase).mockRejectedValueOnce(new Fr002Error('NETWORK_UNKNOWN'))
    vi.mocked(fr002Adapter.getOperationResult).mockResolvedValueOnce({ status: 'succeeded', response: completed })
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '完成采购并写入库存' }))
    expect(await screen.findByText(/服务端结果暂时未知/)).toBeTruthy()
    expect(screen.getByDisplayValue('400')).toBeTruthy()
    expect(fr002Adapter.completePurchase).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '确认服务端结果' }))
    await act(async () => undefined)
    expect(fr002Adapter.getOperationResult).toHaveBeenCalledWith('complete_purchase', '22222222-2222-4222-8222-222222222222', expect.any(Function))
    expect(await screen.findByText('采购已完成')).toBeTruthy()
  })
})
