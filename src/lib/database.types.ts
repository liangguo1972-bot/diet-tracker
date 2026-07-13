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
          id: string
          ingredient_id: string | null
          note: string | null
          price: number | null
          purchase_date: string | null
          quantity: number | null
          receipt_raw_name: string | null
          status: string | null
          storage: string | null
          unit: string | null
          user_id: string
        }
        Insert: {
          id?: string
          ingredient_id?: string | null
          note?: string | null
          price?: number | null
          purchase_date?: string | null
          quantity?: number | null
          receipt_raw_name?: string | null
          status?: string | null
          storage?: string | null
          unit?: string | null
          user_id?: string
        }
        Update: {
          id?: string
          ingredient_id?: string | null
          note?: string | null
          price?: number | null
          purchase_date?: string | null
          quantity?: number | null
          receipt_raw_name?: string | null
          status?: string | null
          storage?: string | null
          unit?: string | null
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
      get_today: { Args: { p_date: string }; Returns: Json }
      save_meal: {
        Args: {
          p_eaten_on: string
          p_items: Json
          p_meal_type: string
          p_note: string
        }
        Returns: string
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
