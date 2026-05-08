/**
 * Server functions for the shared summoner cache.
 *
 * Backed by the `cached_summoners` Postgres table. Three responsibilities:
 *
 *   1. `getOrFetchMatchHistory` — cache-first read used by the search form.
 *      First DB hit ever for a Riot ID still goes to Riot; every subsequent
 *      visitor for the same ID renders instantly from cache. Search count
 *      is incremented on every call (cache hits + fresh fetches both count).
 *
 *   2. `refreshSummoner` — manual re-fetch driven by the ↻ button on the
 *      result page. Enforces a 30s cooldown PER PLAYER (not per user) so
 *      multiple visitors can't combine to abuse Riot's rate limit.
 *
 *   3. `getSuggestionsFromIndex` — autocomplete fallback that surfaces
 *      well-known players (search_count >= 2) on the current shard, sorted
 *      Challenger -> Iron via the DB-side `tier_rank` column.
 *
 * Riot data is public, so RLS on `cached_summoners` permits anonymous SELECT
 * but disallows writes from the client. All writes go through `supabaseAdmin`
 * which bypasses RLS — that's why every mutation lives in this server-only
 * file.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Match } from "@/lib/match-types";
import { shardToPlatform, shardToRouting } from "@/lib/regions";
import { parseDivision, parseTier, type Division, type Tier } from "@/lib/tier";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getLeagueEntriesByPuuid, pickSoloEntry } from "@/server/league";
import {
  fetchMatch,
  formatDuration,
  getSummonerByPuuid,
  listMatchIds,
  platformToRegional,
  queueName,
  relativeTime,
  resolveRiotId,
  spellName,
  type RegionalRouting,
  type RiotMatch,
  type RiotMatchParticipant,
} from "@/server/riot";

// ---------------------------------------------------------------------------
// Types & schemas
// ---------------------------------------------------------------------------

/**
 * Allowed shard codes — kept in sync with `Shard` from `@/lib/regions` but
 * duplicated here as a Zod literal union so the validator stays inline and
 * doesn't need a runtime cast. If we ever add a shard, add it both places.
 */
const ShardSchema = z.enum([
  "NA",
  "BR",
  "LAN",
  "LAS",
  "EUW",
  "EUNE",
  "RU",
  "TR",
  "ME",
  "KR",
  "JP",
  "TW",
  "OCE",
  "SEA",
  "TH",
  "PH",
  "VN",
]);

const RiotIdSchema = z.object({
  shard: ShardSchema,
  gameName: z.string().min(1).max(32),
  tagLine: z.string().min(2).max(8),
});

/** What the result page renders. Matches `GetMatchHistoryResult` in shape. */
export interface CachedSummonerPayload {
  account: { gameName: string; tagLine: string; puuid: string };
  matches: Match[];
  /** Ranked solo info; null when unranked. */
  ranked: { tier: Tier; division: Division | null; lp: number } | null;
  /**
   * Riot summoner-v4 profileIconId — drives the real Data Dragon avatar in
   * the result-page header. Null when the upstream summoner-v4 call failed
   * (best-effort) so the UI falls back to the letter avatar.
   */
  profileIconId: number | null;
  /** Epoch ms — when `matches` was last refreshed from Riot. */
  cachedAt: number;
  /** Epoch ms — earliest moment refresh is allowed again. */
  refreshAvailableAt: number;
  /** True if the response came from the DB cache (no Riot calls this request). */
  fromCache: boolean;
}

/** Per-player cooldown enforced server-side. Keep in one place. */
const REFRESH_COOLDOWN_MS = 30_000;
/**
 * How many matches we fetch + cache per player.
 *
 * Bumped to 30 so the Performance Block's sample-size selector (10 / 20 / 30)
 * always has a full window to slice from without an extra Riot round-trip.
 * The visible match list on the page is still capped at 10 by the UI
 * (see `MATCHES_VISIBLE` in `src/routes/index.tsx`); only the header stats
 * use the larger window.
 */
const MATCH_COUNT = 30;

// ---------------------------------------------------------------------------
// Riot fetcher (extracted from match-history.functions for reuse)
//
// Pulls account + matches + league entry in parallel where possible.
// ---------------------------------------------------------------------------

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 1000;
}

function displayName(p: RiotMatchParticipant): string {
  if (p.riotIdGameName && p.riotIdTagline) return `${p.riotIdGameName}#${p.riotIdTagline}`;
  if (p.riotIdGameName) return p.riotIdGameName;
  return p.summonerName || "Unknown";
}

