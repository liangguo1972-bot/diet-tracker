// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Fr002Error } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { CookRecipeConfirmation } from '../fr002-types'
import { CookRecipeConfirmationPage } from './CookRecipeConfirmationPage'

vi.mock('../data/fr002', async (importOriginal) => { const original = await importOriginal<typeof import('../data/fr002')>(); return { ...original, fr002Adapter: { ...original.fr002Adapter, getCookRecipeConfirmation: vi.fn(), createRecipeFromCookSession: vi.fn(), getOperationResult: vi.fn() } } })

const confirmation: CookRecipeConfirmation = { cookSessionId: 'cook-1', sourceType: 'without_recipe', recipeConfirmationStatus: 'pending', name: '番茄一锅', cookedOn: '2026-07-16', totalServings: 2, recipeId: null, recipeName: null, candidateId: null, items: [{ ingredientId: 'i-1', ingredientName: '番茄', grams: 220, isVerified: true }], unmatchedItems: [{ inventoryId: 'lot-2', name: '香料包', quantityUsed: 0.5, unit: '包' }] }

describe('CookRecipeConfirmationPage', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'key-1') }); vi.mocked(fr002Adapter.getCookRecipeConfirmation).mockResolvedValue(confirmation) })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })
  it('keeps content and allows a new operation key after a duplicate name', async () => {
    vi.mocked(fr002Adapter.createRecipeFromCookSession).mockRejectedValueOnce(new Fr002Error('DUPLICATE_RECIPE_NAME'))
    render(<CookRecipeConfirmationPage cookSessionId="cook-1" onBack={vi.fn()} onConfirmed={vi.fn()} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    expect(await screen.findByDisplayValue('番茄一锅')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认并加入候选菜池' }))
    expect(await screen.findByText(/已有同名菜谱/)).toBeTruthy()
    fireEvent.change(screen.getByDisplayValue('番茄一锅'), { target: { value: '番茄随手锅' } })
    expect(screen.getByDisplayValue('番茄随手锅')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认并加入候选菜池' }))
    await act(async () => undefined)
    expect(fr002Adapter.createRecipeFromCookSession).toHaveBeenCalledTimes(2)
    expect(fr002Adapter.createRecipeFromCookSession).toHaveBeenLastCalledWith('cook-1', '番茄随手锅', 'key-1')
  })
  it('shows unmatched inventory as excluded from the recipe', async () => {
    render(<CookRecipeConfirmationPage cookSessionId="cook-1" onBack={vi.fn()} onConfirmed={vi.fn()} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    expect(await screen.findByText('库存占位，不进入菜谱')).toBeTruthy()
    expect(screen.getByText('220g')).toBeTruthy()
  })
})
