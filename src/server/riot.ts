/**
 * Server-only Riot Games API client.
 *
 * IMPORTANT: this file uses RIOT_API_KEY from process.env. Only import it from
 * `createServerFn` handlers — never from client/route components.
 */
import { fetchRiotWithBackoff } from "./riot-rate-limit-backoff";

export type RegionalRouting = "americas" | "europe" | "asia" | "sea";

export const REGIONAL_ROUTINGS: RegionalRouting[] = ["americas", "europe", "asia", "sea"];

const PLATFORM_TO_REGIONAL: Record<string, RegionalRouting> = {
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

export function platformToRegional(platform: string): RegionalRouting | undefined {
  return PLATFORM_TO_REGIONAL[platform.toLowerCase()];
}

function apiKey(): string {
  const key = process.env.RIOT_API_KEY;
  if (!key) throw new Error("RIOT_API_KEY is not configured on the server.");
  return key;
}

async function riotGet<T>(url: string): Promise<T> {
  const res = await fetchRiotWithBackoff(url, {
    headers: { "X-Riot-Token": apiKey() },
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("Riot data not found. Check the Riot ID, tag, region, or match id.");
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("Riot API access is currently unavailable. Please try again later.");
    }
    if (res.status === 429) {
      throw new Error("Riot rate limit reached. Please wait a minute and try again.");
    }
    throw new Error("Riot service error. Please try again later.");
  }
  return (await res.json()) as T;
}

export type RiotAccount = { puuid: string; gameName: string; tagLine: string };

export function resolveRiotId(
  gameName: string,
  tagLine: string,
  routing: RegionalRouting,
): Promise<RiotAccount> {
  const g = encodeURIComponent(gameName);
  const t = encodeURIComponent(tagLine);
  return riotGet<RiotAccount>(
    `https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${g}/${t}`,
  );
}

export function listMatchIds(
  puuid: string,
  routing: RegionalRouting,
  count = 10,
): Promise<string[]> {
  return riotGet<string[]>(
    `https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`,
  );
}

// --- Summoner-v4 ----------------------------------------------------------

/**
 * Subset of summoner-v4's response we care about. Full schema:
 * https://developer.riotgames.com/apis#summoner-v4
 */
export type RiotSummoner = {
  puuid: string;
  profileIconId: number;
  summonerLevel: number;
};

/**
 * Fetch a summoner's profileIconId + level by PUUID. Lives on the platform
 * routing host (na1, euw1, etc.) — NOT the regional cluster used by
 * account-v1 / match-v5.
 *
 * Used to populate the real Data Dragon profile icon for the searched
 * player. League-v4 / match data lookups should NOT depend on this — call
 * sites should treat a failure as best-effort and fall back to the letter
 * avatar.
 */
export function getSummonerByPuuid(puuid: string, platform: string): Promise<RiotSummoner> {
  return riotGet<RiotSummoner>(
    `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`,
  );
}

// Minimal subset of match-v5 we use. Full schema: https://developer.riotgames.com/apis#match-v5
export type RiotMatchParticipant = {
  puuid: string;
  riotIdGameName?: string;
  riotIdTagline?: string;
  summonerName?: string;
  championName: string;
  champLevel: number;
  kills: number;
  deaths: number;
  assists: number;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  goldEarned: number;
  totalDamageDealtToChampions: number;
  visionScore: number;
  win: boolean;
  teamId: number;
  summoner1Id: number;
  summoner2Id: number;
  item0: number;
  item1: number;
  item2: number;
  item3: number;
  item4: number;
  item5: number;
  item6: number;
  /**
   * Riot's assigned role for ranked games:
   *   "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY"
   * May be empty string for remakes / blind queues. Optional so non-SR
   * queues that omit it don't break parsing.
   */
  teamPosition?: string;
  /**
   * Rune selections. Two entries: primaryStyle (keystone tree) and subStyle
   * (secondary tree). Optional because some non-SR queues / older matches
   * may omit it. We surface only the keystone perk + secondary tree id.
   */
  perks?: {
    styles?: Array<{
      description?: string; // "primaryStyle" | "subStyle"
      style?: number; // tree id (8000, 8100, 8200, 8300, 8400)
      selections?: Array<{ perk?: number }>;
    }>;
  };
};

export type RiotMatch = {
  metadata: { matchId: string; participants: string[] };
  info: {
    gameDuration: number;
    gameEndTimestamp?: number;
    gameCreation: number;
    queueId: number;
    platformId: string;
    participants: RiotMatchParticipant[];
  };
};

export function fetchMatch(matchId: string, routing: RegionalRouting): Promise<RiotMatch> {
  return riotGet<RiotMatch>(
    `https://${routing}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
  );
}

// --- Helpers used by the normaliser ---------------------------------------

const QUEUE_NAMES: Record<number, string> = {
  400: "Normal Draft",
  420: "Ranked Solo",
  430: "Normal Blind",
  440: "Ranked Flex",
  450: "ARAM",
  480: "Swiftplay",
  490: "Quickplay",
  700: "Clash",
  720: "ARAM Clash",
  830: "Co-op vs AI Intro",
  840: "Co-op vs AI Beginner",
  850: "Co-op vs AI Intermediate",
  870: "Co-op vs AI Intro",
  880: "Co-op vs AI Beginner",
  890: "Co-op vs AI Intermediate",
  900: "URF",
  1020: "One for All",
  1300: "Nexus Blitz",
  1400: "Ultimate Spellbook",
  1700: "Arena",
  1710: "Arena",
  1810: "Swarm",
  1820: "Swarm",
  1830: "Swarm",
  1840: "Swarm",
  1900: "URF",
  2300: "Brawl",
  2400: "ARAM: Mayhem",
};

export function queueName(queueId: number): string {
  return QUEUE_NAMES[queueId] ?? `Queue ${queueId}`;
}

export function isCustomGameQueue(queueId: number): boolean {
  return queueId === 0;
}

const SUMMONER_SPELLS: Record<number, string> = {
  1: "Cleanse",
  3: "Exhaust",
  4: "Flash",
  6: "Ghost",
  7: "Heal",
  11: "Smite",
  12: "Teleport",
  13: "Clarity",
  14: "Ignite",
  21: "Barrier",
  32: "Mark",
};

export function spellName(id: number): string {
  return SUMMONER_SPELLS[id] ?? "?";
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function relativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 60_000) return "Just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
