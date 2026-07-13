export type MealType = '早餐' | '早午餐' | '午餐' | '晚餐' | '加餐'

export type Nutrition = {
  kcal: number
  protein: number
  carb: number
  fat: number
}

export type MealItemInput =
  | { sourceType: 'cook_session'; cookSessionId: string; servings: number }
  | { sourceType: 'ingredient'; ingredientId: string; servings: number }

export type SaveMealInput = {
  eatenOn: string
  mealType: MealType
  note?: string
  items: MealItemInput[]
}

export type TodayMealItem = {
  id: string
  sourceType: 'cook_session' | 'ingredient'
  sourceId: string
  name: string
  servings: number
  nutrition: Nutrition
  estimated: boolean
}

export type TodayMeal = {
  id: string
  mealType: MealType
  note: string | null
  nutrition: Nutrition
  items: TodayMealItem[]
}

export type TodayData = {
  date: string
  total: Nutrition
  target: { kcal: number | null; protein: number | null }
  meals: TodayMeal[]
}

export type SelectableItem = {
  sourceType: 'cook_session' | 'ingredient'
  sourceId: string
  name: string
  subtitle: string
  servingGrams: number | null
  availableServings: number | null
  nutrition: Nutrition
  estimated: boolean
  lastUsedOn: string | null
}

export type DraftItem = SelectableItem & { servings: number }

export type MealDraft = {
  mealId: string | null
  eatenOn: string
  mealType: MealType
  note: string
  items: DraftItem[]
}
