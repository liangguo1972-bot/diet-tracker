import { describe, expect, it } from 'vitest'
import { parseCookPreparation, parseCookRecipeConfirmation, parseCreatedRecipeFromCook, parseInventory, parseKitchenHome, parseSavedCook, parseSavedCookWithoutRecipe, parseShoppingList, parseWeeklyPlan } from './fr002'

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

  it('parses FR-004 pending sessions and recovery payloads', () => {
    const home = parseKitchenHome({
      date: '2026-07-16', inventorySummary: { activeLots: 1, depletedLots: 0, expiringLots: 0 }, weeklyPlan: null,
      readyCookSessions: [{ id: 'cook-1', name: '随手一锅', cookedOn: '2026-07-16', availableServings: 2, recipeId: null, sourceType: 'without_recipe', recipeConfirmationStatus: 'pending' }],
    })
    expect(home.readyCookSessions[0].recipeConfirmationStatus).toBe('pending')
    const confirmation = parseCookRecipeConfirmation({
      cookSessionId: 'cook-1', sourceType: 'without_recipe', recipeConfirmationStatus: 'pending', name: '随手一锅', cookedOn: '2026-07-16', totalServings: 2,
      recipeId: null, recipeName: null, candidateId: null,
      items: [{ ingredientId: 'i-1', ingredientName: '番茄', grams: 180, isVerified: true }],
      unmatchedItems: [{ inventoryId: 'lot-2', name: '神秘香料', quantityUsed: 0.5, unit: '包' }],
    })
    expect(confirmation.items[0].grams).toBe(180)
    expect(confirmation.unmatchedItems[0].name).toBe('神秘香料')
  })

  it('parses both FR-004 write results', () => {
    const saved = parseSavedCookWithoutRecipe({ cookSessionId: 'cook-1', name: '随手一锅', cookedOn: '2026-07-16', totalServings: 2, sourceType: 'without_recipe', recipeConfirmationStatus: 'pending', nutrition: { kcal: 300, protein: 20, carb: 30, fat: 10, estimated: false } })
    expect(saved.recipeConfirmationStatus).toBe('pending')
    const recipe = parseCreatedRecipeFromCook({ cookSessionId: 'cook-1', recipeId: 'r-1', candidateId: 'c-1', name: '番茄鸡蛋', servings: 2, itemCount: 2, candidateStatus: 'candidate', recipeConfirmationStatus: 'confirmed' })
    expect(recipe.candidateStatus).toBe('candidate')
  })
})
