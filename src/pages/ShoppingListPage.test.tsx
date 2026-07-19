// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    },
  }
})

const list: ShoppingListData = {
  id: 'list-1', weeklyPlanId: 'plan-1', status: 'generated', createdAt: '2026-07-13T12:00:00Z', completedAt: null,
  items: [
    { id: 'line-1', ingredientId: 'ingredient-1', name: '牛肉', requiredGrams: 500, inventoryCoveredGrams: 100, toPurchaseGrams: 400, purchaseQuantity: null, purchaseUnit: null, completedQuantity: null, completedUnit: null, storage: null, status: 'pending' },
    { id: 'line-2', ingredientId: 'ingredient-2', name: '鸡蛋', requiredGrams: 200, inventoryCoveredGrams: 200, toPurchaseGrams: 0, purchaseQuantity: null, purchaseUnit: null, completedQuantity: null, completedUnit: null, storage: null, status: 'pending' },
  ],
}

const renderPage = () => {
  const props: React.ComponentProps<typeof ShoppingListPage> = {
    planId: 'plan-1', initialList: list, onBack: vi.fn(), onTab: vi.fn(), onSessionExpired: vi.fn(),
  }
  render(<ShoppingListPage {...props} />)
  return props
}

describe('ShoppingListPage reference list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fr002Adapter.getShoppingList).mockResolvedValue(list)
  })
  afterEach(cleanup)

  it('shows each suggestion once without purchase or inventory fields', async () => {
    renderPage()
    expect(await screen.findByText('建议 400g')).toBeTruthy()
    expect(screen.getAllByText('建议 400g')).toHaveLength(1)
    expect(screen.getByText('库存已覆盖')).toBeTruthy()
    expect(screen.queryByText('购买数量')).toBeNull()
    expect(screen.queryByText('量词')).toBeNull()
    expect(screen.queryByText('存放位置')).toBeNull()
    expect(screen.queryByText('购买日期')).toBeNull()
    expect(screen.queryByText('到期日期')).toBeNull()
    expect(screen.queryByRole('button', { name: '完成采购并写入库存' })).toBeNull()
    expect(document.querySelector('.shopping-list-content')).toBeTruthy()
    expect(document.querySelector('.bottom-nav')).toBeTruthy()
    expect(document.querySelector('.sticky-actions')).toBeNull()
    expect(fr002Adapter.completePurchase).not.toHaveBeenCalled()
  })

  it('allows local checking without writing inventory', async () => {
    renderPage()
    const checkbox = await screen.findByRole('checkbox', { name: '牛肉已购买' })
    expect(screen.getByText('0 / 1 已勾选')).toBeTruthy()
    fireEvent.click(checkbox)
    expect(screen.getByText('1 / 1 已勾选')).toBeTruthy()
    expect(screen.getByText('已勾选')).toBeTruthy()
    expect(fr002Adapter.completePurchase).not.toHaveBeenCalled()
  })

  it('routes real inventory work to the kitchen', async () => {
    const props = renderPage()
    const button = await screen.findByRole('button', { name: '去厨房导入小票' })
    fireEvent.click(button)
    expect(props.onTab).toHaveBeenCalledWith('厨房')
  })
})
