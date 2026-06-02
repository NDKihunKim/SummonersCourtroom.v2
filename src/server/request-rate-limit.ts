import { getRequest } from "@tanstack/react-start/server";
import {
  assertSharedRateLimit,
  maybeCleanupExpiredRateLimits,
} from "@/server/request-rate-limit-shared";

type RateLimitOptions = {
  scope: string;
  limit: number;
  windowMs: number;
  message: string;
  /** When true, a second Supabase-backed check runs after the in-memory
   *  check to ensure cross-isolate accuracy. Use on high-value endpoints. */
  shared?: boolean;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function requestIp(): string {
  const request = getRequest();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    forwarded ??
    "unknown"
  );
}

function pruneExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export async function assertRateLimit({
  scope,
  limit,
  windowMs,
  message,
  shared = false,
}: RateLimitOptions) {
  const now = Date.now();
  if (buckets.size > 10_000) pruneExpired(now);

  const ip = requestIp();
  const key = `${scope}:${ip}`;
  const bucket = buckets.get(key);

  // Tier 1: in-memory (fast, per-isolate).
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    // Fall through to Tier 2 if shared mode is on.
  } else if (bucket.count >= limit) {
    throw new Error(message);
  } else {
    bucket.count += 1;
  }

  // Tier 2: shared Supabase-backed check for cross-isolate accuracy.
  if (shared) {
    const result = await assertSharedRateLimit({ scope, key, limit, windowMs });
    if (!result.consumed) {
      // Undo the in-memory increment so retries aren't double-counted.
      const b = buckets.get(key);
      if (b && b.count > 0) b.count -= 1;
      throw new Error(message);
    }
    // Opportunistic cleanup of expired rows.
    void maybeCleanupExpiredRateLimits();
  }
}