function extractRunes(
  p: RiotMatchParticipant,
): { keystoneId: number; secondaryStyleId: number } | undefined {
  const styles = p.perks?.styles;
  if (!styles || styles.length === 0) return undefined;
  const primary = styles.find((s) => s.description === "primaryStyle") ?? styles[0];
  const sub = styles.find((s) => s.description === "subStyle") ?? styles[1];
  const keystoneId = primary?.selections?.[0]?.perk;
  const secondaryStyleId = sub?.style;
  if (!keystoneId || !secondaryStyleId) return undefined;
  return { keystoneId, secondaryStyleId };
}

function normaliseMatch(
  raw: RiotMatch,
  userPuuid: string,
  fallbackRouting: RegionalRouting,
): Match | null {
  const me = raw.info.participants.find((p) => p.puuid === userPuuid);
  if (!me) return null;
  const allies = raw.info.participants.filter(
    (p) => p.teamId === me.teamId && p.puuid !== userPuuid,
  );
  const enemies = raw.info.participants.filter((p) => p.teamId !== me.teamId);
  const playedAtMs = raw.info.gameEndTimestamp ?? raw.info.gameCreation;
  const routing = platformToRegional(raw.info.platformId) ?? fallbackRouting;
  return {
    id: raw.metadata.matchId,
    queue: queueName(raw.info.queueId),
    result: me.win ? "Victory" : "Defeat",
    duration: formatDuration(raw.info.gameDuration),
    playedAt: relativeTime(playedAtMs),
    champion: me.championName,
    championIconSeed: hashSeed(me.championName + me.puuid),
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    cs: me.totalMinionsKilled + me.neutralMinionsKilled,
    gold: me.goldEarned,
    damage: me.totalDamageDealtToChampions,
    vision: me.visionScore,
    // Preserve positional empties (0) so the inventory grid keeps its 3x2 layout.
    items: [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5],
    trinket: me.item6 ?? 0,
    spells: [spellName(me.summoner1Id), spellName(me.summoner2Id)],
    runes: extractRunes(me),
    team: allies.map((p) => ({
      champion: p.championName,
      summoner: displayName(p),
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      puuid: p.puuid,
      teamId: p.teamId as 100 | 200,
      teamPosition: p.teamPosition ?? "",
    })),
    enemies: enemies.map((p) => ({
      champion: p.championName,
      summoner: displayName(p),
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      puuid: p.puuid,
      teamId: p.teamId as 100 | 200,
      teamPosition: p.teamPosition ?? "",
    })),
    riotMatchId: raw.metadata.matchId,
    userPuuid,
    routingRegion: routing,
    userTeamId: me.teamId as 100 | 200,
    userTeamPosition: me.teamPosition ?? "",
  };
}

/**
 * Hit Riot for everything we need to populate or refresh a cache row.
 * League-v4 failures are tolerated (we still return account + matches with
 * `ranked: null`) because tier is best-effort and shouldn't block the page.
 */
