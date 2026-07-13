import type { MealDraft, SelectableItem, TodayMeal } from '../types'

export const MIN_SERVINGS = 0.01
export const SERVING_STEP = 0.25

export const createInitialDraft = (date: string): MealDraft => ({
  mealId: null,
  eatenOn: date,
  mealType: '早餐',
  note: '',
  items: [],
})

export const createDraftFromMeal = (meal: TodayMeal, date: string): MealDraft => ({
  mealId: meal.id,
  eatenOn: date,
  mealType: meal.mealType,
  note: meal.note ?? '',
  items: meal.items.map((item) => ({
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    name: item.name,
    subtitle: item.sourceType === 'cook_session' ? '已记录成品' : '已记录单品',
    servingGrams: null,
    availableServings: null,
    nutrition: {
      kcal: item.servings > 0 ? item.nutrition.kcal / item.servings : 0,
      protein: item.servings > 0 ? item.nutrition.protein / item.servings : 0,
      carb: item.servings > 0 ? item.nutrition.carb / item.servings : 0,
      fat: item.servings > 0 ? item.nutrition.fat / item.servings : 0,
    },
    estimated: item.estimated,
    lastUsedOn: null,
    servings: item.servings,
  })),
})

export function addDraftItem(draft: MealDraft, item: SelectableItem): MealDraft {
  const existing = draft.items.findIndex((draftItem) => draftItem.sourceType === item.sourceType && draftItem.sourceId === item.sourceId)
  const items = existing >= 0
    ? draft.items.map((draftItem, index) => {
        if (index !== existing) return draftItem
        const availableServings = item.availableServings === null ? draftItem.availableServings : draftItem.servings + item.availableServings
        const servings = Math.min(availableServings ?? Number.POSITIVE_INFINITY, draftItem.servings + 1)
        return { ...draftItem, availableServings, servings }
      })
    : [...draft.items, { ...item, servings: Math.min(1, item.availableServings ?? 1) }]
  return { ...draft, items }
}

export function setDraftItemServings(draft: MealDraft, index: number, value: number): MealDraft {
  const current = draft.items[index]
  if (!current || !Number.isFinite(value)) return draft
  const max = current.availableServings ?? Number.POSITIVE_INFINITY
  const servings = Math.min(max, Math.max(MIN_SERVINGS, Number(value.toFixed(2))))
  return { ...draft, items: draft.items.map((item, itemIndex) => itemIndex === index ? { ...item, servings } : item) }
}

export function removeDraftItem(draft: MealDraft, index: number): MealDraft {
  return { ...draft, items: draft.items.filter((_item, itemIndex) => itemIndex !== index) }
}
