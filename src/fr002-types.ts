import type { Nutrition } from './types'

export type CandidateStatus = 'wanted' | 'candidate' | 'kept' | 'skipped'
export type PlanStatus = 'draft' | 'confirmed'
export type PlanSource = 'manual' | 'candidate_draw'
export type InventoryStatus = 'active' | 'depleted'
export type CookAvailabilityStatus = 'ready' | 'partial' | 'missing' | 'unit_confirmation_required'
export type OperationType = 'complete_purchase' | 'save_cook_session' | 'confirm_receipt_import'

export type WeeklyPlanItem = {
  id: string
  scheduledOn: string
  recipeId: string
  recipeName: string
  plannedServings: number
  position: number
  source: PlanSource
}

export type WeeklyPlan = {
  id: string
  status: PlanStatus
  items: WeeklyPlanItem[]
}

export type WeeklyPlanData = {
  weekStart: string
  plan: WeeklyPlan | null
}

export type KitchenHomeData = {
  date: string
  inventorySummary: {
    activeLots: number
    depletedLots: number
    expiringLots: number
  }
  weeklyPlan: WeeklyPlan | null
  readyCookSessions: Array<{
    id: string
    name: string
    cookedOn: string
    availableServings: number
  }>
}

export type InventoryLot = {
  id: string
  ingredientId: string | null
  name: string
  quantity: number
  unit: string
  unitKind: string | null
  gramsPerUnit: number | null
  storage: string | null
  purchaseDate: string | null
  expiresOn: string | null
  status: InventoryStatus
  canAutoDeduct: boolean
  hasTrustedGrams: boolean
}

export type CookInventoryOption = {
  inventoryId: string
  ingredientId: string | null
  name: string
  quantity: number
  unit: string
  unitKind: string | null
  gramsPerUnit: number | null
  storage: string | null
  expiresOn: string | null
  hasTrustedGrams: boolean
}

export type CookPreparationInventory = Omit<CookInventoryOption, 'ingredientId' | 'name'>

export type CookPreparationItem = {
  ingredientId: string
  name: string
  referenceGrams: number
  availableGrams: number
  availabilityStatus: CookAvailabilityStatus
  inventories: CookPreparationInventory[]
}

export type CookPreparation = {
  recipe: { id: string; name: string; servings: number; note: string | null }
  planItemId: string | null
  items: CookPreparationItem[]
}

export type RecipeCandidate = {
  id: string
  recipeId: string
  name: string
  servings: number
  status: CandidateStatus
  position: number
  allVerified: boolean
}

export type DrawnRecipe = {
  recipeId: string
  name: string
  servings: number
  status: CandidateStatus
}

export type ShoppingListItem = {
  id: string
  ingredientId: string
  name: string
  requiredGrams: number
  inventoryCoveredGrams: number
  toPurchaseGrams: number
  purchaseQuantity: number | null
  purchaseUnit: string | null
  completedQuantity: number | null
  completedUnit: string | null
  storage: string | null
  status: 'pending' | 'completed'
}

export type ShoppingListData = {
  id: string
  weeklyPlanId: string
  status: 'generated' | 'completed'
  createdAt: string
  completedAt: string | null
  items: ShoppingListItem[]
}

export type WeeklyPlanInputItem = {
  recipeId: string
  scheduledOn: string
  plannedServings: number
  position: number
  source: PlanSource
}

export type CompletePurchaseItemInput = {
  shoppingListItemId: string
  quantity: number
  unit: string
  storage: string
  purchaseDate: string
  expiresOn: string | null
  gramsPerUnit: number | null
  note: string
}

export type SaveCookItemInput = {
  inventoryId: string
  ingredientId: string
  quantityUsed: number
  unit: string
  note: string
}

export type SaveCookInput = {
  recipeId: string
  name: string
  cookedOn: string
  totalServings: number
  note: string
  items: SaveCookItemInput[]
  unmatchedItems: Array<{
    inventoryId: string
    displayName: string
    quantityUsed: number
    unit: string
    note: string
  }>
}

export type SavedCookSession = {
  cookSessionId: string
  name: string
  cookedOn: string
  totalServings: number
  nutrition: Nutrition & { estimated: boolean }
}

export type OperationResult<T> = { status: string; response: T }

export type CookUsageDraft = CookInventoryOption & { quantityUsed: number | null; note: string }

export type CookIngredientDraft = Pick<CookPreparationItem, 'ingredientId' | 'name' | 'referenceGrams' | 'availableGrams' | 'availabilityStatus'> & {
  usages: CookUsageDraft[]
}

export type CookDraft = {
  recipeId: string
  recipeName: string
  recipeServings: number
  planItemId: string | null
  cookedOn: string
  name: string
  totalServings: number
  note: string
  ingredients: CookIngredientDraft[]
}

export type ShoppingItemDraft = Omit<CompletePurchaseItemInput, 'quantity' | 'gramsPerUnit'> & {
  quantity: number | null
  gramsPerUnit: number | null
  name: string
  toPurchaseGrams: number
  status: 'pending' | 'completed'
}
