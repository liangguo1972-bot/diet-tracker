import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const supabaseConfigError =
  url && key ? null : '缺少 Supabase 环境变量。请配置 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY。'

export const supabase = url && key ? createClient<Database>(url, key) : null
