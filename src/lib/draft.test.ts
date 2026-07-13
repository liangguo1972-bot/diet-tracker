import { describe, expect, it } from 'vitest'
import type { SelectableItem, TodayMeal } from '../types'
import { addDraftItem, createDraftFromMeal, createInitialDraft, removeDraftItem, setDraftItemServings } from './draft'

const cook: SelectableItem = {
  sourceType: 'cook_session', sourceId: 'cook-1', name: '长名称成品', subtitle: '做好于 2026-07-12',
  servingGrams: null, availableServings: 0.5,
  nutrition: { kcal: 500, protein: 40, carb: 30, fat: 20 }, estimated: false, lastUsedOn: null,
}

describe('meal draft', () => {
  it('does not exceed available cook servings', () => {
    const added = addDraftItem(createInitialDraft('2026-07-12'), cook)
    expect(added.items[0].servings).toBe(0.5)
    expect(setDraftItemServings(added, 0, 3).items[0].servings).toBe(0.5)
  })

  it('supports small decimal servings and removal', () => {
    const added = addDraftItem(createInitialDraft('2026-07-12'), { ...cook, availableServings: 2 })
    const changed = setDraftItemServings(added, 0, 0.125)
    expect(changed.items[0].servings).toBe(0.13)
    expect(removeDraftItem(changed, 0).items).toEqual([])
  })

  it('creates an editable draft with per-serving nutrition', () => {
    const meal: TodayMeal = {
      id: 'meal-1', mealType: '午餐', note: '备注', nutrition: { kcal: 400, protein: 20, carb: 30, fat: 10 },
      items: [{ id: 'item-1', sourceType: 'ingredient', sourceId: 'ingredient-1', name: '单品', servings: 2, nutrition: { kcal: 400, protein: 20, carb: 30, fat: 10 }, estimated: false }],
    }
    const draft = createDraftFromMeal(meal, '2026-07-12')
    expect(draft.mealId).toBe('meal-1')
    expect(draft.note).toBe('备注')
    expect(draft.items[0].nutrition.kcal).toBe(200)
  })
})
