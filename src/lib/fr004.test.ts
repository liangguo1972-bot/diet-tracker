import { describe, expect, it } from 'vitest'
import type { CookInventoryOption } from '../fr002-types'
import { createAdHocCookDraft, isAdHocCookDraftComplete, mergeAdHocInventory, toSaveCookWithoutRecipeInput } from './fr004'

const matched: CookInventoryOption = { inventoryId: 'lot-1', ingredientId: 'i-1', name: '番茄', quantity: 3, unit: '个', unitKind: 'count', gramsPerUnit: null, storage: '冷藏', expiresOn: null, hasTrustedGrams: false }
const unmatched: CookInventoryOption = { ...matched, inventoryId: 'lot-2', ingredientId: null, name: '小票占位', quantity: 1, unit: '包' }

describe('FR-004 draft', () => {
  it('requires one matched ingredient, valid stock use, and grams', () => {
    let draft = mergeAdHocInventory(createAdHocCookDraft('2026-07-16'), [matched, unmatched])
    draft = { ...draft, name: '随手一锅', items: draft.items.map((item) => ({ ...item, quantityUsed: 1, grams: item.ingredientId ? 150 : null })) }
    expect(isAdHocCookDraftComplete(draft)).toBe(true)
    expect(isAdHocCookDraftComplete({ ...draft, items: draft.items.map((item) => item.ingredientId ? { ...item, grams: null } : item) })).toBe(false)
    expect(isAdHocCookDraftComplete({ ...draft, items: draft.items.filter((item) => !item.ingredientId) })).toBe(false)
  })

  it('keeps unmatched stock out of nutrition and recipe items', () => {
    let draft = mergeAdHocInventory(createAdHocCookDraft('2026-07-16'), [matched, unmatched])
    draft = { ...draft, name: '随手一锅', items: draft.items.map((item) => ({ ...item, quantityUsed: 1, grams: item.ingredientId ? 150 : null })) }
    const input = toSaveCookWithoutRecipeInput(draft)
    expect(input.items).toHaveLength(1)
    expect(input.items[0].grams).toBe(150)
    expect(input.unmatchedItems).toEqual([{ inventoryId: 'lot-2', quantityUsed: 1, unit: '包', note: '' }])
  })

  it('preserves entered values when the selected inventory list is reopened', () => {
    const draft = mergeAdHocInventory(createAdHocCookDraft('2026-07-16'), [matched])
    const edited = { ...draft, items: [{ ...draft.items[0], quantityUsed: 0.5, grams: 90 }] }
    expect(mergeAdHocInventory(edited, [matched]).items[0]).toMatchObject({ quantityUsed: 0.5, grams: 90 })
  })
})
