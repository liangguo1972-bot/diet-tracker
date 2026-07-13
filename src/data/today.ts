import { supabase, supabaseConfigError } from '../lib/supabase'
import type { Json } from '../lib/database.types'
import type { MealType, Nutrition, TodayData, TodayMeal, TodayMealItem } from '../types'
import { toDataError } from './errors'

export interface TodayDataAdapter {
  getToday(date: string): Promise<TodayData>
}

const mealTypes: MealType[] = ['早餐', '早午餐', '午餐', '晚餐', '加餐']
const record = (value: Json | undefined): Record<string, Json | undefined> => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('今日数据格式无效。')
  return value
}
const array = (value: Json | undefined): Json[] => Array.isArray(value) ? value : []
const number = (value: Json | undefined): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
const nullableNumber = (value: Json | undefined): number | null => value === null || value === undefined ? null : number(value)
const string = (value: Json | undefined): string => typeof value === 'string' ? value : ''
const nutrition = (value: Json | undefined): Nutrition => {
  const item = record(value)
  return { kcal: number(item.kcal), protein: number(item.protein), carb: number(item.carb), fat: number(item.fat) }
}
const parseMealItem = (value: Json): TodayMealItem => {
  const item = record(value)
  const sourceType = item.sourceType === 'cook_session' ? 'cook_session' : 'ingredient'
  return {
    id: string(item.id),
    sourceType,
    sourceId: string(item.sourceId),
    name: string(item.name) || '未命名',
    servings: number(item.servings),
    nutrition: nutrition(item.nutrition),
    estimated: item.estimated === true,
  }
}
const parseMeal = (value: Json): TodayMeal => {
  const meal = record(value)
  const type = string(meal.mealType)
  if (!mealTypes.includes(type as MealType)) throw new Error('今日数据包含无效餐次。')
  return {
    id: string(meal.id),
    mealType: type as MealType,
    note: typeof meal.note === 'string' ? meal.note : null,
    nutrition: nutrition(meal.nutrition),
    items: array(meal.items).map(parseMealItem),
  }
}

export function parseTodayData(value: Json): TodayData {
  const data = record(value)
  const target = record(data.target)
  return {
    date: string(data.date),
    total: nutrition(data.total),
    target: { kcal: nullableNumber(target.kcal), protein: nullableNumber(target.protein) },
    meals: array(data.meals).map(parseMeal),
  }
}

export const todayDataAdapter: TodayDataAdapter = {
  async getToday(date) {
    if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase 未配置')
    const { data, error } = await supabase.rpc('get_today', { p_date: date })
    if (error) throw toDataError(error)
    return parseTodayData(data)
  },
}