async function fetchFreshFromRiot(
  shard: z.infer<typeof ShardSchema>,
  gameName: string,
  tagLine: string,
) {
  const routing = shardToRouting(shard) as RegionalRouting;
  const platform = shardToPlatform(shard);

  // Account first — we need its puuid for the other two calls.
  const account = await resolveRiotId(gameName, tagLine, routing);

  // Match list, league entry and summoner profile can all run in parallel.
  // Summoner is best-effort — failures resolve to null so the page still
  // renders with the letter-avatar fallback.
  const [matchIds, leagueEntries, summoner] = await Promise.all([
    listMatchIds(account.puuid, routing, MATCH_COUNT),
    getLeagueEntriesByPuuid(account.puuid, platform).catch((err) => {
      console.error("league-v4 fetch failed (best-effort, ignored):", err);
      return [] as Awaited<ReturnType<typeof getLeagueEntriesByPuuid>>;
    }),
    getSummonerByPuuid(account.puuid, platform).catch((err) => {
      console.error("summoner-v4 fetch failed (best-effort, ignored):", err);
      return null;
    }),
  ]);

  // Fetch each match in parallel; tolerate individual failures.
  const settled = await Promise.allSettled(matchIds.map((id) => fetchMatch(id, routing)));
  const matches: Match[] = [];
  for (const s of settled) {
    if (s.status !== "fulfilled") {
      console.error("match fetch failed:", s.reason);
      continue;
    }
    const m = normaliseMatch(s.value, account.puuid, routing);
    if (m) matches.push(m);
  }

  const solo = pickSoloEntry(leagueEntries);
  const ranked =
    solo && parseTier(solo.tier)
      ? {
          tier: parseTier(solo.tier)!,
          division: parseDivision(solo.rank),
          lp: solo.leaguePoints ?? 0,
        }
      : null;

  return {
    account,
    matches,
    ranked,
    profileIconId: summoner?.profileIconId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Cache row helpers
// ---------------------------------------------------------------------------

/**
 * Convert a DB row into the shape the UI expects. Uses defensive parsers so
 * a bogus tier string or malformed `matches` JSON doesn't crash the page.
 */
function rowToPayload(
  row: {
    puuid: string;
    game_name: string;
    tag_line: string;
    tier: string | null;
    division: string | null;
    lp: number | null;
    matches: unknown;
    cached_at: string;
    last_refresh_at: string;
    profile_icon_id: number | null;
  },
  fromCache: boolean,
): CachedSummonerPayload {
  const tier = parseTier(row.tier);
  const ranked = tier ? { tier, division: parseDivision(row.division), lp: row.lp ?? 0 } : null;

  // `matches` is JSONB — could in theory be malformed if hand-edited.
  const matches = Array.isArray(row.matches) ? (row.matches as Match[]) : [];

  const cachedAt = new Date(row.cached_at).getTime();
  const lastRefresh = new Date(row.last_refresh_at).getTime();
  return {
    account: { gameName: row.game_name, tagLine: row.tag_line, puuid: row.puuid },
    matches,
    ranked,
    profileIconId: row.profile_icon_id,
    cachedAt,
    refreshAvailableAt: lastRefresh + REFRESH_COOLDOWN_MS,
    fromCache,
  };
}

/**
 * Look up an existing cache row by (shard, lower(name)#lower(tag)).
 * We can't key by puuid here because the user gives us a name — so we use
 * the lowercase functional index on game_name and filter by tag client-side
 * (small set, avoids a second functional index for tag).
 */
async function findCachedByRiotId(shard: string, gameName: string, tagLine: string) {
  const { data, error } = await supabaseAdmin
    .from("cached_summoners")
    .select(
      "puuid, game_name, tag_line, tier, division, lp, matches, cached_at, last_refresh_at, profile_icon_id",
    )
    .eq("shard", shard)
    // ilike on the indexed lower(game_name) — tag check is cheap in JS below.
    .ilike("game_name", gameName)
    .limit(5);

  if (error) {
    console.error("[summoner-cache] lookup failed:", error);
    return null;
  }
  const lowerTag = tagLine.toLowerCase();
  return data?.find((row) => row.tag_line.toLowerCase() === lowerTag) ?? null;
}

/**
 * Upsert a fresh Riot payload into the cache. Increments `search_count`
 * atomically by reading-then-writing; if multiple writes race the worst
 * case is one count being lost, which is acceptable for a soft popularity
 * signal.
 */
async function upsertCache(
  shard: string,
  fresh: Awaited<ReturnType<typeof fetchFreshFromRiot>>,
  isRefresh: boolean,
) {
  // Read existing search_count so we can increment it atomically-ish.
  const { data: existing } = await supabaseAdmin
    .from("cached_summoners")
    .select("search_count")
    .eq("shard", shard)
    .eq("puuid", fresh.account.puuid)
    .maybeSingle();

  const nextCount = (existing?.search_count ?? 0) + 1;
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin.from("cached_summoners").upsert(
    {
      shard,
      puuid: fresh.account.puuid,
      game_name: fresh.account.gameName,
      tag_line: fresh.account.tagLine,
      tier: fresh.ranked?.tier ?? null,
      division: fresh.ranked?.division ?? null,
      lp: fresh.ranked?.lp ?? null,
      queue_type: "RANKED_SOLO_5x5",
      search_count: nextCount,
      cached_at: now,
      last_refresh_at: now,
      // Real summoner profile icon (best-effort — null when summoner-v4 failed).
      profile_icon_id: fresh.profileIconId,
      // JSONB column — cast through unknown so TS accepts the structured
      // payload as the generated `Json` alias.
      matches: fresh.matches as unknown as never,
    },
    { onConflict: "shard,puuid" },
  );

  if (error) {
    // Cache write failures are non-fatal — we still want to serve the data
    // we just fetched. Log and move on.
    console.error("[summoner-cache] upsert failed:", error, { isRefresh });
  }

  return new Date(now).getTime();
}

/**
 * Bump the search_count on a cache hit (read-only path). Failures are
 * silenced — popularity is a soft signal and shouldn't break the page.
 */
async function bumpSearchCount(shard: string, puuid: string) {
  const { data: existing } = await supabaseAdmin
    .from("cached_summoners")
    .select("search_count")
    .eq("shard", shard)
    .eq("puuid", puuid)
    .maybeSingle();
  if (!existing) return;
  await supabaseAdmin
    .from("cached_summoners")
    .update({ search_count: (existing.search_count ?? 0) + 1 })
    .eq("shard", shard)
    .eq("puuid", puuid);
}

// ---------------------------------------------------------------------------
// Public server functions
// ---------------------------------------------------------------------------

/**
 * Cache-first match-history fetch. Used by the search form's submit handler.
 * Always returns a payload — falls back to a fresh Riot fetch when the cache
 * is empty or the cache row is unusable.
 */
export const getOrFetchMatchHistory = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => RiotIdSchema.parse(input))
  .handler(async ({ data }): Promise<CachedSummonerPayload> => {
    // 1. Try the cache.
    const row = await findCachedByRiotId(data.shard, data.gameName, data.tagLine);
    if (row && Array.isArray(row.matches) && row.matches.length > 0) {
      // Bump search_count in the background — don't block the response.
      bumpSearchCount(data.shard, row.puuid).catch((err) =>
        console.error("[summoner-cache] bump failed:", err),
      );
      return rowToPayload(row, /* fromCache */ true);
    }

    // 2. Cache miss (or empty matches) → fetch fresh from Riot.
    const fresh = await fetchFreshFromRiot(data.shard, data.gameName, data.tagLine);
    const cachedAtMs = await upsertCache(data.shard, fresh, /* isRefresh */ false);

    return {
      account: fresh.account,
      matches: fresh.matches,
      ranked: fresh.ranked,
      profileIconId: fresh.profileIconId,
      cachedAt: cachedAtMs,
      refreshAvailableAt: cachedAtMs + REFRESH_COOLDOWN_MS,
      fromCache: false,
    };
  });

/**
 * Force-refresh a player from Riot, respecting the per-player cooldown.
 * Throws a descriptive error when the cooldown is still active so the UI
 * can surface it as a toast.
 */
export const refreshSummoner = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => RiotIdSchema.parse(input))
  .handler(async ({ data }): Promise<CachedSummonerPayload> => {
    // Read existing row to enforce cooldown without doing a Riot call first.
    const row = await findCachedByRiotId(data.shard, data.gameName, data.tagLine);
    if (row) {
      const lastRefresh = new Date(row.last_refresh_at).getTime();
      const remaining = lastRefresh + REFRESH_COOLDOWN_MS - Date.now();
      if (remaining > 0) {
        const seconds = Math.ceil(remaining / 1000);
        throw new Error(`Refresh on cooldown — try again in ${seconds}s.`);
      }
    }

    const fresh = await fetchFreshFromRiot(data.shard, data.gameName, data.tagLine);
    const cachedAtMs = await upsertCache(data.shard, fresh, /* isRefresh */ true);

    return {
      account: fresh.account,
      matches: fresh.matches,
      ranked: fresh.ranked,
      profileIconId: fresh.profileIconId,
      cachedAt: cachedAtMs,
      refreshAvailableAt: cachedAtMs + REFRESH_COOLDOWN_MS,
      fromCache: false,
    };
  });

