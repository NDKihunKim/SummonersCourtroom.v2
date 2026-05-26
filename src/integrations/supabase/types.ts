export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      cached_summoners: {
        Row: {
          cached_at: string;
          created_at: string;
          division: string | null;
          game_name: string;
          last_refresh_at: string;
          lp: number | null;
          matches: Json;
          profile_icon_id: number | null;
          puuid: string;
          queue_type: string;
          ranked_entries: Json | null;
          search_count: number;
          shard: string;
          tag_line: string;
          tier: string | null;
          tier_rank: number;
          updated_at: string;
        };
        Insert: {
          cached_at?: string;
          created_at?: string;
          division?: string | null;
          game_name: string;
          last_refresh_at?: string;
          lp?: number | null;
          matches?: Json;
          profile_icon_id?: number | null;
          puuid: string;
          queue_type?: string;
          ranked_entries?: Json | null;
          search_count?: number;
          shard: string;
          tag_line: string;
          tier?: string | null;
          tier_rank?: number;
          updated_at?: string;
        };
        Update: {
          cached_at?: string;
          created_at?: string;
          division?: string | null;
          game_name?: string;
          last_refresh_at?: string;
          lp?: number | null;
          matches?: Json;
          profile_icon_id?: number | null;
          puuid?: string;
          queue_type?: string;
          ranked_entries?: Json | null;
          search_count?: number;
          shard?: string;
          tag_line?: string;
          tier?: string | null;
          tier_rank?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      deleted_account_identities: {
        Row: {
          deleted_at: string;
          id: number;
          identity_hash: string;
          plan: string;
          provider: string | null;
          purge_after: string;
          reset_at: string | null;
          verdict_count: number;
          window_started_at: string | null;
        };
        Insert: {
          deleted_at?: string;
          id?: number;
          identity_hash: string;
          plan?: string;
          provider?: string | null;
          purge_after?: string;
          reset_at?: string | null;
          verdict_count?: number;
          window_started_at?: string | null;
        };
        Update: {
          deleted_at?: string;
          id?: number;
          identity_hash?: string;
          plan?: string;
          provider?: string | null;
          purge_after?: string;
          reset_at?: string | null;
          verdict_count?: number;
          window_started_at?: string | null;
        };
        Relationships: [];
      };
      shared_verdicts: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          profile_game_name: string | null;
          profile_shard: string | null;
          profile_tag_line: string | null;
          scope_label: string | null;
          verdict_result_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string;
          id: string;
          profile_game_name?: string | null;
          profile_shard?: string | null;
          profile_tag_line?: string | null;
          scope_label?: string | null;
          verdict_result_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          profile_game_name?: string | null;
          profile_shard?: string | null;
          profile_tag_line?: string | null;
          scope_label?: string | null;
          verdict_result_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shared_verdicts_verdict_result_id_fkey";
            columns: ["verdict_result_id"];
            isOneToOne: false;
            referencedRelation: "verdict_results";
            referencedColumns: ["id"];
          },
        ];
      };
      verdict_results: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          locale: string;
          match_id: string | null;
          reasoning: string;
          selected_players: Json;
          user_display: string;
          user_id: string | null;
          verdict_display: Json;
          verdict_mode: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string;
          id: string;
          locale?: string;
          match_id?: string | null;
          reasoning: string;
          selected_players?: Json;
          user_display?: string;
          user_id?: string | null;
          verdict_display: Json;
          verdict_mode: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          locale?: string;
          match_id?: string | null;
          reasoning?: string;
          selected_players?: Json;
          user_display?: string;
          user_id?: string | null;
          verdict_display?: Json;
          verdict_mode?: string;
        };
        Relationships: [];
      };
      verdict_feedback: {
        Row: {
          anonymous_id_hash: string | null;
          complaint: string | null;
          created_at: string;
          id: number;
          locale: string;
          match_id: string | null;
          scope_label: string | null;
          selected_players: Json;
          selected_reason_indexes: number[];
          selected_reasons: Json;
          share_id: string | null;
          source: string;
          user_id: string | null;
          verdict_result_id: string | null;
          verdict_display: Json;
          verdict_mode: string;
        };
        Insert: {
          anonymous_id_hash?: string | null;
          complaint?: string | null;
          created_at?: string;
          id?: number;
          locale?: string;
          match_id?: string | null;
          scope_label?: string | null;
          selected_players?: Json;
          selected_reason_indexes: number[];
          selected_reasons?: Json;
          share_id?: string | null;
          source: string;
          user_id?: string | null;
          verdict_result_id?: string | null;
          verdict_display: Json;
          verdict_mode: string;
        };
        Update: {
          anonymous_id_hash?: string | null;
          complaint?: string | null;
          created_at?: string;
          id?: number;
          locale?: string;
          match_id?: string | null;
          scope_label?: string | null;
          selected_players?: Json;
          selected_reason_indexes?: number[];
          selected_reasons?: Json;
          share_id?: string | null;
          source?: string;
          user_id?: string | null;
          verdict_result_id?: string | null;
          verdict_display?: Json;
          verdict_mode?: string;
        };
        Relationships: [];
      };
      user_profiles: {
        Row: {
          created_at: string;
          plan: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          plan?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          plan?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      verdict_usage_daily: {
        Row: {
          anonymous_id: string | null;
          created_at: string;
          id: number;
          ip_hash: string;
          updated_at: string;
          usage_date: string;
          user_id: string | null;
          verdict_count: number;
          window_started_at: string | null;
        };
        Insert: {
          anonymous_id?: string | null;
          created_at?: string;
          id?: number;
          ip_hash: string;
          updated_at?: string;
          usage_date?: string;
          user_id?: string | null;
          verdict_count?: number;
          window_started_at?: string | null;
        };
        Update: {
          anonymous_id?: string | null;
          created_at?: string;
          id?: number;
          ip_hash?: string;
          updated_at?: string;
          usage_date?: string;
          user_id?: string | null;
          verdict_count?: number;
          window_started_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      consume_verdict_quota_atomic: {
        Args: {
          p_anonymous_id: string | null;
          p_ip_hash: string;
          p_limit: number;
          p_usage_date: string;
          p_user_id: string | null;
        };
        Returns: Json;
      };
      compute_tier_rank: {
        Args: { p_division: string; p_lp: number; p_tier: string };
        Returns: number;
      };
      refund_verdict_quota_atomic: {
        Args: {
          p_anonymous_id: string | null;
          p_ip_hash: string;
          p_usage_date: string;
          p_user_id: string | null;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
