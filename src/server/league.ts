/**
 * Server-only Riot League-v4 client.
 *
 * League-v4 lives on the PLATFORM host (e.g. na1.api.riotgames.com), not the
 * regional cluster — so callers must pass a platform slug ("na1", "kr", ...)
 * which we derive from the user's selected shard via `shardToPlatform`.
 *
 * IMPORTANT: this file uses RIOT_API_KEY from process.env. Only import it
 * from `createServerFn` handlers — never from client/route components.
 */

/** Subset of the league-v4 entry payload we actually use. */
export interface LeagueEntry {
  queueType: string;
  tier: string;
  rank: string; // Roman-numeral division ("I".."IV")
  leaguePoints: number;
  wins: number;
  losses: number;
}

function apiKey(): string {
  const key = process.env.RIOT_API_KEY;
  if (!key) throw new Error("RIOT_API_KEY is not configured on the server.");
  return key;
}

/**
 * Fetch all ranked queue entries for a puuid on a given platform.
 *
 * Returns `[]` when the player is unranked (Riot returns an empty array, not
 * a 404). Throws on transport / auth / rate-limit errors so the caller can
 * decide whether to swallow them (we treat tier as best-effort).
 */
export async function getLeagueEntriesByPuuid(
  puuid: string,
  platform: string,
): Promise<LeagueEntry[]> {
  const url = `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`;
  const res = await fetch(url, { headers: { "X-Riot-Token": apiKey() } });
  if (!res.ok) {
    // 404 from this endpoint is unusual but treat as "no entries" defensively.
    if (res.status === 404) return [];
    const text = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Riot ${res.status}: API key rejected (expired or invalid).`);
    }
    if (res.status === 429) throw new Error("Riot rate limit hit. Try again in a minute.");
    throw new Error(`Riot ${res.status}: ${text || res.statusText}`);
  }
  const data = (await res.json()) as LeagueEntry[];
  return Array.isArray(data) ? data : [];
}

/**
 * Pick the player's RANKED_SOLO_5x5 entry from a league-v4 response.
 * Returns `null` if they're unranked in solo queue (even if they have flex).
 */
export function pickSoloEntry(entries: LeagueEntry[]): LeagueEntry | null {
  return entries.find((e) => e.queueType === "RANKED_SOLO_5x5") ?? null;
}
