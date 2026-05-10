import { getRequest } from "@tanstack/react-start/server";

type RateLimitOptions = {
  scope: string;
  limit: number;
  windowMs: number;
  message: string;
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

export function assertRateLimit({ scope, limit, windowMs, message }: RateLimitOptions) {
  const now = Date.now();
  if (buckets.size > 10_000) pruneExpired(now);

  const key = `${scope}:${requestIp()}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (bucket.count >= limit) {
    throw new Error(message);
  }

  bucket.count += 1;
}
