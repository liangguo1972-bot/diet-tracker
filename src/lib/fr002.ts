import type {
  CookDraft,
  CookInventoryOption,
  CookPreparation,
  DrawnRecipe,
  SaveCookInput,
  ShoppingItemDraft,
  ShoppingListData,
  WeeklyPlanItem,
  WeeklyPlanInputItem,
} from '../fr002-types'

export const localDateKey = (date = new Date()) => date.toLocaleDateString('en-CA')

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`)
  value.setDate(value.getDate() + days)
  return localDateKey(value)
}

export function startOfWeek(date: string): string {
  const value = new Date(`${date}T12:00:00`)
  const offset = (value.getDay() + 6) % 7
  value.setDate(value.getDate() - offset)
  return localDateKey(value)
}

export const prettyDate = (date: string) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(`${date}T12:00:00`))
export const weekday = (date: string) => new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(new Date(`${date}T12:00:00`))
export const amount = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)

const usageFromPreparation = (ingredientId: string, name: string, inventory: CookPreparation['items'][number]['inventories'][number], referenceGrams: number) => ({
  ...inventory,
  ingredientId,
  name,
  quantityUsed: inventory.unit === 'g' ? Math.min(referenceGrams, inventory.quantity) : null,
  note: '',
})

export function createCookDraft(preparation: CookPreparation, cookedOn: string): CookDraft {
  return {
    recipeId: preparation.recipe.id,
    recipeName: preparation.recipe.name,
    recipeServings: preparation.recipe.servings,
    planItemId: preparation.planItemId,
    cookedOn,
    name: preparation.recipe.name,
    totalServings: preparation.recipe.servings,
    note: '',
    ingredients: preparation.items.map((item) => ({
      ingredientId: item.ingredientId,
      name: item.name,
      referenceGrams: item.referenceGrams,
      availableGrams: item.availableGrams,
      availabilityStatus: item.availabilityStatus,
      usages: item.inventories.length > 0
        ? [usageFromPreparation(item.ingredientId, item.name, item.inventories[0], item.referenceGrams)]
        : [],
    })),
  }
}

export function setCookInventory(draft: CookDraft, ingredientId: string, option: CookInventoryOption, usageIndex?: number): CookDraft {
  return {
    ...draft,
    ingredients: draft.ingredients.map((ingredient) => {
      if (ingredient.ingredientId !== ingredientId) return ingredient
      const usage = { ...option, quantityUsed: option.unit === 'g' ? Math.min(ingredient.referenceGrams, option.quantity) : null, note: '' }
      if (usageIndex === undefined) return { ...ingredient, usages: [...ingredient.usages, usage] }
      return { ...ingredient, usages: ingredient.usages.map((current, index) => index === usageIndex ? usage : current) }
    }),
  }
}

export function updateCookUsage(draft: CookDraft, ingredientId: string, usageIndex: number, quantityUsed: number | null): CookDraft {
  return {
    ...draft,
    ingredients: draft.ingredients.map((ingredient) => ingredient.ingredientId !== ingredientId ? ingredient : {
      ...ingredient,
      usages: ingredient.usages.map((usage, index) => index === usageIndex ? { ...usage, quantityUsed } : usage),
    }),
  }
}

export function removeCookUsage(draft: CookDraft, ingredientId: string, usageIndex: number): CookDraft {
  return {
    ...draft,
    ingredients: draft.ingredients.map((ingredient) => ingredient.ingredientId !== ingredientId ? ingredient : {
      ...ingredient,
      usages: ingredient.usages.filter((_usage, index) => index !== usageIndex),
    }),
  }
}

export const isCookDraftComplete = (draft: CookDraft) => draft.ingredients.length > 0 && draft.ingredients.every((ingredient) =>
  ingredient.usages.length > 0 && ingredient.usages.every((usage) => usage.quantityUsed !== null && usage.quantityUsed > 0 && usage.quantityUsed <= usage.quantity),
)

export function toSaveCookInput(draft: CookDraft): SaveCookInput {
  const usages = draft.ingredients.flatMap((ingredient) => ingredient.usages.map((usage) => ({ ingredient, usage })))
  return {
    recipeId: draft.recipeId,
    name: draft.name.trim(),
    cookedOn: draft.cookedOn,
    totalServings: draft.totalServings,
    note: draft.note.trim(),
    items: usages.filter(({ usage }) => usage.ingredientId !== null).map(({ ingredient, usage }) => ({
      inventoryId: usage.inventoryId,
      ingredientId: ingredient.ingredientId,
      quantityUsed: usage.quantityUsed ?? 0,
      unit: usage.unit,
      note: usage.note.trim(),
    })),
    unmatchedItems: usages.filter(({ usage }) => usage.ingredientId === null).map(({ usage }) => ({
      inventoryId: usage.inventoryId,
      displayName: usage.name,
      quantityUsed: usage.quantityUsed ?? 0,
      unit: usage.unit,
      note: usage.note.trim(),
    })),
  }
}

const drawOffsets = [0, 2, 4, 6]

export function createDrawnPlan(recipes: DrawnRecipe[], weekStart: string): WeeklyPlanItem[] {
  return recipes.map((recipe, index) => ({
    id: `draw-${recipe.recipeId}-${index}`,
    recipeId: recipe.recipeId,
    recipeName: recipe.name,
    scheduledOn: addDays(weekStart, drawOffsets[index] ?? Math.min(index, 6)),
    plannedServings: recipe.servings > 0 ? recipe.servings : 1,
    position: index,
    source: 'candidate_draw',
  }))
}

export const toWeeklyPlanInputs = (items: WeeklyPlanItem[]): WeeklyPlanInputItem[] => items.map((item, index) => ({
  recipeId: item.recipeId,
  scheduledOn: item.scheduledOn,
  plannedServings: item.plannedServings,
  position: index,
  source: item.source,
}))

export function createShoppingDraft(list: ShoppingListData, purchaseDate: string): ShoppingItemDraft[] {
  return list.items.map((item) => ({
    shoppingListItemId: item.id,
    name: item.name,
    quantity: item.status === 'completed' ? item.completedQuantity : item.toPurchaseGrams > 0 ? item.toPurchaseGrams : null,
    unit: item.status === 'completed' ? item.completedUnit ?? 'g' : 'g',
    storage: item.storage ?? '冷藏',
    purchaseDate,
    expiresOn: null,
    gramsPerUnit: null,
    note: '',
    toPurchaseGrams: item.toPurchaseGrams,
    status: item.status,
  }))
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}
