import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertRateLimit } from "@/server/request-rate-limit";
import { assertTurnstile, TurnstileTokenSchema } from "@/server/turnstile";
import type { Locale } from "@/i18n";

const SHARE_TTL_HOURS = 72;
const ONE_MINUTE_MS = 60_000;

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
  championKey: z.string().min(1).max(64).optional(),
  summonerName: z.string().max(128).optional(),
});

const CreateSharedVerdictInputSchema = z.object({
  turnstileToken: TurnstileTokenSchema,
  verdictResultId: z.string().min(8).max(48).regex(/^[a-zA-Z0-9_-]+$/),
  profile: z
    .object({
      shard: z.string().min(1).max(8),
      gameName: z.string().min(1).max(128),
      tagLine: z.string().min(1).max(32),
    })
    .optional(),
  scopeLabel: z.string().max(64).nullable().optional(),
});

const GetSharedVerdictInputSchema = z.object({
  id: z.string().min(8).max(48).regex(/^[a-zA-Z0-9_-]+$/),
});

function parseCreateSharedVerdictInput(input: unknown) {
  const parsed = CreateSharedVerdictInputSchema.safeParse(input);
  if (!parsed.success) {
    console.error("[shared-verdict] invalid create input:", parsed.error);
    throw new Error("Failed to create share link.");
  }
  return parsed.data;
}

function parseGetSharedVerdictInput(input: unknown) {
  const parsed = GetSharedVerdictInputSchema.safeParse(input);
  if (!parsed.success) {
    console.error("[shared-verdict] invalid lookup input:", parsed.error);
    throw new Error("Shared verdict not found or expired.");
  }
  return parsed.data;
}

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
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("shared_verdicts")
    .delete()
    .lt("expires_at", now);
  if (error) console.error("[shared-verdict] expired cleanup failed:", error);

  const { error: resultError } = await supabaseAdmin
    .from("verdict_results")
    .delete()
    .lt("expires_at", now);
  if (resultError) console.error("[verdict-result] expired cleanup failed:", resultError);
}

function normalizeSharedVerdict(row: {
  id: string;
  expires_at: string;
  profile_shard: string | null;
  profile_game_name: string | null;
  profile_tag_line: string | null;
  scope_label: string | null;
  verdict_results: {
    match_id: string | null;
    locale: string;
    verdict_mode: string;
    selected_players: unknown;
    verdict_display: unknown;
    reasoning: string;
    expires_at: string;
  } | null;
}): SharedVerdictPayload {
  const result = row.verdict_results;
  if (!result) throw new Error("Shared verdict not found or expired.");
  const selectedPlayers = z.array(SharedPlayerSchema).catch([]).parse(result.selected_players);
  const verdictDisplay = VerdictDisplaySchema.parse(result.verdict_display);
  return {
    id: row.id,
    expiresAt: row.expires_at,
    matchId: result.match_id,
    profile:
      row.profile_shard && row.profile_game_name && row.profile_tag_line
        ? {
            shard: row.profile_shard,
            gameName: row.profile_game_name,
            tagLine: row.profile_tag_line,
          }
        : null,
    locale: result.locale === "ko" ? "ko" : "en",
    verdictMode: result.verdict_mode,
    scopeLabel: row.scope_label,
    selectedPlayers,
    verdictDisplay,
    reasoning: result.reasoning,
  };
}

export const createSharedVerdict = createServerFn({ method: "POST" })
  .inputValidator(parseCreateSharedVerdictInput)
  .handler(async ({ data }) => {
    assertRateLimit({
      scope: "shared-verdict-create",
      limit: 8,
      windowMs: ONE_MINUTE_MS,
      message: "Too many share requests. Please wait a minute and try again.",
    });
    await assertTurnstile(data.turnstileToken);
    await deleteExpiredShares();

    const { data: resultRow, error: resultError } = await supabaseAdmin
      .from("verdict_results")
      .select("id, expires_at, match_id, locale, verdict_mode, selected_players, verdict_display, reasoning")
      .eq("id", data.verdictResultId)
      .maybeSingle();

    if (resultError) {
      console.error("[shared-verdict] verdict result lookup failed:", resultError);
      throw new Error("Failed to create share link.");
    }
    if (!resultRow || new Date(resultRow.expires_at).getTime() <= Date.now()) {
      throw new Error("This verdict can no longer be shared. Please create a new verdict.");
    }

    const expiresAt = new Date(Date.now() + SHARE_TTL_HOURS * 60 * 60_000).toISOString();
    const { error: extendError } = await supabaseAdmin
      .from("verdict_results")
      .update({ expires_at: expiresAt })
      .eq("id", resultRow.id)
      .lt("expires_at", expiresAt);
    if (extendError) {
      console.error("[shared-verdict] failed to extend verdict result expiry:", extendError);
      throw new Error("Failed to create share link.");
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = createShareId();
      const { error } = await supabaseAdmin.from("shared_verdicts").insert({
        id,
        expires_at: expiresAt,
        verdict_result_id: resultRow.id,
        profile_shard: data.profile?.shard ?? null,
        profile_game_name: data.profile?.gameName ?? null,
        profile_tag_line: data.profile?.tagLine ?? null,
        scope_label: data.scopeLabel ?? null,
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
  .inputValidator(parseGetSharedVerdictInput)
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("shared_verdicts")
      .select(
        "id, expires_at, profile_shard, profile_game_name, profile_tag_line, scope_label, verdict_results(match_id, locale, verdict_mode, selected_players, verdict_display, reasoning, expires_at)",
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

    const result = Array.isArray(row.verdict_results)
      ? row.verdict_results[0]
      : row.verdict_results;
    if (!result || new Date(result.expires_at).getTime() <= Date.now()) {
      await supabaseAdmin.from("shared_verdicts").delete().eq("id", data.id);
      throw new Error("Shared verdict not found or expired.");
    }

    return normalizeSharedVerdict({ ...row, verdict_results: result });
  });