// ---------------------------------------------------------------------------
// Suggestions (shared index)
// ---------------------------------------------------------------------------

const SuggestionsInputSchema = z.object({
  shard: ShardSchema,
  /** Trimmed query — empty means "top players on this shard". */
  query: z.string().max(32),
  /** Lowercase "name#tag" keys already shown via local recents — deduped out. */
  excludeKeys: z.array(z.string().max(64)).max(50).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

export interface IndexSuggestion {
  gameName: string;
  tagLine: string;
  shard: string;
  tier: Tier | null;
  division: Division | null;
  lp: number | null;
  searchCount: number;
  /** Real Riot profile icon id — null for old rows pre-backfill. */
  profileIconId: number | null;
}

/** Lowercase dedupe key matching what the client uses for local recents. */
function indexKey(name: string, tag: string): string {
  return `${name.toLowerCase()}#${tag.toLowerCase()}`;
}

/**
 * Suggest players from the shared index for the autocomplete dropdown.
 *
 * - Always shard-scoped.
 * - Requires `search_count >= 2` so one-off typos don't pollute results.
 * - Sorted Challenger -> Iron via the DB-side `tier_rank` column, then by
 *   popularity (`search_count desc`).
 * - Empty query => top N regardless of name (lets users discover popular
 *   players on small shards).
 */
export const getSuggestionsFromIndex = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SuggestionsInputSchema.parse(input))
  .handler(async ({ data }): Promise<IndexSuggestion[]> => {
    const limit = data.limit ?? 5;
    const trimmed = data.query.trim();
    const exclude = new Set((data.excludeKeys ?? []).map((k) => k.toLowerCase()));

    let query = supabaseAdmin
      .from("cached_summoners")
      .select("game_name, tag_line, shard, tier, division, lp, search_count, profile_icon_id")
      .eq("shard", data.shard)
      .gte("search_count", 2)
      .order("tier_rank", { ascending: false })
      .order("search_count", { ascending: false })
      // Over-fetch a bit so we still hit `limit` after dedupe.
      .limit(limit + exclude.size + 5);

    if (trimmed.length > 0) {
      // Prefix match on the indexed lower(game_name). ilike + escape user
      // input so % and _ don't act as wildcards.
      const safe = trimmed.replace(/[%_\\]/g, (c) => `\\${c}`);
      query = query.ilike("game_name", `${safe}%`);
    }

    const { data: rows, error } = await query;
    if (error) {
      console.error("[summoner-cache] suggestions query failed:", error);
      return [];
    }
    if (!rows) return [];

    const out: IndexSuggestion[] = [];
    for (const row of rows) {
      const key = indexKey(row.game_name, row.tag_line);
      if (exclude.has(key)) continue;
      out.push({
        gameName: row.game_name,
        tagLine: row.tag_line,
        shard: row.shard,
        tier: parseTier(row.tier),
        division: parseDivision(row.division),
        lp: row.lp,
        searchCount: row.search_count,
        profileIconId: row.profile_icon_id,
      });
      if (out.length >= limit) break;
    }
    return out;
  });

// ---------------------------------------------------------------------------
// Cache enrichment for local recents
//
// Local "recent" searches are stored in the browser only and don't carry
// cached profile/ranked metadata. To render the real Data Dragon avatar and
// tier crest in the autocomplete dropdown, we look those keys up in the shared
// `cached_summoners` table. Missing keys are simply absent from the returned
// map → the UI falls back to the local-only row.
// ---------------------------------------------------------------------------

const RecentMetadataKeysSchema = z.object({
  shard: ShardSchema,
  keys: z
    .array(
      z.object({
        gameName: z.string().min(1).max(32),
        tagLine: z.string().min(2).max(8),
      }),
    )
    .min(1)
    .max(20),
});

export type RecentMetadata = {
  tier: Tier | null;
  division: Division | null;
  lp: number | null;
  profileIconId: number | null;
};

/** Map key shape: lowercased "name#tag" → cached metadata. */
export type RecentMetadataMap = Record<string, RecentMetadata>;

export const getRecentMetadataForKeys = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => RecentMetadataKeysSchema.parse(input))
  .handler(async ({ data }): Promise<RecentMetadataMap> => {
    // Build a lookup of requested keys (lowercased) for O(1) filtering of
    // the rows we get back. Postgres `ilike` is case-insensitive so the IN
    // list below uses the original-cased names; we de-dupe by lowercased key
    // here to keep the IN list small.
    const requested = new Set<string>();
    const names = new Set<string>();
    for (const k of data.keys) {
      requested.add(indexKey(k.gameName, k.tagLine));
      names.add(k.gameName);
    }

    const { data: rows, error } = await supabaseAdmin
      .from("cached_summoners")
      .select("game_name, tag_line, tier, division, lp, profile_icon_id")
      .eq("shard", data.shard)
      .in("game_name", Array.from(names))
      // Belt-and-suspenders: cap result size in case of casing collisions
      // across many tag lines for the same name.
      .limit(50);

    if (error) {
      console.error("[summoner-cache] recent metadata lookup failed:", error);
      return {};
    }

    const out: RecentMetadataMap = {};
    for (const row of rows ?? []) {
      const key = indexKey(row.game_name, row.tag_line);
      // Only return keys the caller actually asked about — avoids leaking
      // unrelated rows that happen to share a game_name (case variants etc).
      if (!requested.has(key)) continue;
      out[key] = {
        tier: parseTier(row.tier),
        division: parseDivision(row.division),
        lp: row.lp,
        profileIconId: row.profile_icon_id,
      };
    }
    return out;
  });
