// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fr002Adapter } from '../data/fr002'
import type { AdHocCookDraft, CookDraft, CookInventoryOption } from '../fr002-types'
import { AdHocCookPage } from './AdHocCookPage'
import { AdHocInventoryPickerPage } from './AdHocInventoryPickerPage'
import { CookInventoryPickerPage } from './CookInventoryPickerPage'
import { CookPage } from './CookPage'

vi.mock('../data/fr002', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data/fr002')>()
  return { ...original, fr002Adapter: { ...original.fr002Adapter, searchCookInventory: vi.fn() } }
})

const inventory: CookInventoryOption[] = [
  { inventoryId: 'lot-1', ingredientId: 'ingredient-1', name: '冷冻牛肉', quantity: 2, unit: '盒', unitKind: 'count', gramsPerUnit: null, storage: '冷冻', expiresOn: null, hasTrustedGrams: false },
  { inventoryId: 'lot-2', ingredientId: 'ingredient-2', name: '番茄', quantity: 4, unit: '个', unitKind: 'count', gramsPerUnit: null, storage: '冷藏', expiresOn: null, hasTrustedGrams: false },
]

const cookDraft: CookDraft = {
  recipeId: 'recipe-1', recipeName: '炖牛肉', recipeServings: 2, planItemId: null,
  cookedOn: '2026-07-22', name: '炖牛肉', totalServings: 2, note: '',
  ingredients: [{ ingredientId: 'ingredient-1', name: '牛肉', referenceGrams: 400, availableGrams: 500, availabilityStatus: 'ready', usages: [{ ...inventory[0], quantityUsed: 1, note: '' }] }],
}

const adHocDraft: AdHocCookDraft = {
  name: '随手一锅', cookedOn: '2026-07-22', totalServings: 2, note: '',
  items: [{ ...inventory[0], quantityUsed: 1, grams: 300, note: '' }],
}

describe('cook flow visual scoping', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(fr002Adapter.searchCookInventory).mockResolvedValue(inventory) })
  afterEach(cleanup)

  it('keeps the recipe cook and single-select inventory screens in their own scope', async () => {
    const first = render(<CookPage draft={cookDraft} loading={false} error={null} onRetry={vi.fn()} onDraft={vi.fn()} onPick={vi.fn()} onBack={vi.fn()} onContinue={vi.fn()} onTab={vi.fn()} />)
    expect(first.container.querySelector('main')?.classList.contains('cook-prep-page')).toBe(true)
    expect(first.container.querySelector('.cook-summary')).toBeTruthy()
    first.unmount()

    const second = render(<CookInventoryPickerPage ingredientId="ingredient-1" ingredientName="牛肉" selectedIds={['lot-1']} onBack={vi.fn()} onSelect={vi.fn()} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    expect(second.container.querySelector('main')?.classList.contains('cook-recipe-picker-page')).toBe(true)
    const selectedRow = (await screen.findByText('冷冻牛肉')).closest('button')
    expect(selectedRow?.classList.contains('selected-row')).toBe(true)
    expect((selectedRow as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the ad-hoc cook and multi-select inventory interaction intact', async () => {
    const first = render(<AdHocCookPage draft={adHocDraft} onDraft={vi.fn()} onPick={vi.fn()} onBack={vi.fn()} onContinue={vi.fn()} onTab={vi.fn()} />)
    expect(first.container.querySelector('main')?.classList.contains('adhoc-cook-page')).toBe(true)
    expect(first.container.querySelector('.cook-summary')).toBeTruthy()
    first.unmount()

    const onDone = vi.fn()
    const second = render(<AdHocInventoryPickerPage initial={[inventory[0]]} onBack={vi.fn()} onDone={onDone} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    expect(second.container.querySelector('main')?.classList.contains('adhoc-picker-page')).toBe(true)
    await screen.findByText('番茄')
    expect(second.container.querySelector('button.selected-row')).toBeTruthy()
    fireEvent.click(screen.getByText('番茄').closest('button') as HTMLButtonElement)
    fireEvent.click(screen.getByRole('button', { name: '添加后回到做饭页' }))
    expect(onDone).toHaveBeenCalledWith(inventory)
  })
})
