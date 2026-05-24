import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ANONYMOUS_DAILY_LIMIT = 3;
const FREE_DAILY_LIMIT = 5;
const PAID_DAILY_LIMIT = 30;

export type AccountPlan = "anonymous" | "free" | "paid" | "unli";

export type VerdictQuotaStatus = {
  plan: AccountPlan;
  limit: number | null;
  used: number;
  remaining: number | null;
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

async function resolveUser(accessToken?: string): Promise<{ id: string; email?: string } | null> {
  if (!accessToken) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new Error("Your session expired. Please sign in again.");
  }

  return { id: data.user.id, email: data.user.email ?? undefined };
}

async function profilePlan(userId: string): Promise<"free" | "paid" | "unli"> {
  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select("plan")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load account plan: ${error.code ?? "unknown"} ${error.message}`);
  }
  if (data?.plan === "unli") return "unli";
  if (data?.plan === "paid") return "paid";
  if (data?.plan === "free") return "free";

  const { error: insertError } = await supabaseAdmin
    .from("user_profiles")
    .insert({ user_id: userId, plan: "free" });
  if (insertError && insertError.code !== "23505") {
    throw new Error(
      `Failed to create account profile: ${insertError.code ?? "unknown"} ${insertError.message}`,
    );
  }
  return "free";
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
  const user = await resolveUser(accessToken);
  const date = usageDate();
  const ipHash = await sha256(requestIp());

  if (user) {
    const plan = await profilePlan(user.id);
    if (plan === "unli") {
      return { plan, limit: null, used: 0, remaining: null, usageDate: date, resetAt: null };
    }
    const limit = plan === "paid" ? PAID_DAILY_LIMIT : FREE_DAILY_LIMIT;
    const usage = await getActiveUsage({ userId: user.id, ipHash });
    return {
      plan,
      limit,
      used: usage.used,
      remaining: Math.max(0, limit - usage.used),
      usageDate: date,
      resetAt: usage.resetAt,
    };
  }

  if (!anonymousId) {
    throw new Error("Anonymous usage id is missing. Please refresh and try again.");
  }

  const usage = await getActiveUsage({ anonymousId, ipHash });
  return {
    plan: "anonymous",
    limit: ANONYMOUS_DAILY_LIMIT,
    used: usage.used,
    remaining: Math.max(0, ANONYMOUS_DAILY_LIMIT - usage.used),
    usageDate: date,
    resetAt: usage.resetAt,
  };
}

export async function consumeVerdictQuota(identity: {
  accessToken?: string;
  anonymousId?: string;
}): Promise<VerdictQuotaStatus> {
  const user = await resolveUser(identity.accessToken);
  const date = usageDate();
  const ipHash = await sha256(requestIp());

  const plan: AccountPlan = user ? await profilePlan(user.id) : "anonymous";
  if (plan === "unli") {
    return { plan, limit: null, used: 0, remaining: null, usageDate: date, resetAt: null };
  }

  const limit =
    plan === "paid" ? PAID_DAILY_LIMIT : plan === "free" ? FREE_DAILY_LIMIT : ANONYMOUS_DAILY_LIMIT;

  if (!user && !identity.anonymousId) {
    throw new Error("Anonymous usage id is missing. Please refresh and try again.");
  }

  const { data, error } = await supabaseAdmin.rpc("consume_verdict_quota_atomic", {
    p_usage_date: date,
    p_user_id: user?.id ?? null,
    p_anonymous_id: user ? null : identity.anonymousId,
    p_ip_hash: ipHash,
    p_limit: limit,
  });

  if (error) throw new Error("Failed to update verdict quota.");

  const result = parseAtomicQuotaResult(data);
  if (!result.consumed) {
    throw new Error(`Daily AI verdict limit reached (${result.used}/${result.limit || limit}).`);
  }

  return {
    plan,
    limit,
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
  const user = await resolveUser(identity.accessToken);
  const date = usageDate();
  const ipHash = await sha256(requestIp());
  const plan: AccountPlan = user ? await profilePlan(user.id) : "anonymous";

  if (plan === "unli") return;
  if (!user && !identity.anonymousId) return;

  const { error } = await supabaseAdmin.rpc("refund_verdict_quota_atomic", {
    p_usage_date: date,
    p_user_id: user?.id ?? null,
    p_anonymous_id: user ? null : identity.anonymousId,
    p_ip_hash: ipHash,
  });

  if (error) throw new Error("Failed to refund verdict quota.");
}
