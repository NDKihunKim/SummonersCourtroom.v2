import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertTurnstile, TurnstileTokenSchema } from "@/server/turnstile";
import type { Locale } from "@/i18n";

const SHARE_TTL_HOURS = 72;

const SharedPlayerSchema = z.object({
  champion: z.string().min(1).max(64),
  championLabel: z.string().min(1).max(64).optional(),
  summoner: z.string().max(128).optional(),
  kills: z.number().int().min(0).max(999).optional(),
  deaths: z.number().int().min(0).max(999).optional(),
  assists: z.number().int().min(0).max(999).optional(),
});

const VerdictDisplaySchema = z.object({
  championName: z.string().min(1).max(128),
  summonerName: z.string().max(128).optional(),
});

const CreateSharedVerdictInputSchema = z.object({
  turnstileToken: TurnstileTokenSchema,
  matchId: z.string().max(64).optional(),
  profile: z
    .object({
      shard: z.string().min(1).max(8),
      gameName: z.string().min(1).max(128),
      tagLine: z.string().min(1).max(32),
    })
    .optional(),
  locale: z.enum(["en", "ko"]),
  verdictMode: z.string().min(1).max(32),
  scopeLabel: z.string().max(64).nullable().optional(),
  selectedPlayers: z.array(SharedPlayerSchema).min(1).max(5),
  verdictDisplay: VerdictDisplaySchema,
  reasoning: z.string().min(1).max(5000),
});

const GetSharedVerdictInputSchema = z.object({
  id: z.string().min(8).max(48).regex(/^[a-zA-Z0-9_-]+$/),
});

export type SharedVerdictPlayer = z.infer<typeof SharedPlayerSchema>;
export type SharedVerdictPayload = {
  id: string;
  expiresAt: string;
  matchId: string | null;
  profile: {
    shard: string;
    gameName: string;
    tagLine: string;
  } | null;
  locale: Locale;
  verdictMode: string;
  scopeLabel: string | null;
  selectedPlayers: SharedVerdictPlayer[];
  verdictDisplay: z.infer<typeof VerdictDisplaySchema>;
  reasoning: string;
};

function createShareId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deleteExpiredShares() {
  const { error } = await supabaseAdmin
    .from("shared_verdicts")
    .delete()
    .lt("expires_at", new Date().toISOString());
  if (error) console.error("[shared-verdict] expired cleanup failed:", error);
}

function normalizeSharedVerdict(row: {
  id: string;
  expires_at: string;
  match_id: string | null;
  profile_shard: string | null;
  profile_game_name: string | null;
  profile_tag_line: string | null;
  locale: string;
  verdict_mode: string;
  scope_label: string | null;
  selected_players: unknown;
  verdict_display: unknown;
  reasoning: string;
}): SharedVerdictPayload {
  const selectedPlayers = z.array(SharedPlayerSchema).catch([]).parse(row.selected_players);
  const verdictDisplay = VerdictDisplaySchema.parse(row.verdict_display);
  return {
    id: row.id,
    expiresAt: row.expires_at,
    matchId: row.match_id,
    profile:
      row.profile_shard && row.profile_game_name && row.profile_tag_line
        ? {
            shard: row.profile_shard,
            gameName: row.profile_game_name,
            tagLine: row.profile_tag_line,
          }
        : null,
    locale: row.locale === "ko" ? "ko" : "en",
    verdictMode: row.verdict_mode,
    scopeLabel: row.scope_label,
    selectedPlayers,
    verdictDisplay,
    reasoning: row.reasoning,
  };
}

export const createSharedVerdict = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => CreateSharedVerdictInputSchema.parse(input))
  .handler(async ({ data }) => {
    await assertTurnstile(data.turnstileToken);
    await deleteExpiredShares();

    const expiresAt = new Date(Date.now() + SHARE_TTL_HOURS * 60 * 60_000).toISOString();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = createShareId();
      const { error } = await supabaseAdmin.from("shared_verdicts").insert({
        id,
        expires_at: expiresAt,
        match_id: data.matchId ?? null,
        profile_shard: data.profile?.shard ?? null,
        profile_game_name: data.profile?.gameName ?? null,
        profile_tag_line: data.profile?.tagLine ?? null,
        locale: data.locale,
        verdict_mode: data.verdictMode,
        scope_label: data.scopeLabel ?? null,
        selected_players: data.selectedPlayers as unknown as never,
        verdict_display: data.verdictDisplay as unknown as never,
        reasoning: data.reasoning,
      });

      if (!error) {
        return {
          id,
          path: `/share/${id}`,
          expiresAt,
        };
      }

      if (error.code !== "23505") {
        console.error("[shared-verdict] insert failed:", error);
        throw new Error("Failed to create share link.");
      }
    }

    throw new Error("Failed to create unique share link.");
  });

export const getSharedVerdict = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => GetSharedVerdictInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("shared_verdicts")
      .select(
        "id, expires_at, match_id, profile_shard, profile_game_name, profile_tag_line, locale, verdict_mode, scope_label, selected_players, verdict_display, reasoning",
      )
      .eq("id", data.id)
      .maybeSingle();

    if (error) {
      console.error("[shared-verdict] lookup failed:", error);
      throw new Error("Failed to load shared verdict.");
    }
    if (!row) throw new Error("Shared verdict not found or expired.");

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await supabaseAdmin.from("shared_verdicts").delete().eq("id", data.id);
      throw new Error("Shared verdict not found or expired.");
    }

    return normalizeSharedVerdict(row);
  });
