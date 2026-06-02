import { supabaseAdmin } from "@/integrations/supabase/client.server";

type SharedRateLimitResult = {
  consumed: boolean;
  count: number;
  limit: number;
  remaining: number;
};

/**
 * Shared cross-isolate rate limit check backed by Supabase.
 *
 * This is the second tier — the in-memory rate limiter (Tier 1) should
 * pass first. If Tier 1 passes, this function does an atomic increment
 * in the database to ensure the global count across all edge isolates
 * stays within the limit.
 *
 * Pattern mirrors riot-rate-limit-backoff.ts: use Supabase as the
 * shared source of truth for cross-isolate coordination.
 */
export async function assertSharedRateLimit({
  scope,
  key,
  limit,
  windowMs,
}: {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
}): Promise<SharedRateLimitResult> {
  const { data, error } = await supabaseAdmin.rpc("consume_request_rate_limit_atomic", {
    p_scope: scope,
    p_key: key,
    p_limit: limit,
    p_window_ms: windowMs,
  });

  if (error) {
    // If the shared check fails, log it but don't block the request.
    // The in-memory limiter already passed, so we're still providing
    // some protection. This is a graceful degradation path.
    console.error("[request-rate-limit-shared] atomic check failed:", error);
    return { consumed: true, count: 0, limit, remaining: 0 };
  }

  const result = data && typeof data === "object" ? (data as SharedRateLimitResult) : null;

  if (!result || typeof result.consumed !== "boolean") {
    console.error("[request-rate-limit-shared] unexpected response:", data);
    return { consumed: true, count: 0, limit, remaining: 0 };
  }

  return result;
}

/**
 * Periodic cleanup of expired rows. Called opportunistically
 * (not on every request) to keep the table small.
 */
let lastCleanup = 0;
const CLEANUP_INTERVAL_MS = 5 * 60_000; // every 5 minutes

export async function maybeCleanupExpiredRateLimits() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  const { error } = await supabaseAdmin.from("request_rate_limits")
    .delete()
    .lt("expires_at", new Date().toISOString());

  if (error) {
    console.error("[request-rate-limit-shared] cleanup failed:", error);
  }
}
