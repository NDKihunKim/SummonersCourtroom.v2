import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertRateLimit } from "@/server/request-rate-limit";
import { assertTurnstile, TurnstileTokenSchema } from "@/server/turnstile";

const OBJECTION_ERRORS = {
  RATE_LIMITED: "OBJECTION_RATE_LIMITED",
  AUTH_REQUIRED: "OBJECTION_AUTH_REQUIRED",
  SESSION_EXPIRED: "OBJECTION_SESSION_EXPIRED",
  VERIFY_FAILED: "OBJECTION_VERIFY_FAILED",
  ALREADY_SUBMITTED: "OBJECTION_ALREADY_SUBMITTED",
  SAVE_FAILED: "OBJECTION_SAVE_FAILED",
} as const;

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

const ReasoningFeedbackSchema = z.object({
  index: z.number().int().min(1).max(10),
  text: z.string().min(1).max(2000),
  explanation: z.string().max(1000).optional(),
});

const SubmitVerdictFeedbackInputSchema = z.object({
  turnstileToken: TurnstileTokenSchema,
  accessToken: z.string().min(1).optional(),
  anonymousId: z.string().min(8).max(128).optional(),
  verdictResultId: z
    .string()
    .min(8)
    .max(48)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  source: z.enum(["verdict", "shared"]),
  shareId: z
    .string()
    .min(8)
    .max(48)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  matchId: z.string().max(64).optional(),
  locale: z.enum(["en", "ko"]),
  verdictMode: z.string().min(1).max(32),
  scopeLabel: z.string().max(64).nullable().optional(),
  selectedPlayers: z.array(SharedPlayerSchema).min(1).max(5),
  verdictDisplay: VerdictDisplaySchema,
  selectedReasons: z.array(ReasoningFeedbackSchema).min(1).max(5),
});

async function resolveUser(accessToken?: string): Promise<string | null> {
  if (!accessToken) throw new Error(OBJECTION_ERRORS.AUTH_REQUIRED);

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new Error(OBJECTION_ERRORS.SESSION_EXPIRED);
  }

  return data.user.id;
}

export const submitVerdictFeedback = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SubmitVerdictFeedbackInputSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      await assertTurnstile(data.turnstileToken);
    } catch (error) {
      console.error("[verdict-feedback] turnstile failed:", error);
      throw new Error(OBJECTION_ERRORS.VERIFY_FAILED);
    }

    try {
      assertRateLimit({
        scope: "verdict-feedback",
        limit: 10,
        windowMs: 60 * 60_000,
        message: OBJECTION_ERRORS.RATE_LIMITED,
      });
    } catch (error) {
      console.error("[verdict-feedback] rate limited:", error);
      throw new Error(OBJECTION_ERRORS.RATE_LIMITED);
    }

    const userId = await resolveUser(data.accessToken);
    if (!data.verdictResultId) {
      throw new Error(OBJECTION_ERRORS.SAVE_FAILED);
    }
    const selectedReasonIndexes = data.selectedReasons.map((reason) => reason.index);
    const selectedReasons = data.selectedReasons.map((reason) => ({
      index: reason.index,
      text: reason.text,
      explanation: reason.explanation?.trim() ?? "",
    }));

    const { error } = await supabaseAdmin.from("verdict_feedback").insert({
      user_id: userId,
      anonymous_id_hash: null,
      verdict_result_id: data.verdictResultId,
      source: data.source,
      share_id: data.shareId ?? null,
      match_id: data.matchId ?? null,
      locale: data.locale,
      verdict_mode: data.verdictMode,
      scope_label: data.scopeLabel ?? null,
      selected_players: data.selectedPlayers as unknown as never,
      verdict_display: data.verdictDisplay as unknown as never,
      selected_reason_indexes: selectedReasonIndexes,
      selected_reasons: selectedReasons as unknown as never,
      complaint: null,
    });

    if (error) {
      if (error.code === "23505") {
        throw new Error(OBJECTION_ERRORS.ALREADY_SUBMITTED);
      }
      console.error("[verdict-feedback] insert failed:", error);
      throw new Error(OBJECTION_ERRORS.SAVE_FAILED);
    }

    return { ok: true };
  });
