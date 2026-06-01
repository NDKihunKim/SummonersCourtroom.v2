import { supabaseAdmin } from "@/integrations/supabase/client.server";

type RiotScope =
  | "americas"
  | "europe"
  | "asia"
  | "sea"
  | `host:${string}`;

const DEFAULT_RETRY_AFTER_SECONDS = 60;

const REGIONAL_HOSTS = new Set(["americas", "europe", "asia", "sea"]);

const PLATFORM_TO_REGIONAL: Record<string, RiotScope> = {
  br1: "americas",
  la1: "americas",
  la2: "americas",
  na1: "americas",
  euw1: "europe",
  eun1: "europe",
  tr1: "europe",
  ru: "europe",
  me1: "europe",
  jp1: "asia",
  kr: "asia",
  tw2: "asia",
  vn2: "asia",
  th2: "asia",
  ph2: "asia",
  sg2: "asia",
  oc1: "sea",
  pbe1: "americas",
};

function riotScopeFromUrl(url: string): RiotScope {
  try {
    const hostPrefix = new URL(url).hostname.split(".api.riotgames.com")[0]?.toLowerCase();
    if (!hostPrefix) return "host:unknown";
    if (REGIONAL_HOSTS.has(hostPrefix)) return hostPrefix as RiotScope;
    return PLATFORM_TO_REGIONAL[hostPrefix] ?? `host:${hostPrefix}`;
  } catch {
    return "host:unknown";
  }
}

function parseRetryAfterSeconds(value: string | null): number {
  if (!value) return DEFAULT_RETRY_AFTER_SECONDS;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(1, Math.ceil((dateMs - Date.now()) / 1000));
  }

  return DEFAULT_RETRY_AFTER_SECONDS;
}

function formatWait(seconds: number): string {
  if (seconds < 90) return "about a minute";
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minutes`;
}

async function getBlockedUntil(scope: RiotScope): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from("riot_rate_limit_backoffs")
    .select("blocked_until")
    .eq("scope", scope)
    .maybeSingle();

  if (error) {
    console.error("[riot-rate-limit] failed to read shared backoff:", error);
    return null;
  }

  if (!data?.blocked_until) return null;
  const blockedUntilMs = Date.parse(data.blocked_until);
  return Number.isFinite(blockedUntilMs) ? blockedUntilMs : null;
}

async function assertRiotBackoffOpen(scope: RiotScope) {
  const blockedUntilMs = await getBlockedUntil(scope);
  if (!blockedUntilMs) return;

  const remainingSeconds = Math.ceil((blockedUntilMs - Date.now()) / 1000);
  if (remainingSeconds > 0) {
    throw new Error(
      `Riot rate limit reached. Please wait ${formatWait(remainingSeconds)} and try again.`,
    );
  }
}

async function recordRiotBackoff(scope: RiotScope, retryAfterSeconds: number) {
  const nextBlockedUntilMs = Date.now() + retryAfterSeconds * 1000;
  const existingBlockedUntilMs = await getBlockedUntil(scope);
  const blockedUntil = new Date(Math.max(nextBlockedUntilMs, existingBlockedUntilMs ?? 0));

  const { error } = await supabaseAdmin.from("riot_rate_limit_backoffs").upsert({
    scope,
    blocked_until: blockedUntil.toISOString(),
    retry_after_seconds: retryAfterSeconds,
    source_status: 429,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[riot-rate-limit] failed to write shared backoff:", error);
  }
}

export async function fetchRiotWithBackoff(url: string, init?: RequestInit): Promise<Response> {
  const scope = riotScopeFromUrl(url);
  await assertRiotBackoffOpen(scope);

  const response = await fetch(url, init);
  if (response.status === 429) {
    const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"));
    await recordRiotBackoff(scope, retryAfterSeconds);
  }

  return response;
}
