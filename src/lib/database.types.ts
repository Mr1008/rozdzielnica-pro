export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
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
  public: {
    Tables: {
      cabinets: {
        Row: {
          archived_at: string | null
          created_at: string
          geometry: Json
          id: string
          manufacturer: string
          model: string
          name: string
          price_grosze: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          geometry: Json
          id?: string
          manufacturer: string
          model: string
          name: string
          price_grosze: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          geometry?: Json
          id?: string
          manufacturer?: string
          model?: string
          name?: string
          price_grosze?: number
          updated_at?: string
        }
        Relationships: []
      }
      devices: {
        Row: {
          archived_at: string | null
          breaking_capacity_ka: number | null
          created_at: string
          depth_mm: number
          height_mm: number
          id: string
          kind: Database["public"]["Enums"]["device_kind"]
          manufacturer: string
          model: string
          name: string
          poles: Database["public"]["Enums"]["pole_config"] | null
          price_grosze: number
          rated_current_a: number | null
          rcd_type: Database["public"]["Enums"]["rcd_type"] | null
          residual_current_ma: number | null
          terminal_groups: Json | null
          updated_at: string
          width_mm: number
        }
        Insert: {
          archived_at?: string | null
          breaking_capacity_ka?: number | null
          created_at?: string
          depth_mm: number
          height_mm: number
          id?: string
          kind: Database["public"]["Enums"]["device_kind"]
          manufacturer: string
          model: string
          name: string
          poles?: Database["public"]["Enums"]["pole_config"] | null
          price_grosze: number
          rated_current_a?: number | null
          rcd_type?: Database["public"]["Enums"]["rcd_type"] | null
          residual_current_ma?: number | null
          terminal_groups?: Json | null
          updated_at?: string
          width_mm: number
        }
        Update: {
          archived_at?: string | null
          breaking_capacity_ka?: number | null
          created_at?: string
          depth_mm?: number
          height_mm?: number
          id?: string
          kind?: Database["public"]["Enums"]["device_kind"]
          manufacturer?: string
          model?: string
          name?: string
          poles?: Database["public"]["Enums"]["pole_config"] | null
          price_grosze?: number
          rated_current_a?: number | null
          rcd_type?: Database["public"]["Enums"]["rcd_type"] | null
          residual_current_ma?: number | null
          terminal_groups?: Json | null
          updated_at?: string
          width_mm?: number
        }
        Relationships: []
      }
      pricing_profiles: {
        Row: {
          created_at: string
          hourly_rate_grosze: number
          mount_minutes_per_device: number
          project_overhead_minutes: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          hourly_rate_grosze: number
          mount_minutes_per_device: number
          project_overhead_minutes: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          hourly_rate_grosze?: number
          mount_minutes_per_device?: number
          project_overhead_minutes?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      device_kind:
        | "switch_disconnector"
        | "rcd"
        | "rcbo"
        | "mcb_b"
        | "pe_bar"
        | "n_bar"
      pole_config: "1P" | "1P+N" | "2P" | "3P" | "3P+N" | "4P"
      rcd_type: "AC" | "A" | "F" | "B"
      user_role: "admin" | "elektryk"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      device_kind: [
        "switch_disconnector",
        "rcd",
        "rcbo",
        "mcb_b",
        "pe_bar",
        "n_bar",
      ],
      pole_config: ["1P", "1P+N", "2P", "3P", "3P+N", "4P"],
      rcd_type: ["AC", "A", "F", "B"],
      user_role: ["admin", "elektryk"],
    },
  },
} as const

