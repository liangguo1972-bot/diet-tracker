import { supabase, supabaseConfigError } from '../lib/supabase'
import type { SelectableItem } from '../types'
import { toDataError } from './errors'

type SourceType = SelectableItem['sourceType']
type ComponentRow = {
  source_type: string
  source_id: string
  name: string
  subtitle: string
  serving_grams: number | null
  available_servings: number | null
  per_serving_kcal: number | null
  per_serving_protein: number | null
  per_serving_carb: number | null
  per_serving_fat: number | null
  estimated: boolean
  last_used_on: string | null
}

const n = (value: number | null) => Number((value ?? 0).toFixed(1))

export async function searchMealComponents(sourceType: SourceType, query: string): Promise<SelectableItem[]> {
  if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase 未配置')
  const { data, error } = await supabase.rpc('search_meal_components', {
    p_source_type: sourceType,
    p_query: query.trim(),
  })
  if (error) throw toDataError(error)

  return ((data ?? []) as ComponentRow[]).map((item) => ({
    sourceType: item.source_type === 'cook_session' ? 'cook_session' : 'ingredient',
    sourceId: item.source_id,
    name: item.name,
    subtitle: item.subtitle,
    servingGrams: item.serving_grams,
    availableServings: item.available_servings,
    nutrition: {
      kcal: n(item.per_serving_kcal),
      protein: n(item.per_serving_protein),
      carb: n(item.per_serving_carb),
      fat: n(item.per_serving_fat),
    },
    estimated: item.estimated,
    lastUsedOn: item.last_used_on,
  }))
}
