// Single source of truth for League shards (per-server) and their mapping
// to Riot's regional routing clusters used by the match-v5 API.
//
// The backend server function only accepts the 4 routing clusters
// (americas/europe/asia/sea), so on submit we translate the user-picked
// shard into its routing cluster via `shardToRouting`.

export type RoutingRegion = "americas" | "europe" | "asia" | "sea";

export type Shard =
  | "NA"
  | "BR"
  | "LAN"
  | "LAS"
  | "EUW"
  | "EUNE"
  | "RU"
  | "TR"
  | "ME"
  | "KR"
  | "JP"
  | "TW"
  | "OCE"
  | "SEA"
  | "TH"
  | "PH"
  | "VN";

export interface ShardInfo {
  code: Shard;
  /** Short label shown in the trigger pill (e.g. "NA"). */
  label: string;
  /** Country flag for country shards, region emoji for multi-country shards. */
  emoji: string;
  /** Long human name shown as muted secondary text in the dropdown. */
  fullName: string;
  /** Riot regional routing cluster this shard belongs to. */
  routing: RoutingRegion;
  /**
   * Riot platform host slug used for non-regional endpoints like
   * league-v4 (`/lol/league/v4/...`) — e.g. "na1", "euw1", "kr".
   */
  platform: string;
}

// Order within each group reflects rough player-base size for nicer UX.
export const SHARDS: ShardInfo[] = [
  // Americas
  {
    code: "NA",
    label: "NA",
    emoji: "🇺🇸",
    fullName: "North America",
    routing: "americas",
    platform: "na1",
  },
  {
    code: "BR",
    label: "BR",
    emoji: "🇧🇷",
    fullName: "Brazil",
    routing: "americas",
    platform: "br1",
  },
  {
    code: "LAN",
    label: "LAN",
    emoji: "🇲🇽",
    fullName: "Latin America North",
    routing: "americas",
    platform: "la1",
  },
  {
    code: "LAS",
    label: "LAS",
    emoji: "🇦🇷",
    fullName: "Latin America South",
    routing: "americas",
    platform: "la2",
  },

  // Europe
  {
    code: "EUW",
    label: "EUW",
    emoji: "🇪🇺",
    fullName: "Europe West",
    routing: "europe",
    platform: "euw1",
  },
  {
    code: "EUNE",
    label: "EUNE",
    emoji: "❄️",
    fullName: "Europe Nordic & East",
    routing: "europe",
    platform: "eun1",
  },
  { code: "RU", label: "RU", emoji: "🇷🇺", fullName: "Russia", routing: "europe", platform: "ru" },
  { code: "TR", label: "TR", emoji: "🇹🇷", fullName: "Turkey", routing: "europe", platform: "tr1" },
  {
    code: "ME",
    label: "ME",
    emoji: "🕌",
    fullName: "Middle East",
    routing: "europe",
    platform: "me1",
  },

  // Asia
  { code: "KR", label: "KR", emoji: "🇰🇷", fullName: "Korea", routing: "asia", platform: "kr" },
  { code: "JP", label: "JP", emoji: "🇯🇵", fullName: "Japan", routing: "asia", platform: "jp1" },
  { code: "TW", label: "TW", emoji: "🇹🇼", fullName: "Taiwan", routing: "asia", platform: "tw2" },

  // SEA
  { code: "OCE", label: "OCE", emoji: "🇦🇺", fullName: "Oceania", routing: "sea", platform: "oc1" },
  {
    code: "SEA",
    label: "SEA",
    emoji: "🇸🇬",
    fullName: "Singapore, Malaysia, Indonesia",
    routing: "sea",
    platform: "sg2",
  },
  { code: "TH", label: "TH", emoji: "🇹🇭", fullName: "Thailand", routing: "sea", platform: "th2" },
  {
    code: "PH",
    label: "PH",
    emoji: "🇵🇭",
    fullName: "Philippines",
    routing: "sea",
    platform: "ph2",
  },
  { code: "VN", label: "VN", emoji: "🇻🇳", fullName: "Vietnam", routing: "sea", platform: "vn2" },
];

/** O(1) lookup map built once at module load. */
const SHARD_BY_CODE: Record<string, ShardInfo> = SHARDS.reduce(
  (acc, s) => {
    acc[s.code] = s;
    return acc;
  },
  {} as Record<string, ShardInfo>,
);

/** Display label per routing cluster, used as group headings in the dropdown. */
export const ROUTING_LABELS: Record<RoutingRegion, { label: string; emoji: string }> = {
  americas: { label: "Americas", emoji: "🌎" },
  europe: { label: "Europe", emoji: "🌍" },
  asia: { label: "Asia", emoji: "🌏" },
  sea: { label: "SEA", emoji: "🏝️" },
};

/** Shards grouped by routing cluster, preserving SHARDS array order. */
export const SHARDS_BY_ROUTING: Record<RoutingRegion, ShardInfo[]> = SHARDS.reduce(
  (acc, s) => {
    (acc[s.routing] ||= []).push(s);
    return acc;
  },
  { americas: [], europe: [], asia: [], sea: [] } as Record<RoutingRegion, ShardInfo[]>,
);

/** Default shard used when nothing is selected / value is invalid. */
export const DEFAULT_SHARD: Shard = "NA";

/**
 * Resolve a shard to its routing cluster. Falls back to `americas` and warns
 * in the console for any unknown value (e.g. stale persisted state).
 */
export function shardToRouting(code: string): RoutingRegion {
  const info = SHARD_BY_CODE[code];
  if (!info) {
    console.warn(`[regions] Unknown shard "${code}", falling back to americas`);
    return "americas";
  }
  return info.routing;
}

/**
 * Resolve a shard to its platform host (used for non-regional Riot endpoints
 * like league-v4). Falls back to "na1" with a console warning for unknown
 * values so we never crash on stale persisted state.
 */
export function shardToPlatform(code: string): string {
  const info = SHARD_BY_CODE[code];
  if (!info) {
    console.warn(`[regions] Unknown shard "${code}", falling back to na1`);
    return "na1";
  }
  return info.platform;
}

/** Lookup full ShardInfo by code, or the default shard when unknown. */
export function getShardInfo(code: string): ShardInfo {
  return SHARD_BY_CODE[code] ?? SHARD_BY_CODE[DEFAULT_SHARD];
}
