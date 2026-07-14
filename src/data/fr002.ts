import type { Json } from '../lib/database.types'
import { supabase, supabaseConfigError } from '../lib/supabase'
import type {
  CandidateStatus,
  CompletePurchaseItemInput,
  CookAvailabilityStatus,
  CookInventoryOption,
  CookPreparation,
  DrawnRecipe,
  InventoryLot,
  InventoryStatus,
  KitchenHomeData,
  OperationResult,
  OperationType,
  PlanSource,
  PlanStatus,
  RecipeCandidate,
  SaveCookInput,
  SavedCookSession,
  ShoppingListData,
  ShoppingListItem,
  WeeklyPlan,
  WeeklyPlanData,
  WeeklyPlanInputItem,
  WeeklyPlanItem,
} from '../fr002-types'
import { toDataError, toOperationError } from './errors'

type JsonRecord = Record<string, Json | undefined>

const record = (value: Json | undefined, label = '数据'): JsonRecord => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${label}格式无效。`)
  return value
}
const nullableRecord = (value: Json | undefined): JsonRecord | null => value === null || value === undefined ? null : record(value)
const array = (value: Json | undefined): Json[] => Array.isArray(value) ? value : []
const string = (value: Json | undefined): string => typeof value === 'string' ? value : ''
const nullableString = (value: Json | undefined): string | null => typeof value === 'string' && value !== '' ? value : null
const number = (value: Json | undefined): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
const nullableNumber = (value: Json | undefined): number | null => value === null || value === undefined ? null : number(value)
const boolean = (value: Json | undefined): boolean => value === true

const candidateStatuses: CandidateStatus[] = ['wanted', 'candidate', 'kept', 'skipped']
const planStatuses: PlanStatus[] = ['draft', 'confirmed']
const planSources: PlanSource[] = ['manual', 'candidate_draw']
const inventoryStatuses: InventoryStatus[] = ['active', 'depleted']
const availabilityStatuses: CookAvailabilityStatus[] = ['ready', 'partial', 'missing', 'unit_confirmation_required']

const enumValue = <T extends string>(value: Json | undefined, options: T[], fallback: T): T => {
  const parsed = string(value) as T
  return options.includes(parsed) ? parsed : fallback
}

const parsePlanItem = (value: Json): WeeklyPlanItem => {
  const item = record(value, '周计划条目')
  return {
    id: string(item.id),
    scheduledOn: string(item.scheduledOn),
    recipeId: string(item.recipeId),
    recipeName: string(item.recipeName) || '未命名食谱',
    plannedServings: number(item.plannedServings),
    position: number(item.position),
    source: enumValue(item.source, planSources, 'manual'),
  }
}

const parsePlan = (value: JsonRecord): WeeklyPlan => ({
  id: string(value.id),
  status: enumValue(value.status, planStatuses, 'draft'),
  items: array(value.items).map(parsePlanItem),
})

export function parseKitchenHome(value: Json): KitchenHomeData {
  const data = record(value, '厨房首页数据')
  const summary = record(data.inventorySummary, '库存摘要')
  const plan = nullableRecord(data.weeklyPlan)
  return {
    date: string(data.date),
    inventorySummary: {
      activeLots: number(summary.activeLots),
      depletedLots: number(summary.depletedLots),
      expiringLots: number(summary.expiringLots),
    },
    weeklyPlan: plan ? parsePlan(plan) : null,
    readyCookSessions: array(data.readyCookSessions).map((value) => {
      const item = record(value, '成品')
      return {
        id: string(item.id),
        name: string(item.name) || '未命名成品',
        cookedOn: string(item.cookedOn),
        availableServings: number(item.availableServings),
      }
    }),
  }
}

export function parseInventory(value: Json): InventoryLot[] {
  return array(value).map((entry) => {
    const item = record(entry, '库存条目')
    return {
      id: string(item.id),
      ingredientId: nullableString(item.ingredientId),
      name: string(item.name) || '未命名库存',
      quantity: number(item.quantity),
      unit: string(item.unit),
      unitKind: nullableString(item.unitKind),
      gramsPerUnit: nullableNumber(item.gramsPerUnit),
      storage: nullableString(item.storage),
      purchaseDate: nullableString(item.purchaseDate),
      expiresOn: nullableString(item.expiresOn),
      status: enumValue(item.status, inventoryStatuses, 'active'),
      canAutoDeduct: boolean(item.canAutoDeduct),
      hasTrustedGrams: boolean(item.hasTrustedGrams),
    }
  })
}

export function parseCookPreparation(value: Json): CookPreparation {
  const data = record(value, '做饭准备数据')
  const recipe = record(data.recipe, '食谱')
  return {
    recipe: {
      id: string(recipe.id),
      name: string(recipe.name) || '未命名食谱',
      servings: number(recipe.servings),
      note: nullableString(recipe.note),
    },
    planItemId: nullableString(data.planItemId),
    items: array(data.items).map((entry) => {
      const item = record(entry, '食材')
      return {
        ingredientId: string(item.ingredientId),
        name: string(item.name) || '未命名食材',
        referenceGrams: number(item.referenceGrams),
        availableGrams: number(item.availableGrams),
        availabilityStatus: enumValue(item.availabilityStatus, availabilityStatuses, 'missing'),
        inventories: array(item.inventories).map((inventoryValue) => {
          const inventory = record(inventoryValue, '库存批次')
          return {
            inventoryId: string(inventory.inventoryId),
            quantity: number(inventory.quantity),
            unit: string(inventory.unit),
            unitKind: nullableString(inventory.unitKind),
            gramsPerUnit: nullableNumber(inventory.gramsPerUnit),
            storage: nullableString(inventory.storage),
            expiresOn: nullableString(inventory.expiresOn),
            hasTrustedGrams: boolean(inventory.hasTrustedGrams),
          }
        }),
      }
    }),
  }
}

export function parseRecipeCandidates(value: Json): RecipeCandidate[] {
  return array(value).map((entry) => {
    const item = record(entry, '候选食谱')
    return {
      id: string(item.id),
      recipeId: string(item.recipeId),
      name: string(item.name) || '未命名食谱',
      servings: number(item.servings),
      status: enumValue(item.status, candidateStatuses, 'candidate'),
      position: number(item.position),
      allVerified: boolean(item.allVerified),
    }
  })
}

export function parseDrawnRecipes(value: Json): DrawnRecipe[] {
  return array(value).map((entry) => {
    const item = record(entry, '随机食谱')
    return {
      recipeId: string(item.recipeId),
      name: string(item.name) || '未命名食谱',
      servings: number(item.servings),
      status: enumValue(item.status, candidateStatuses, 'candidate'),
    }
  })
}

export function parseWeeklyPlan(value: Json): WeeklyPlanData {
  const data = record(value, '周计划数据')
  const plan = nullableRecord(data.plan)
  return { weekStart: string(data.weekStart), plan: plan ? parsePlan(plan) : null }
}

export function parseShoppingList(value: Json): ShoppingListData | null {
  if (value === null) return null
  const data = record(value, '采购清单数据')
  return {
    id: string(data.id),
    weeklyPlanId: string(data.weeklyPlanId),
    status: string(data.status) === 'completed' ? 'completed' : 'generated',
    createdAt: string(data.createdAt),
    completedAt: nullableString(data.completedAt),
    items: array(data.items).map((entry): ShoppingListItem => {
      const item = record(entry, '采购条目')
      return {
        id: string(item.id),
        ingredientId: string(item.ingredientId),
        name: string(item.name) || '未命名食材',
        requiredGrams: number(item.requiredGrams),
        inventoryCoveredGrams: number(item.inventoryCoveredGrams),
        toPurchaseGrams: number(item.toPurchaseGrams),
        purchaseQuantity: nullableNumber(item.purchaseQuantity),
        purchaseUnit: nullableString(item.purchaseUnit),
        completedQuantity: nullableNumber(item.completedQuantity),
        completedUnit: nullableString(item.completedUnit),
        storage: nullableString(item.storage),
        status: string(item.status) === 'completed' ? 'completed' : 'pending',
      }
    }),
  }
}

export function parseSavedCook(value: Json): SavedCookSession {
  const data = record(value, '成品保存结果')
  const nutrition = record(data.nutrition, '营养结果')
  return {
    cookSessionId: string(data.cookSessionId),
    name: string(data.name) || '未命名成品',
    cookedOn: string(data.cookedOn),
    totalServings: number(data.totalServings),
    nutrition: {
      kcal: number(nutrition.kcal),
      protein: number(nutrition.protein),
      carb: number(nutrition.carb),
      fat: number(nutrition.fat),
      estimated: boolean(nutrition.estimated),
    },
  }
}

const requireClient = () => {
  if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase 未配置')
  return supabase
}

export const fr002Adapter = {
  async getKitchenHome(date: string): Promise<KitchenHomeData> {
    const { data, error } = await requireClient().rpc('get_kitchen_home', { p_date: date })
    if (error) throw toDataError(error)
    return parseKitchenHome(data)
  },
  async listInventory(query = '', status?: InventoryStatus): Promise<InventoryLot[]> {
    const { data, error } = await requireClient().rpc('list_inventory', { p_query: query.trim(), p_status: status })
    if (error) throw toDataError(error)
    return parseInventory(data)
  },
  async getCookPreparation(recipeId: string, planItemId?: string): Promise<CookPreparation> {
    const { data, error } = await requireClient().rpc('get_cook_preparation', {
      p_recipe_id: recipeId,
      ...(planItemId ? { p_plan_item_id: planItemId } : {}),
    })
    if (error) throw toDataError(error)
    return parseCookPreparation(data)
  },
  async searchCookInventory(query = ''): Promise<CookInventoryOption[]> {
    const { data, error } = await requireClient().rpc('search_cook_inventory', { p_query: query.trim() })
    if (error) throw toDataError(error)
    return (data ?? []).map((item) => ({
      inventoryId: item.inventory_id,
      ingredientId: item.ingredient_id || null,
      name: item.name,
      quantity: Number(item.quantity),
      unit: item.unit,
      unitKind: item.unit_kind || null,
      gramsPerUnit: item.grams_per_unit === null ? null : Number(item.grams_per_unit),
      storage: item.storage || null,
      expiresOn: item.expires_on || null,
      hasTrustedGrams: item.has_trusted_grams,
    }))
  },
  async listRecipeCandidates(): Promise<RecipeCandidate[]> {
    const { data, error } = await requireClient().rpc('list_recipe_candidates')
    if (error) throw toDataError(error)
    return parseRecipeCandidates(data)
  },
  async drawRecipeCandidates(count: number): Promise<DrawnRecipe[]> {
    const { data, error } = await requireClient().rpc('draw_recipe_candidates', { p_count: count })
    if (error) throw toDataError(error)
    return parseDrawnRecipes(data)
  },
  async setRecipeCandidateStatus(recipeId: string, status: CandidateStatus, position: number): Promise<void> {
    const { error } = await requireClient().rpc('set_recipe_candidate_status', {
      p_recipe_id: recipeId,
      p_status: status,
      p_position: position,
    })
    if (error) throw toDataError(error)
  },
  async getWeeklyPlan(weekStart: string): Promise<WeeklyPlanData> {
    const { data, error } = await requireClient().rpc('get_weekly_plan', { p_week_start: weekStart })
    if (error) throw toDataError(error)
    return parseWeeklyPlan(data)
  },
  async saveWeeklyPlan(weekStart: string, items: WeeklyPlanInputItem[], status: PlanStatus): Promise<WeeklyPlanData> {
    const { data, error } = await requireClient().rpc('save_weekly_plan', {
      p_week_start: weekStart,
      p_items: items as unknown as Json,
      p_status: status,
    })
    if (error) throw toDataError(error)
    return parseWeeklyPlan(data)
  },
  async generateShoppingList(weeklyPlanId: string): Promise<ShoppingListData> {
    const { data, error } = await requireClient().rpc('generate_shopping_list', { p_weekly_plan_id: weeklyPlanId })
    if (error) throw toDataError(error)
    const parsed = parseShoppingList(data)
    if (!parsed) throw new Error('采购清单没有生成。')
    return parsed
  },
  async getShoppingList(weeklyPlanId: string): Promise<ShoppingListData | null> {
    const { data, error } = await requireClient().rpc('get_shopping_list', { p_weekly_plan_id: weeklyPlanId })
    if (error) throw toDataError(error)
    return parseShoppingList(data)
  },
  async completePurchase(shoppingListId: string, items: CompletePurchaseItemInput[], idempotencyKey: string): Promise<ShoppingListData> {
    try {
      const { data, error } = await requireClient().rpc('complete_purchase', {
        p_shopping_list_id: shoppingListId,
        p_items: items as unknown as Json,
        p_idempotency_key: idempotencyKey,
      })
      if (error) throw toOperationError(error)
      const parsed = parseShoppingList(data)
      if (!parsed) throw new Error('采购完成结果无效。')
      return parsed
    } catch (reason) {
      throw toOperationError(reason)
    }
  },
  async saveCookSession(input: SaveCookInput, idempotencyKey: string): Promise<SavedCookSession> {
    try {
      const { data, error } = await requireClient().rpc('save_cook_session', {
        p_recipe_id: input.recipeId,
        p_name: input.name,
        p_cooked_on: input.cookedOn,
        p_total_servings: input.totalServings,
        p_note: input.note,
        p_items: input.items as unknown as Json,
        p_unmatched_items: input.unmatchedItems as unknown as Json,
        p_idempotency_key: idempotencyKey,
      })
      if (error) throw toOperationError(error)
      return parseSavedCook(data)
    } catch (reason) {
      throw toOperationError(reason)
    }
  },
  async getOperationResult<T>(operationType: OperationType, idempotencyKey: string, parse: (value: Json) => T): Promise<OperationResult<T> | null> {
    const { data, error } = await requireClient().rpc('get_operation_result', {
      p_operation_type: operationType,
      p_idempotency_key: idempotencyKey,
    })
    if (error) throw toDataError(error)
    if (data === null) return null
    const result = record(data, '操作结果')
    return { status: string(result.status), response: parse(result.response as Json) }
  },
}
