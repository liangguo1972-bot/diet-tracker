export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      body_metrics: {
        Row: {
          energy_level: number | null
          id: string
          note: string | null
          recorded_on: string | null
          user_id: string
          waist: number | null
          weight: number | null
        }
        Insert: {
          energy_level?: number | null
          id?: string
          note?: string | null
          recorded_on?: string | null
          user_id?: string
          waist?: number | null
          weight?: number | null
        }
        Update: {
          energy_level?: number | null
          id?: string
          note?: string | null
          recorded_on?: string | null
          user_id?: string
          waist?: number | null
          weight?: number | null
        }
        Relationships: []
      }
      cook_items: {
        Row: {
          cook_session_id: string
          grams: number
          id: string
          ingredient_id: string
          note: string | null
        }
        Insert: {
          cook_session_id: string
          grams: number
          id?: string
          ingredient_id: string
          note?: string | null
        }
        Update: {
          cook_session_id?: string
          grams?: number
          id?: string
          ingredient_id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cook_items_cook_session_id_fkey"
            columns: ["cook_session_id"]
            isOneToOne: false
            referencedRelation: "cook_nutrition"
            referencedColumns: ["cook_session_id"]
          },
          {
            foreignKeyName: "cook_items_cook_session_id_fkey"
            columns: ["cook_session_id"]
            isOneToOne: false
            referencedRelation: "cook_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cook_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      cook_sessions: {
        Row: {
          cooked_on: string
          id: string
          name: string | null
          note: string | null
          recipe_id: string | null
          total_servings: number
          user_id: string
        }
        Insert: {
          cooked_on?: string
          id?: string
          name?: string | null
          note?: string | null
          recipe_id?: string | null
          total_servings?: number
          user_id?: string
        }
        Update: {
          cooked_on?: string
          id?: string
          name?: string | null
          note?: string | null
          recipe_id?: string | null
          total_servings?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cook_sessions_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_nutrition"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "cook_sessions_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      cook_unmatched_items: {
        Row: {
          cook_session_id: string
          created_at: string
          display_name: string
          id: string
          inventory_id: string
          note: string | null
          quantity_used: number
          unit: string
        }
        Insert: {
          cook_session_id: string
          created_at?: string
          display_name: string
          id?: string
          inventory_id: string
          note?: string | null
          quantity_used: number
          unit: string
        }
        Update: {
          cook_session_id?: string
          created_at?: string
          display_name?: string
          id?: string
          inventory_id?: string
          note?: string | null
          quantity_used?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "cook_unmatched_items_cook_session_id_fkey"
            columns: ["cook_session_id"]
            isOneToOne: false
            referencedRelation: "cook_nutrition"
            referencedColumns: ["cook_session_id"]
          },
          {
            foreignKeyName: "cook_unmatched_items_cook_session_id_fkey"
            columns: ["cook_session_id"]
            isOneToOne: false
            referencedRelation: "cook_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cook_unmatched_items_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventory"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_aliases: {
        Row: {
          alias: string
          created_at: string
          id: string
          ingredient_id: string
          normalized_alias: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          ingredient_id: string
          normalized_alias: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          ingredient_id?: string
          normalized_alias?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_aliases_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          carb_per_100g: number | null
          category: string | null
          fat_per_100g: number | null
          id: string
          is_verified: boolean | null
          kcal_per_100g: number | null
          name: string
          note: string | null
          package_spec: string | null
          protein_per_100g: number | null
          serving_grams: number | null
          shelf_stable: string | null
          storage: string | null
          user_id: string
        }
        Insert: {
          carb_per_100g?: number | null
          category?: string | null
          fat_per_100g?: number | null
          id?: string
          is_verified?: boolean | null
          kcal_per_100g?: number | null
          name: string
          note?: string | null
          package_spec?: string | null
          protein_per_100g?: number | null
          serving_grams?: number | null
          shelf_stable?: string | null
          storage?: string | null
          user_id?: string
        }
        Update: {
          carb_per_100g?: number | null
          category?: string | null
          fat_per_100g?: number | null
          id?: string
          is_verified?: boolean | null
          kcal_per_100g?: number | null
          name?: string
          note?: string | null
          package_spec?: string | null
          protein_per_100g?: number | null
          serving_grams?: number | null
          shelf_stable?: string | null
          storage?: string | null
          user_id?: string
        }
        Relationships: []
      }
      inventory: {
        Row: {
          created_at: string
          display_name: string | null
          expires_on: string | null
          grams_per_unit: number | null
          id: string
          ingredient_id: string | null
          note: string | null
          price: number | null
          purchase_date: string | null
          quantity: number
          receipt_item_id: string | null
          receipt_raw_name: string | null
          status: string
          storage: string | null
          unit: string
          unit_kind: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          expires_on?: string | null
          grams_per_unit?: number | null
          id?: string
          ingredient_id?: string | null
          note?: string | null
          price?: number | null
          purchase_date?: string | null
          quantity: number
          receipt_item_id?: string | null
          receipt_raw_name?: string | null
          status: string
          storage?: string | null
          unit: string
          unit_kind?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          expires_on?: string | null
          grams_per_unit?: number | null
          id?: string
          ingredient_id?: string | null
          note?: string | null
          price?: number | null
          purchase_date?: string | null
          quantity?: number
          receipt_item_id?: string | null
          receipt_raw_name?: string | null
          status?: string
          storage?: string | null
          unit?: string
          unit_kind?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_receipt_item_id_fkey"
            columns: ["receipt_item_id"]
            isOneToOne: false
            referencedRelation: "receipt_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          cook_session_id: string | null
          created_at: string
          id: string
          inventory_id: string
          movement_type: string
          note: string | null
          occurred_at: string
          quantity_delta: number
          shopping_list_id: string | null
          unit: string
          user_id: string
        }
        Insert: {
          cook_session_id?: string | null
          created_at?: string
          id?: string
          inventory_id: string
          movement_type: string
          note?: string | null
          occurred_at?: string
          quantity_delta: number
          shopping_list_id?: string | null
          unit: string
          user_id: string
        }
        Update: {
          cook_session_id?: string | null
          created_at?: string
          id?: string
          inventory_id?: string
          movement_type?: string
          note?: string | null
          occurred_at?: string
          quantity_delta?: number
          shopping_list_id?: string | null
          unit?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_cook_session_id_fkey"
            columns: ["cook_session_id"]
            isOneToOne: false
            referencedRelation: "cook_nutrition"
            referencedColumns: ["cook_session_id"]
          },
          {
            foreignKeyName: "inventory_movements_cook_session_id_fkey"
            columns: ["cook_session_id"]
            isOneToOne: false
            referencedRelation: "cook_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_shopping_list_fkey"
            columns: ["shopping_list_id"]
            isOneToOne: false
            referencedRelation: "shopping_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      meal_items: {
        Row: {
          cook_session_id: string | null
          id: string
          ingredient_id: string | null
          meal_id: string
          note: string | null
          position: number
          servings_eaten: number
        }
        Insert: {
          cook_session_id?: string | null
          id?: string
          ingredient_id?: string | null
          meal_id: string
          note?: string | null
          position?: number
          servings_eaten?: number
        }
        Update: {
          cook_session_id?: string | null
          id?: string
          ingredient_id?: string | null
          meal_id?: string
          note?: string | null
          position?: number
          servings_eaten?: number
        }
        Relationships: [
          {
            foreignKeyName: "meal_items_cook_session_id_fkey"
            columns: ["cook_session_id"]
            isOneToOne: false
            referencedRelation: "cook_nutrition"
            referencedColumns: ["cook_session_id"]
          },
          {
            foreignKeyName: "meal_items_cook_session_id_fkey"
            columns: ["cook_session_id"]
            isOneToOne: false
            referencedRelation: "cook_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meal_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meal_items_meal_id_fkey"
            columns: ["meal_id"]
            isOneToOne: false
            referencedRelation: "meal_nutrition"
            referencedColumns: ["meal_id"]
          },
          {
            foreignKeyName: "meal_items_meal_id_fkey"
            columns: ["meal_id"]
            isOneToOne: false
            referencedRelation: "meals"
            referencedColumns: ["id"]
          },
        ]
      }
      meals: {
        Row: {
          eaten_on: string
          id: string
          meal_type: string | null
          note: string | null
          user_id: string
        }
        Insert: {
          eaten_on?: string
          id?: string
          meal_type?: string | null
          note?: string | null
          user_id?: string
        }
        Update: {
          eaten_on?: string
          id?: string
          meal_type?: string | null
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      operation_requests: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string
          operation_type: string
          request_hash: string
          response: Json | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key: string
          operation_type: string
          request_hash: string
          response?: Json | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string
          operation_type?: string
          request_hash?: string
          response?: Json | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      receipt_imports: {
        Row: {
          confirmed_at: string | null
          content_type: string
          created_at: string
          error_code: string | null
          error_message: string | null
          file_hash: string | null
          file_name: string
          file_size_bytes: number
          id: string
          merchant_name: string | null
          purchased_on: string | null
          raw_text: string | null
          recognition_provider: string | null
          source_type: string
          status: string
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          confirmed_at?: string | null
          content_type: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          file_hash?: string | null
          file_name: string
          file_size_bytes: number
          id?: string
          merchant_name?: string | null
          purchased_on?: string | null
          raw_text?: string | null
          recognition_provider?: string | null
          source_type?: string
          status?: string
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          confirmed_at?: string | null
          content_type?: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          file_hash?: string | null
          file_name?: string
          file_size_bytes?: number
          id?: string
          merchant_name?: string | null
          purchased_on?: string | null
          raw_text?: string | null
          recognition_provider?: string | null
          source_type?: string
          status?: string
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      receipt_items: {
        Row: {
          action: string
          confirmed_name: string | null
          confirmed_quantity: number | null
          confirmed_unit: string | null
          created_at: string
          id: string
          ingredient_id: string | null
          inventory_id: string | null
          match_confidence: number | null
          match_status: string
          position: number
          raw_line: string | null
          raw_name: string
          raw_price: number | null
          raw_quantity: number | null
          raw_unit: string | null
          receipt_import_id: string
          storage: string | null
          updated_at: string
        }
        Insert: {
          action?: string
          confirmed_name?: string | null
          confirmed_quantity?: number | null
          confirmed_unit?: string | null
          created_at?: string
          id?: string
          ingredient_id?: string | null
          inventory_id?: string | null
          match_confidence?: number | null
          match_status?: string
          position: number
          raw_line?: string | null
          raw_name: string
          raw_price?: number | null
          raw_quantity?: number | null
          raw_unit?: string | null
          receipt_import_id: string
          storage?: string | null
          updated_at?: string
        }
        Update: {
          action?: string
          confirmed_name?: string | null
          confirmed_quantity?: number | null
          confirmed_unit?: string | null
          created_at?: string
          id?: string
          ingredient_id?: string | null
          inventory_id?: string | null
          match_confidence?: number | null
          match_status?: string
          position?: number
          raw_line?: string | null
          raw_name?: string
          raw_price?: number | null
          raw_quantity?: number | null
          raw_unit?: string | null
          receipt_import_id?: string
          storage?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_items_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_items_receipt_import_id_fkey"
            columns: ["receipt_import_id"]
            isOneToOne: false
            referencedRelation: "receipt_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_candidates: {
        Row: {
          created_at: string
          id: string
          position: number
          recipe_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          position?: number
          recipe_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          recipe_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_candidates_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_nutrition"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_candidates_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_items: {
        Row: {
          grams: number
          id: string
          ingredient_id: string
          note: string | null
          recipe_id: string
        }
        Insert: {
          grams: number
          id?: string
          ingredient_id: string
          note?: string | null
          recipe_id: string
        }
        Update: {
          grams?: number
          id?: string
          ingredient_id?: string
          note?: string | null
          recipe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_items_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_nutrition"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_items_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_parse_calls: {
        Row: {
          completed_at: string | null
          created_at: string
          error_code: string | null
          id: string
          input_chars: number
          input_tokens: number | null
          model: string
          output_tokens: number | null
          provider: string
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          input_chars: number
          input_tokens?: number | null
          model: string
          output_tokens?: number | null
          provider: string
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          input_chars?: number
          input_tokens?: number | null
          model?: string
          output_tokens?: number | null
          provider?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      recipe_parse_policy: {
        Row: {
          daily_limit: number
          max_input_chars: number
          monthly_limit: number
          singleton: boolean
          updated_at: string
        }
        Insert: {
          daily_limit: number
          max_input_chars: number
          monthly_limit: number
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          daily_limit?: number
          max_input_chars?: number
          monthly_limit?: number
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      recipes: {
        Row: {
          id: string
          name: string
          note: string | null
          role: string | null
          servings: number
          user_id: string
        }
        Insert: {
          id?: string
          name: string
          note?: string | null
          role?: string | null
          servings?: number
          user_id?: string
        }
        Update: {
          id?: string
          name?: string
          note?: string | null
          role?: string | null
          servings?: number
          user_id?: string
        }
        Relationships: []
      }
      shopping_list_items: {
        Row: {
          completed_quantity: number | null
          completed_unit: string | null
          created_at: string
          id: string
          ingredient_id: string
          inventory_covered_grams: number
          item_status: string
          purchase_quantity: number | null
          purchase_unit: string | null
          required_grams: number
          shopping_list_id: string
          storage: string | null
          to_purchase_grams: number
          updated_at: string
        }
        Insert: {
          completed_quantity?: number | null
          completed_unit?: string | null
          created_at?: string
          id?: string
          ingredient_id: string
          inventory_covered_grams?: number
          item_status?: string
          purchase_quantity?: number | null
          purchase_unit?: string | null
          required_grams: number
          shopping_list_id: string
          storage?: string | null
          to_purchase_grams?: number
          updated_at?: string
        }
        Update: {
          completed_quantity?: number | null
          completed_unit?: string | null
          created_at?: string
          id?: string
          ingredient_id?: string
          inventory_covered_grams?: number
          item_status?: string
          purchase_quantity?: number | null
          purchase_unit?: string | null
          required_grams?: number
          shopping_list_id?: string
          storage?: string | null
          to_purchase_grams?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_list_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_list_items_shopping_list_id_fkey"
            columns: ["shopping_list_id"]
            isOneToOne: false
            referencedRelation: "shopping_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      shopping_lists: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          status: string
          updated_at: string
          user_id: string
          weekly_plan_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
          weekly_plan_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
          weekly_plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_lists_weekly_plan_id_fkey"
            columns: ["weekly_plan_id"]
            isOneToOne: true
            referencedRelation: "weekly_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      targets: {
        Row: {
          daily_kcal: number | null
          daily_protein_g: number | null
          id: string
          note: string | null
          user_id: string
        }
        Insert: {
          daily_kcal?: number | null
          daily_protein_g?: number | null
          id?: string
          note?: string | null
          user_id?: string
        }
        Update: {
          daily_kcal?: number | null
          daily_protein_g?: number | null
          id?: string
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      weekly_plan_items: {
        Row: {
          created_at: string
          id: string
          planned_servings: number
          position: number
          recipe_id: string
          scheduled_on: string
          source: string
          weekly_plan_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          planned_servings?: number
          position?: number
          recipe_id: string
          scheduled_on: string
          source?: string
          weekly_plan_id: string
        }
        Update: {
          created_at?: string
          id?: string
          planned_servings?: number
          position?: number
          recipe_id?: string
          scheduled_on?: string
          source?: string
          weekly_plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_plan_items_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_nutrition"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "weekly_plan_items_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_plan_items_weekly_plan_id_fkey"
            columns: ["weekly_plan_id"]
            isOneToOne: false
            referencedRelation: "weekly_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_plans: {
        Row: {
          created_at: string
          id: string
          status: string
          updated_at: string
          user_id: string
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
          week_start?: string
        }
        Relationships: []
      }
    }
    Views: {
      cook_nutrition: {
        Row: {
          all_verified: boolean | null
          cook_session_id: string | null
          cooked_on: string | null
          name: string | null
          per_serving_carb: number | null
          per_serving_fat: number | null
          per_serving_kcal: number | null
          per_serving_protein: number | null
          total_carb: number | null
          total_fat: number | null
          total_kcal: number | null
          total_protein: number | null
          total_servings: number | null
        }
        Relationships: []
      }
      daily_summary: {
        Row: {
          eaten_on: string | null
          total_carb: number | null
          total_fat: number | null
          total_kcal: number | null
          total_protein: number | null
        }
        Relationships: []
      }
      meal_nutrition: {
        Row: {
          carb: number | null
          eaten_on: string | null
          fat: number | null
          kcal: number | null
          meal_id: string | null
          meal_type: string | null
          protein: number | null
        }
        Relationships: []
      }
      recipe_nutrition: {
        Row: {
          all_verified: boolean | null
          name: string | null
          per_serving_carb: number | null
          per_serving_fat: number | null
          per_serving_kcal: number | null
          per_serving_protein: number | null
          recipe_id: string | null
          servings: number | null
          total_carb: number | null
          total_fat: number | null
          total_kcal: number | null
          total_protein: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_receipt_recognition: {
        Args: {
          p_items: Json
          p_provider: string
          p_raw_text: string
          p_receipt_import_id: string
        }
        Returns: Json
      }
      claim_recipe_parse_call: {
        Args: { p_input_chars: number; p_model: string; p_provider: string }
        Returns: Json
      }
      complete_purchase: {
        Args: {
          p_idempotency_key: string
          p_items: Json
          p_shopping_list_id: string
        }
        Returns: Json
      }
      complete_recipe_parse_call: {
        Args: {
          p_error_code?: string
          p_input_tokens?: number
          p_output_tokens?: number
          p_parse_call_id: string
          p_status: string
        }
        Returns: undefined
      }
      confirm_receipt_import: {
        Args: { p_idempotency_key: string; p_receipt_import_id: string }
        Returns: Json
      }
      create_receipt_import: {
        Args: {
          p_content_type: string
          p_file_hash?: string
          p_file_name: string
          p_file_size_bytes: number
        }
        Returns: Json
      }
      create_recipe_with_candidate: {
        Args: {
          p_idempotency_key: string
          p_items: Json
          p_name: string
          p_servings: number
        }
        Returns: Json
      }
      draw_recipe_candidates: { Args: { p_count?: number }; Returns: Json }
      generate_shopping_list: {
        Args: { p_weekly_plan_id: string }
        Returns: Json
      }
      get_cook_preparation: {
        Args: { p_plan_item_id?: string; p_recipe_id: string }
        Returns: Json
      }
      get_kitchen_home: { Args: { p_date?: string }; Returns: Json }
      get_operation_result: {
        Args: { p_idempotency_key: string; p_operation_type: string }
        Returns: Json
      }
      get_receipt_import: {
        Args: { p_receipt_import_id: string }
        Returns: Json
      }
      get_shopping_list: { Args: { p_weekly_plan_id: string }; Returns: Json }
      get_today: { Args: { p_date: string }; Returns: Json }
      get_weekly_plan: { Args: { p_week_start: string }; Returns: Json }
      list_inventory: {
        Args: { p_query?: string; p_status?: string }
        Returns: Json
      }
      list_receipt_imports: { Args: { p_limit?: number }; Returns: Json }
      list_recipe_candidates: { Args: never; Returns: Json }
      mark_receipt_import_failed: {
        Args: {
          p_error_code: string
          p_error_message?: string
          p_receipt_import_id: string
        }
        Returns: undefined
      }
      match_recipe_ingredients: { Args: { p_items: Json }; Returns: Json }
      normalize_receipt_name: { Args: { p_name: string }; Returns: string }
      save_cook_session: {
        Args: {
          p_cooked_on: string
          p_idempotency_key: string
          p_items: Json
          p_name: string
          p_note: string
          p_recipe_id: string
          p_total_servings: number
          p_unmatched_items?: Json
        }
        Returns: Json
      }
      save_meal: {
        Args: {
          p_eaten_on: string
          p_items: Json
          p_meal_type: string
          p_note: string
        }
        Returns: string
      }
      save_weekly_plan: {
        Args: { p_items: Json; p_status?: string; p_week_start: string }
        Returns: Json
      }
      search_cook_inventory: {
        Args: { p_query?: string }
        Returns: {
          expires_on: string
          grams_per_unit: number
          has_trusted_grams: boolean
          ingredient_id: string
          inventory_id: string
          name: string
          quantity: number
          storage: string
          unit: string
          unit_kind: string
        }[]
      }
      search_ingredients: {
        Args: { p_limit?: number; p_query?: string }
        Returns: {
          category: string
          ingredient_id: string
          is_verified: boolean
          name: string
          package_spec: string
          serving_grams: number
          storage_guidance: string
        }[]
      }
      search_meal_components: {
        Args: { p_query: string; p_source_type: string }
        Returns: {
          available_servings: number
          estimated: boolean
          last_used_on: string
          name: string
          per_serving_carb: number
          per_serving_fat: number
          per_serving_kcal: number
          per_serving_protein: number
          serving_grams: number
          source_id: string
          source_type: string
          subtitle: string
        }[]
      }
      search_receipt_ingredients: {
        Args: { p_query?: string }
        Returns: {
          category: string
          ingredient_id: string
          is_verified: boolean
          name: string
          package_spec: string
          storage_guidance: string
        }[]
      }
      set_recipe_candidate_status: {
        Args: { p_position?: number; p_recipe_id: string; p_status: string }
        Returns: Json
      }
      update_meal: {
        Args: {
          p_eaten_on: string
          p_items: Json
          p_meal_id: string
          p_meal_type: string
          p_note: string
        }
        Returns: undefined
      }
      update_receipt_items: {
        Args: { p_items: Json; p_receipt_import_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
