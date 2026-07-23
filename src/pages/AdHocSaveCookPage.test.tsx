// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Fr002Error } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { AdHocCookDraft, SavedCookWithoutRecipe } from '../fr002-types'
import { AdHocSaveCookPage } from './AdHocSaveCookPage'

vi.mock('../data/fr002', async (importOriginal) => { const original = await importOriginal<typeof import('../data/fr002')>(); return { ...original, fr002Adapter: { ...original.fr002Adapter, saveCookWithoutRecipe: vi.fn(), getOperationResult: vi.fn() } } })

const draft: AdHocCookDraft = { name: '番茄一锅', cookedOn: '2026-07-16', totalServings: 2, note: '保留的备注', items: [{ inventoryId: 'lot-1', ingredientId: 'i-1', name: '番茄', quantity: 3, unit: '个', unitKind: 'count', gramsPerUnit: null, storage: '冷藏', expiresOn: null, hasTrustedGrams: false, quantityUsed: 2, grams: 220, note: '' }] }
const saved: SavedCookWithoutRecipe = { cookSessionId: 'cook-1', name: draft.name, cookedOn: draft.cookedOn, totalServings: 2, sourceType: 'without_recipe', recipeConfirmationStatus: 'pending', nutrition: { kcal: 100, protein: 3, carb: 20, fat: 1, estimated: false } }

describe('AdHocSaveCookPage', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'key-1') }) })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })
  it('uses the original idempotency key after a network-unknown result', async () => {
    vi.mocked(fr002Adapter.saveCookWithoutRecipe).mockRejectedValueOnce(new Fr002Error('NETWORK_UNKNOWN'))
    vi.mocked(fr002Adapter.getOperationResult).mockResolvedValueOnce({ status: 'succeeded', response: saved })
    const onSaved = vi.fn()
    const view = render(<AdHocSaveCookPage draft={draft} onBack={vi.fn()} onSaved={onSaved} onTab={vi.fn()} onSessionExpired={vi.fn()} />)
    expect(view.container.querySelector('main')?.classList.contains('adhoc-save-page')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '保存成品并确认菜谱' }))
    expect(await screen.findByText(/草稿和本次操作编号已保留/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认服务端结果' }))
    await act(async () => undefined)
    expect(fr002Adapter.getOperationResult).toHaveBeenCalledWith('save_cook_without_recipe', 'key-1', expect.any(Function))
    expect(onSaved).toHaveBeenCalledWith(saved)
  })
})
