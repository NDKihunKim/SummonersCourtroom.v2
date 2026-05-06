/**
 * Data Dragon helpers — turns champion / profile-icon ids into the right
 * CDN URL for the current League patch.
 *
 * Why a dedicated module:
 *   - Champion icon URLs are versioned per patch (e.g. ".../14.24.1/img/...")
 *     so we have to know the latest patch to avoid 404s after Riot ships one.
 *   - A handful of champions use legacy filenames that don't match the
 *     pretty in-game name we store (e.g. "Wukong" → "MonkeyKing"). Those
 *     overrides live in ONE place here so every consumer agrees.
 *
 * Client-safe — pure URL construction + a single GET to the public versions
 * manifest. No Riot API key, no server-only deps.
 */

import { useQuery } from "@tanstack/react-query";

/**
 * Fallback patch used when the versions manifest fetch fails (offline,
 * blocked, etc.). Bump occasionally so the fallback doesn't go years stale,
 * but the live fetch should normally win on first load.
 */
export const DDRAGON_FALLBACK_VERSION = "14.24.1";

/** Public Data Dragon CDN root. */
const CDN_ROOT = "https://ddragon.leagueoflegends.com/cdn";

/** sessionStorage key for caching the resolved version across navigations. */
const SESSION_KEY = "riftlog:ddragon-version";

/**
 * Map of champion display names → Data Dragon filename when they differ.
 *
 * Most champions (Ahri, Lux, etc.) match exactly. The list below covers the
 * known mismatches as of the current League roster. Add new entries here
 * when Riot ships a champion with a name that doesn't normalise cleanly.
 */
const CHAMPION_FILENAME_OVERRIDES: Record<string, string> = {
  Wukong: "MonkeyKing",
  // Multi-word names — Data Dragon strips spaces & punctuation.
  "Cho'Gath": "Chogath",
  "Kai'Sa": "Kaisa",
  "Kha'Zix": "Khazix",
  "Kog'Maw": "KogMaw",
  "LeBlanc": "Leblanc",
  "Vel'Koz": "Velkoz",
  "Rek'Sai": "RekSai",
  "K'Sante": "KSante",
  "Bel'Veth": "Belveth",
  "Nunu & Willump": "Nunu",
  "Renata Glasc": "Renata",
  "Tahm Kench": "TahmKench",
  "Twisted Fate": "TwistedFate",
  "Master Yi": "MasterYi",
  "Miss Fortune": "MissFortune",
  "Aurelion Sol": "AurelionSol",
  "Dr. Mundo": "DrMundo",
  "Jarvan IV": "JarvanIV",
  "Lee Sin": "LeeSin",
  "Xin Zhao": "XinZhao",
};

/**
 * Normalise a champion display name to its Data Dragon filename.
 * Falls back to a "strip non-letters" transform so unknown new champs still
 * have a chance of resolving correctly without code changes.
 */
export function championFilename(championName: string): string {
  if (!championName) return "";
  const direct = CHAMPION_FILENAME_OVERRIDES[championName];
  if (direct) return direct;
  // Generic safety net: strip apostrophes, spaces, punctuation. Matches
  // Data Dragon's convention for the majority of names that aren't in the
  // override table.
  return championName.replace(/[^A-Za-z0-9]/g, "");
}

/** Build the champion square icon URL for a given patch. */
export function championIconUrl(championName: string, version: string): string {
  const file = championFilename(championName);
  return `${CDN_ROOT}/${version}/img/champion/${file}.png`;
}

/** Build the summoner profile icon URL for a given patch. */
export function profileIconUrl(iconId: number, version: string): string {
  return `${CDN_ROOT}/${version}/img/profileicon/${iconId}.png`;
}

/**
 * Build the item icon URL for a given patch.
 * Item ids come straight from match-v5 participant.item0..item6 fields.
 * Caller is responsible for skipping `0` (empty slot) before calling this.
 */
export function itemIconUrl(itemId: number, version: string): string {
  return `${CDN_ROOT}/${version}/img/item/${itemId}.png`;
}

/**
 * Map of summoner-spell display names (as stored on `match.spells`) to their
 * Data Dragon filename stem. Data Dragon prefixes every spell file with
 * "Summoner" and uses internal codenames for a few spells where the in-game
 * name doesn't match (e.g. Ignite -> SummonerDot).
 *
 * Add an entry here whenever Riot ships a new summoner spell or rotates
 * one into a queue (e.g. ARAM "Mark/Dash" -> SummonerSnowball).
 */
const SUMMONER_SPELL_FILENAMES: Record<string, string> = {
  Flash: "SummonerFlash",
  Teleport: "SummonerTeleport",
  Ignite: "SummonerDot",
  Heal: "SummonerHeal",
  Exhaust: "SummonerExhaust",
  Smite: "SummonerSmite",
  Ghost: "SummonerHaste",
  Cleanse: "SummonerBoost",
  Clarity: "SummonerMana",
  Barrier: "SummonerBarrier",
  Mark: "SummonerSnowball", // ARAM "Mark/Dash"
};

/**
 * Build the summoner-spell icon URL for a given patch.
 * Returns `null` for unknown / unmapped spell names (e.g. the "?" fallback
 * from the server when Riot ships a brand-new spell id) so callers can
 * render an empty-tile placeholder instead of a broken image.
 */
export function summonerSpellIconUrl(spellName: string, version: string): string | null {
  const file = SUMMONER_SPELL_FILENAMES[spellName];
  if (!file) return null;
  return `${CDN_ROOT}/${version}/img/spell/${file}.png`;
}

/**
 * Read a previously cached version from sessionStorage. Best-effort — never
 * throws (SSR, private mode, blocked storage all return undefined).
 */
function readCachedVersion(): string | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    const v = window.sessionStorage.getItem(SESSION_KEY);
    return v && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedVersion(v: string): void {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(SESSION_KEY, v);
  } catch {
    /* private mode / quota — ignore */
  }
}

/**
 * Fetch the current patch from Riot's versions manifest. Returns the
 * fallback on any failure so callers always get a usable string.
 */
export async function fetchLatestDDragonVersion(): Promise<string> {
  try {
    const res = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
    if (!res.ok) return DDRAGON_FALLBACK_VERSION;
    const json = (await res.json()) as unknown;
    if (Array.isArray(json) && typeof json[0] === "string") {
      writeCachedVersion(json[0]);
      return json[0];
    }
    return DDRAGON_FALLBACK_VERSION;
  } catch {
    return DDRAGON_FALLBACK_VERSION;
  }
}

/**
 * Hook returning the current Data Dragon patch version.
 *
 * - Returns the sessionStorage-cached value synchronously when available so
 *   the very first render of an icon doesn't flicker through the fallback.
 * - Otherwise React Query fetches once per session (`staleTime: Infinity`)
 *   and updates all consumers via the cache key.
 * - Always returns a string (never null/undefined) so consumers can build
 *   URLs without conditional rendering.
 */
export function useDDragonVersion(): string {
  const cached = readCachedVersion();
  const { data } = useQuery({
    queryKey: ["ddragon-version"],
    queryFn: fetchLatestDDragonVersion,
    // Sessionstorage value seeds the cache so we don't fetch again this tab.
    initialData: cached,
    // Patches drop ~every 2 weeks — fine to cache for the whole session.
    staleTime: Infinity,
    // No need to refetch on focus/mount — version barely moves.
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  return data ?? cached ?? DDRAGON_FALLBACK_VERSION;
}