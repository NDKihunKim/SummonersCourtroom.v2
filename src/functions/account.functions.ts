import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { accountIdentityForUser } from "@/functions/account-identity.server";
import { assertRateLimit } from "@/server/request-rate-limit";
import { assertSameOrigin } from "@/server/csrf";

const DeleteAccountInputSchema = z.object({
  accessToken: z.string().min(1),
});

export const deleteCurrentAccount = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => DeleteAccountInputSchema.parse(input))
  .handler(async ({ data }) => {
    assertSameOrigin();
    await assertRateLimit({
      scope: "account-delete",
      limit: 3,
      windowMs: 60 * 60_000,
      message: "Too many account deletion attempts. Please wait and try again.",
    });

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(data.accessToken);
    if (userError || !userData.user) {
      throw new Error("Please sign in again before deleting your account.");
    }

    const userId = userData.user.id;
    const identity = await accountIdentityForUser(userData.user);

    await supabaseAdmin
      .from("deleted_account_identities")
      .delete()
      .lte("purge_after", new Date().toISOString());

    if (identity) {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("user_profiles")
        .select("plan")
        .eq("user_id", userId)
        .maybeSingle();
      if (profileError) {
        console.error("[account-delete] failed to load account profile:", profileError);
        throw new Error("Failed to delete account. Please try again.");
      }

      const activeSince = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
      const { data: usage, error: usageError } = await supabaseAdmin
        .from("verdict_usage_daily")
        .select("verdict_count, window_started_at")
        .eq("user_id", userId)
        .gt("window_started_at", activeSince)
        .order("window_started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (usageError) {
        console.error("[account-delete] failed to load verdict usage:", usageError);
        throw new Error("Failed to delete account. Please try again.");
      }

      const windowStartedAt = usage?.window_started_at ?? null;
      const resetAt = windowStartedAt
        ? new Date(Date.parse(windowStartedAt) + 24 * 60 * 60_000).toISOString()
        : null;
      const { error: identityError } = await supabaseAdmin
        .from("deleted_account_identities")
        .upsert(
          {
            identity_hash: identity.hash,
            provider: identity.provider,
            plan: profile?.plan ?? "free",
            verdict_count: usage?.verdict_count ?? 0,
            window_started_at: windowStartedAt,
            reset_at: resetAt,
            deleted_at: new Date().toISOString(),
            purge_after: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
          },
          { onConflict: "identity_hash" },
        );
      if (identityError) {
        console.error("[account-delete] failed to store deleted identity:", identityError);
        throw new Error("Failed to delete account. Please try again.");
      }
    }

    const { error: verdictError } = await supabaseAdmin
      .from("verdict_results")
      .update({ user_id: null, user_display: "Deleted User" })
      .eq("user_id", userId);
    if (verdictError) {
      console.error("[account-delete] failed to anonymize verdict results:", verdictError);
      throw new Error("Failed to delete account. Please try again.");
    }

    const { error: feedbackError } = await supabaseAdmin
      .from("verdict_feedback")
      .update({ user_id: null })
      .eq("user_id", userId);
    if (feedbackError) {
      console.error("[account-delete] failed to anonymize verdict feedback:", feedbackError);
      throw new Error("Failed to delete account. Please try again.");
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error("[account-delete] failed to delete auth user:", deleteError);
      throw new Error("Failed to delete account. Please try again.");
    }

    return { ok: true };
  });
