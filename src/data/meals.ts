import type { Json } from '../lib/database.types'
import { supabase, supabaseConfigError } from '../lib/supabase'
import type { SaveMealInput } from '../types'
import { toDataError } from './errors'

export interface MealMutationAdapter {
  saveMeal(input: SaveMealInput): Promise<{ mealId: string }>
  updateMeal(mealId: string, input: SaveMealInput): Promise<void>
}

const itemsJson = (input: SaveMealInput): Json => input.items as unknown as Json

export const mealMutationAdapter: MealMutationAdapter = {
  async saveMeal(input) {
    if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase 未配置')
    const { data, error } = await supabase.rpc('save_meal', {
      p_eaten_on: input.eatenOn,
      p_meal_type: input.mealType,
      p_note: input.note ?? '',
      p_items: itemsJson(input),
    })
    if (error) throw toDataError(error)
    return { mealId: data }
  },
  async updateMeal(mealId, input) {
    if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase 未配置')
    const { error } = await supabase.rpc('update_meal', {
      p_meal_id: mealId,
      p_eaten_on: input.eatenOn,
      p_meal_type: input.mealType,
      p_note: input.note ?? '',
      p_items: itemsJson(input),
    })
    if (error) throw toDataError(error)
  },
}
