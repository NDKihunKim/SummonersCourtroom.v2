import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { accountIdentityForUser } from "@/functions/account-identity.server";
import { resolveAuthUser, type AuthUser } from "@/server/auth";

const DAILY_VERDICT_LIMIT = 50;

export type VerdictQuotaStatus = {
  limit: number;
  used: number;
  remaining: number;
  usageDate: string;
  resetAt: string | null;
};

type AtomicQuotaResult = {
  consumed?: unknown;
  used?: unknown;
  remaining?: unknown;
  limit?: unknown;
  resetAt?: unknown;
};

function usageDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function requestIp(): string {
  try {
    const request = getRequest();
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return (
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-real-ip") ??
      forwarded ??
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function cleanupDeletedIdentities() {
  const { error } = await supabaseAdmin
    .from("deleted_account_identities")
    .delete()
    .lte("purge_after", new Date().toISOString());
  if (error) console.error("[verdict-quota] deleted identity cleanup failed:", error);
}

async function restoreDeletedIdentityQuota({
  user,
  ipHash,
}: {
  user: AuthUser;
  ipHash: string;
}) {
  const identity = await accountIdentityForUser(user.raw);
  if (!identity) return;

  await cleanupDeletedIdentities();

  const { data, error } = await supabaseAdmin
    .from("deleted_account_identities")
    .select("id, verdict_count, window_started_at")
    .eq("identity_hash", identity.hash)
    .gt("purge_after", new Date().toISOString())
    .maybeSingle();
  if (error) {
    console.error("[verdict-quota] failed to load deleted identity:", error);
    return;
  }
  if (!data?.window_started_at || data.verdict_count <= 0) return;

  const windowStart = Date.parse(data.window_started_at);
  if (!Number.isFinite(windowStart) || windowStart <= Date.now() - 24 * 60 * 60_000) return;

  const { error: usageError } = await supabaseAdmin.from("verdict_usage_daily").insert({
    usage_date: new Date(data.window_started_at).toISOString().slice(0, 10),
    user_id: user.userId,
    anonymous_id: null,
    ip_hash: ipHash,
    verdict_count: data.verdict_count,
    window_started_at: data.window_started_at,
  });
  if (usageError && usageError.code !== "23505") {
    console.error("[verdict-quota] failed to restore deleted identity quota:", usageError);
  }
}

async function getActiveUsage({
  userId,
  anonymousId,
  ipHash,
}: {
  userId?: string;
  anonymousId?: string;
  ipHash: string;
}): Promise<{ used: number; resetAt: string | null }> {
  const activeSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  if (userId) {
    const { data, error } = await supabaseAdmin
      .from("verdict_usage_daily")
      .select("verdict_count, window_started_at")
      .eq("user_id", userId)
      .gt("window_started_at", activeSince)
      .order("window_started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Failed to load verdict quota.");
    return {
      used: data?.verdict_count ?? 0,
      resetAt: data?.window_started_at ? resetAtFromWindowStart(data.window_started_at) : null,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("verdict_usage_daily")
    .select("verdict_count, window_started_at")
    .is("user_id", null)
    .eq("anonymous_id", anonymousId ?? "")
    .eq("ip_hash", ipHash)
    .gt("window_started_at", activeSince)
    .order("window_started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Failed to load verdict quota.");
  return {
    used: data?.verdict_count ?? 0,
    resetAt: data?.window_started_at ? resetAtFromWindowStart(data.window_started_at) : null,
  };
}

function resetAtFromWindowStart(windowStartedAt: string): string {
  return new Date(Date.parse(windowStartedAt) + 24 * 60 * 60 * 1000).toISOString();
}

function parseAtomicQuotaResult(value: unknown): {
  consumed: boolean;
  used: number;
  remaining: number;
  limit: number;
  resetAt: string | null;
} {
  const result = value && typeof value === "object" ? (value as AtomicQuotaResult) : {};
  return {
    consumed: result.consumed === true,
    used: typeof result.used === "number" ? result.used : 0,
    remaining: typeof result.remaining === "number" ? result.remaining : 0,
    limit: typeof result.limit === "number" ? result.limit : 0,
    resetAt: typeof result.resetAt === "string" ? result.resetAt : null,
  };
}

export async function getVerdictQuota({
  accessToken,
  anonymousId,
}: {
  accessToken?: string;
  anonymousId?: string;
}): Promise<VerdictQuotaStatus> {
  const user = await resolveAuthUser(accessToken);
  const date = usageDate();
  const ipHash = await sha256(requestIp());

  if (user) {
    const usage = await getActiveUsage({ userId: user.userId, ipHash });
    return {
      limit: DAILY_VERDICT_LIMIT,
      used: usage.used,
      remaining: Math.max(0, DAILY_VERDICT_LIMIT - usage.used),
      usageDate: date,
      resetAt: usage.resetAt,
    };
  }

  if (!anonymousId) {
    throw new Error("Anonymous usage id is missing. Please refresh and try again.");
  }

  const usage = await getActiveUsage({ anonymousId, ipHash });
  return {
    limit: DAILY_VERDICT_LIMIT,
    used: usage.used,
    remaining: Math.max(0, DAILY_VERDICT_LIMIT - usage.used),
    usageDate: date,
    resetAt: usage.resetAt,
  };
}

export async function consumeVerdictQuota(identity: {
  accessToken?: string;
  anonymousId?: string;
}): Promise<VerdictQuotaStatus> {
  const user = await resolveAuthUser(identity.accessToken);
  const date = usageDate();
  const ipHash = await sha256(requestIp());

  if (!user && !identity.anonymousId) {
    throw new Error("Anonymous usage id is missing. Please refresh and try again.");
  }

  const { data, error } = await supabaseAdmin.rpc("consume_verdict_quota_atomic", {
    p_usage_date: date,
    p_user_id: user?.userId ?? null,
    p_anonymous_id: user ? null : identity.anonymousId,
    p_ip_hash: ipHash,
    p_limit: DAILY_VERDICT_LIMIT,
  });

  if (error) throw new Error("Failed to update verdict quota.");

  const result = parseAtomicQuotaResult(data);
  if (!result.consumed) {
    throw new Error(`Daily AI verdict limit reached (${result.used}/${result.limit || DAILY_VERDICT_LIMIT}).`);
  }

  return {
    limit: DAILY_VERDICT_LIMIT,
    used: result.used,
    remaining: result.remaining,
    usageDate: date,
    resetAt: result.resetAt,
  };
}

export async function refundVerdictQuota(identity: {
  accessToken?: string;
  anonymousId?: string;
}): Promise<void> {
  const user = await resolveAuthUser(identity.accessToken);
  const date = usageDate();
  const ipHash = await sha256(requestIp());

  if (!user && !identity.anonymousId) return;

  const { error } = await supabaseAdmin.rpc("refund_verdict_quota_atomic", {
    p_usage_date: date,
    p_user_id: user?.userId ?? null,
    p_anonymous_id: user ? null : identity.anonymousId,
    p_ip_hash: ipHash,
  });

  if (error) throw new Error("Failed to refund verdict quota.");
}
