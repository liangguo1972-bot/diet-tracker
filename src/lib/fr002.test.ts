import { describe, expect, it } from 'vitest'
import type { CookPreparation, DrawnRecipe, ShoppingListData } from '../fr002-types'
import { createCookDraft, createDrawnPlan, createShoppingDraft, isCookDraftComplete, purchaseAgeLabel, setCookInventory, startOfWeek, toSaveCookInput } from './fr002'

const preparation: CookPreparation = {
  recipe: { id: 'recipe-1', name: '测试食谱', servings: 2, note: null },
  planItemId: 'plan-item-1',
  items: [
    { ingredientId: 'ingredient-g', name: '牛肉', referenceGrams: 200, availableGrams: 500, availabilityStatus: 'ready', inventories: [{ inventoryId: 'lot-g', quantity: 500, unit: 'g', unitKind: 'weight', gramsPerUnit: 1, storage: '冷冻', expiresOn: null, hasTrustedGrams: true }] },
    { ingredientId: 'ingredient-box', name: '泡菜', referenceGrams: 100, availableGrams: 0, availabilityStatus: 'unit_confirmation_required', inventories: [{ inventoryId: 'lot-box', quantity: 1, unit: '盒', unitKind: 'container', gramsPerUnit: null, storage: '冷藏', expiresOn: null, hasTrustedGrams: false }] },
  ],
}

describe('FR-002 drafts', () => {
  it('uses recipe grams only for g inventory and never converts a box', () => {
    const draft = createCookDraft(preparation, '2026-07-13')
    expect(draft.ingredients[0].usages[0].quantityUsed).toBe(200)
    expect(draft.ingredients[1].usages[0].quantityUsed).toBeNull()
    expect(isCookDraftComplete(draft)).toBe(false)
  })

  it('keeps the selected inventory unit in the save payload', () => {
    let draft = createCookDraft(preparation, '2026-07-13')
    draft = setCookInventory({ ...draft, ingredients: draft.ingredients.map((item) => item.ingredientId === 'ingredient-box' ? { ...item, usages: [] } : item) }, 'ingredient-box', {
      inventoryId: 'lot-box', ingredientId: 'ingredient-box', name: '泡菜', quantity: 1, unit: '盒', unitKind: 'container', gramsPerUnit: null, storage: '冷藏', expiresOn: null, hasTrustedGrams: false,
    })
    draft.ingredients[1].usages[0].quantityUsed = 0.5
    const input = toSaveCookInput(draft)
    expect(input.items[1]).toMatchObject({ quantityUsed: 0.5, unit: '盒' })
  })

  it('sends unmatched receipt stock separately without adding nutrition identity', () => {
    let draft = createCookDraft(preparation, '2026-07-13')
    draft = setCookInventory({ ...draft, ingredients: draft.ingredients.map((item) => item.ingredientId === 'ingredient-box' ? { ...item, usages: [] } : item) }, 'ingredient-box', {
      inventoryId: 'unmatched-lot', ingredientId: null, name: 'KIMCHI 12OZ', quantity: 1, unit: '盒', unitKind: 'container', gramsPerUnit: null, storage: '冷藏', expiresOn: null, hasTrustedGrams: false,
    })
    draft.ingredients[1].usages[0].quantityUsed = 0.5
    const input = toSaveCookInput(draft)
    expect(input.items).toHaveLength(1)
    expect(input.unmatchedItems).toEqual([{ inventoryId: 'unmatched-lot', displayName: 'KIMCHI 12OZ', quantityUsed: 0.5, unit: '盒', note: '' }])
  })

  it('places drawn recipes on the Figma four-day rhythm', () => {
    const recipes: DrawnRecipe[] = [0, 1, 2, 3].map((index) => ({ recipeId: `r-${index}`, name: `食谱${index}`, servings: 2, status: 'candidate' }))
    expect(createDrawnPlan(recipes, '2026-07-13').map((item) => item.scheduledOn)).toEqual(['2026-07-13', '2026-07-15', '2026-07-17', '2026-07-19'])
    expect(startOfWeek('2026-07-19')).toBe('2026-07-13')
  })

  it('calculates purchase age by local calendar day and handles missing dates', () => {
    const today = new Date(2026, 6, 22, 23, 30)
    expect(purchaseAgeLabel('2026-07-22', today)).toBe('今天购入')
    expect(purchaseAgeLabel('2026-07-21', today)).toBe('1 天前购入')
    expect(purchaseAgeLabel('2026-07-17', today)).toBe('5 天前购入')
    expect(purchaseAgeLabel(null, today)).toBe('购入日期未知')
  })

  it('defaults real gram demand to g and does not create a purchase for fully covered items', () => {
    const list: ShoppingListData = {
      id: 'list-1', weeklyPlanId: 'plan-1', status: 'generated', createdAt: '', completedAt: null,
      items: [
        { id: 'line-1', ingredientId: 'i-1', name: '牛肉', requiredGrams: 500, inventoryCoveredGrams: 100, toPurchaseGrams: 400, purchaseQuantity: null, purchaseUnit: null, completedQuantity: null, completedUnit: null, storage: null, status: 'pending' },
        { id: 'line-2', ingredientId: 'i-2', name: '盐', requiredGrams: 5, inventoryCoveredGrams: 5, toPurchaseGrams: 0, purchaseQuantity: null, purchaseUnit: null, completedQuantity: null, completedUnit: null, storage: null, status: 'pending' },
      ],
    }
    const draft = createShoppingDraft(list, '2026-07-13')
    expect(draft[0]).toMatchObject({ quantity: 400, unit: 'g' })
    expect(draft[1].quantity).toBeNull()
  })
})
