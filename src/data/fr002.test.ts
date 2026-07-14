import { describe, expect, it } from 'vitest'
import { parseCookPreparation, parseInventory, parseKitchenHome, parseSavedCook, parseShoppingList, parseWeeklyPlan } from './fr002'

describe('FR-002 response parsing', () => {
  it('keeps real empty kitchen states', () => {
    const result = parseKitchenHome({
      date: '2026-07-13',
      inventorySummary: { activeLots: 0, depletedLots: 0, expiringLots: 0 },
      weeklyPlan: null,
      readyCookSessions: [],
    })
    expect(result.weeklyPlan).toBeNull()
    expect(result.readyCookSessions).toEqual([])
    expect(result.inventorySummary.activeLots).toBe(0)
  })

  it('keeps inventory units separate from trusted grams', () => {
    const result = parseInventory([{
      id: 'inventory-1', ingredientId: 'ingredient-1', name: '牛奶', quantity: 0.5,
      unit: '盒', unitKind: 'container', gramsPerUnit: null, storage: '冷藏',
      purchaseDate: '2026-07-13', expiresOn: null, status: 'active', canAutoDeduct: true,
      hasTrustedGrams: false,
    }])
    expect(result[0].quantity).toBe(0.5)
    expect(result[0].unit).toBe('盒')
    expect(result[0].gramsPerUnit).toBeNull()
  })

  it('parses missing and unit-confirmation cook states without inventing inventory', () => {
    const result = parseCookPreparation({
      recipe: { id: 'recipe-1', name: '测试食谱', servings: 2, note: null },
      planItemId: null,
      items: [
        { ingredientId: 'i-1', name: '牛肉', referenceGrams: 200, availableGrams: 0, availabilityStatus: 'missing', inventories: [] },
        { ingredientId: 'i-2', name: '泡菜', referenceGrams: 100, availableGrams: 0, availabilityStatus: 'unit_confirmation_required', inventories: [{ inventoryId: 'lot-2', quantity: 1, unit: '包', unitKind: 'container', gramsPerUnit: null, storage: '冷藏', expiresOn: null, hasTrustedGrams: false }] },
      ],
    })
    expect(result.items[0].inventories).toEqual([])
    expect(result.items[1].availabilityStatus).toBe('unit_confirmation_required')
    expect(result.items[1].inventories[0].unit).toBe('包')
  })

  it('parses null weekly plans and generated shopping lists', () => {
    expect(parseWeeklyPlan({ weekStart: '2026-07-13', plan: null }).plan).toBeNull()
    const list = parseShoppingList({
      id: 'list-1', weeklyPlanId: 'plan-1', status: 'generated', createdAt: '2026-07-13T12:00:00Z', completedAt: null,
      items: [{ id: 'line-1', ingredientId: 'i-1', name: '牛肉', requiredGrams: 500, inventoryCoveredGrams: 100, toPurchaseGrams: 400, purchaseQuantity: null, purchaseUnit: null, completedQuantity: null, completedUnit: null, storage: null, status: 'pending' }],
    })
    expect(list?.items[0].toPurchaseGrams).toBe(400)
    expect(list?.completedAt).toBeNull()
  })

  it('parses saved cook nutrition and estimate status', () => {
    const result = parseSavedCook({
      cookSessionId: 'cook-1', name: '成品', cookedOn: '2026-07-13', totalServings: 1.5,
      nutrition: { kcal: 800, protein: 60, carb: 50, fat: 30, estimated: true },
    })
    expect(result.totalServings).toBe(1.5)
    expect(result.nutrition.estimated).toBe(true)
  })
})
