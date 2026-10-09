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
      business_profiles: {
        Row: {
          address: string | null
          company_name: string | null
          created_at: string
          email: string | null
          nip: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          company_name?: string | null
          created_at?: string
          email?: string | null
          nip?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          company_name?: string | null
          created_at?: string
          email?: string | null
          nip?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
      circuits: {
        Row: {
          created_at: string
          cross_section_mm2: number
          entry_side: Database["public"]["Enums"]["entry_side"]
          id: string
          installation: Database["public"]["Enums"]["wlz_installation"]
          name: string
          phase_count: number
          position: number
          project_id: string
          rated_current_a: number
          rcd_group_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          cross_section_mm2: number
          entry_side: Database["public"]["Enums"]["entry_side"]
          id: string
          installation: Database["public"]["Enums"]["wlz_installation"]
          name: string
          phase_count: number
          position: number
          project_id: string
          rated_current_a: number
          rcd_group_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          cross_section_mm2?: number
          entry_side?: Database["public"]["Enums"]["entry_side"]
          id?: string
          installation?: Database["public"]["Enums"]["wlz_installation"]
          name?: string
          phase_count?: number
          position?: number
          project_id?: string
          rated_current_a?: number
          rcd_group_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "circuits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "circuits_rcd_group_fkey"
            columns: ["project_id", "rcd_group_id"]
            isOneToOne: false
            referencedRelation: "rcd_groups"
            referencedColumns: ["project_id", "id"]
          },
        ]
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
          n_terminal_side: Database["public"]["Enums"]["n_terminal_side"] | null
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
          n_terminal_side?:
            | Database["public"]["Enums"]["n_terminal_side"]
            | null
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
          n_terminal_side?:
            | Database["public"]["Enums"]["n_terminal_side"]
            | null
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
      project_device_placements: {
        Row: {
          created_at: string
          edited_manually: boolean
          project_device_id: string
          project_id: string
          rail_index: number
          x_mm: number
        }
        Insert: {
          created_at?: string
          edited_manually?: boolean
          project_device_id: string
          project_id: string
          rail_index: number
          x_mm: number
        }
        Update: {
          created_at?: string
          edited_manually?: boolean
          project_device_id?: string
          project_id?: string
          rail_index?: number
          x_mm?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_device_placements_device_fkey"
            columns: ["project_id", "project_device_id"]
            isOneToOne: false
            referencedRelation: "project_devices"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "project_device_placements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_devices: {
        Row: {
          breaking_capacity_ka: number | null
          busbar_piece: number | null
          circuit_id: string | null
          created_at: string
          depth_mm: number
          device_id: string
          height_mm: number
          id: string
          kind: Database["public"]["Enums"]["device_kind"]
          manufacturer: string
          model: string
          n_terminal_side: Database["public"]["Enums"]["n_terminal_side"] | null
          name: string
          notes: string[]
          poles: Database["public"]["Enums"]["pole_config"] | null
          position: number
          price_grosze: number
          project_id: string
          rated_current_a: number | null
          rcd_group_id: string | null
          rcd_type: Database["public"]["Enums"]["rcd_type"] | null
          residual_current_ma: number | null
          role: string
          terminal_groups: Json | null
          width_mm: number
        }
        Insert: {
          breaking_capacity_ka?: number | null
          busbar_piece?: number | null
          circuit_id?: string | null
          created_at?: string
          depth_mm?: number
          device_id: string
          height_mm?: number
          id?: string
          kind?: Database["public"]["Enums"]["device_kind"]
          manufacturer?: string
          model?: string
          n_terminal_side?:
            | Database["public"]["Enums"]["n_terminal_side"]
            | null
          name?: string
          notes?: string[]
          poles?: Database["public"]["Enums"]["pole_config"] | null
          position: number
          price_grosze?: number
          project_id: string
          rated_current_a?: number | null
          rcd_group_id?: string | null
          rcd_type?: Database["public"]["Enums"]["rcd_type"] | null
          residual_current_ma?: number | null
          role: string
          terminal_groups?: Json | null
          width_mm?: number
        }
        Update: {
          breaking_capacity_ka?: number | null
          busbar_piece?: number | null
          circuit_id?: string | null
          created_at?: string
          depth_mm?: number
          device_id?: string
          height_mm?: number
          id?: string
          kind?: Database["public"]["Enums"]["device_kind"]
          manufacturer?: string
          model?: string
          n_terminal_side?:
            | Database["public"]["Enums"]["n_terminal_side"]
            | null
          name?: string
          notes?: string[]
          poles?: Database["public"]["Enums"]["pole_config"] | null
          position?: number
          price_grosze?: number
          project_id?: string
          rated_current_a?: number | null
          rcd_group_id?: string | null
          rcd_type?: Database["public"]["Enums"]["rcd_type"] | null
          residual_current_ma?: number | null
          role?: string
          terminal_groups?: Json | null
          width_mm?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_devices_circuit_fkey"
            columns: ["project_id", "circuit_id"]
            isOneToOne: false
            referencedRelation: "circuits"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "project_devices_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_devices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_devices_rcd_group_fkey"
            columns: ["project_id", "rcd_group_id"]
            isOneToOne: false
            referencedRelation: "rcd_groups"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      projects: {
        Row: {
          cabinet_geometry: Json
          cabinet_id: string
          cabinet_manufacturer: string
          cabinet_model: string
          cabinet_name: string
          cabinet_price_grosze: number
          client_name: string | null
          created_at: string
          earthing_system: Database["public"]["Enums"]["earthing_system"] | null
          id: string
          labour_minutes_override: number | null
          labour_override_base_minutes: number | null
          name: string
          phase_count: number | null
          premeter_protection_a: number | null
          site_address: string | null
          updated_at: string
          user_id: string
          wlz_cross_section_mm2: number | null
          wlz_installation:
            | Database["public"]["Enums"]["wlz_installation"]
            | null
          wlz_length_m: number | null
          wlz_material: Database["public"]["Enums"]["conductor_material"] | null
        }
        Insert: {
          cabinet_geometry?: Json
          cabinet_id: string
          cabinet_manufacturer?: string
          cabinet_model?: string
          cabinet_name?: string
          cabinet_price_grosze?: number
          client_name?: string | null
          created_at?: string
          earthing_system?:
            | Database["public"]["Enums"]["earthing_system"]
            | null
          id?: string
          labour_minutes_override?: number | null
          labour_override_base_minutes?: number | null
          name: string
          phase_count?: number | null
          premeter_protection_a?: number | null
          site_address?: string | null
          updated_at?: string
          user_id: string
          wlz_cross_section_mm2?: number | null
          wlz_installation?:
            | Database["public"]["Enums"]["wlz_installation"]
            | null
          wlz_length_m?: number | null
          wlz_material?:
            | Database["public"]["Enums"]["conductor_material"]
            | null
        }
        Update: {
          cabinet_geometry?: Json
          cabinet_id?: string
          cabinet_manufacturer?: string
          cabinet_model?: string
          cabinet_name?: string
          cabinet_price_grosze?: number
          client_name?: string | null
          created_at?: string
          earthing_system?:
            | Database["public"]["Enums"]["earthing_system"]
            | null
          id?: string
          labour_minutes_override?: number | null
          labour_override_base_minutes?: number | null
          name?: string
          phase_count?: number | null
          premeter_protection_a?: number | null
          site_address?: string | null
          updated_at?: string
          user_id?: string
          wlz_cross_section_mm2?: number | null
          wlz_installation?:
            | Database["public"]["Enums"]["wlz_installation"]
            | null
          wlz_length_m?: number | null
          wlz_material?:
            | Database["public"]["Enums"]["conductor_material"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "cabinets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rcd_groups: {
        Row: {
          created_at: string
          id: string
          label: string
          min_rcd_type: Database["public"]["Enums"]["rcd_type"]
          position: number
          project_id: string
          rcd_margin_percent: number
          residual_current_ma: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          label: string
          min_rcd_type: Database["public"]["Enums"]["rcd_type"]
          position: number
          project_id: string
          rcd_margin_percent?: number
          residual_current_ma: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          min_rcd_type?: Database["public"]["Enums"]["rcd_type"]
          position?: number
          project_id?: string
          rcd_margin_percent?: number
          residual_current_ma?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rcd_groups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      save_project_circuits: {
        Args: {
          p_circuits: Json
          p_device_ids: Json
          p_groups: Json
          p_project_id: string
        }
        Returns: undefined
      }
      save_project_layout: {
        Args: {
          p_edited_manually?: boolean
          p_placements: Json
          p_project_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      conductor_material: "Cu" | "Al"
      device_kind:
        | "switch_disconnector"
        | "rcd"
        | "rcbo"
        | "mcb_b"
        | "pe_bar"
        | "n_bar"
        | "comb_busbar"
      earthing_system: "TN-C" | "TN-S" | "TN-C-S" | "TT"
      entry_side: "top" | "bottom" | "left" | "right"
      n_terminal_side: "left" | "right"
      pole_config: "1P" | "1P+N" | "2P" | "3P" | "3P+N" | "4P"
      rcd_type: "AC" | "A" | "F" | "B"
      user_role: "admin" | "elektryk"
      wlz_installation:
        | "surface"
        | "conduit_surface"
        | "conduit_flush"
        | "in_wall"
        | "in_ground"
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
      conductor_material: ["Cu", "Al"],
      device_kind: [
        "switch_disconnector",
        "rcd",
        "rcbo",
        "mcb_b",
        "pe_bar",
        "n_bar",
        "comb_busbar",
      ],
      earthing_system: ["TN-C", "TN-S", "TN-C-S", "TT"],
      entry_side: ["top", "bottom", "left", "right"],
      n_terminal_side: ["left", "right"],
      pole_config: ["1P", "1P+N", "2P", "3P", "3P+N", "4P"],
      rcd_type: ["AC", "A", "F", "B"],
      user_role: ["admin", "elektryk"],
      wlz_installation: [
        "surface",
        "conduit_surface",
        "conduit_flush",
        "in_wall",
        "in_ground",
      ],
    },
  },
} as const

