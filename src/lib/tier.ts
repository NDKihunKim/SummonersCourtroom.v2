// Tier model — single source of truth for League ranked tier representation.
//
// Used by:
//   - The cached_summoners table (tier/division/lp columns mirror these names)
//   - The autocomplete dropdown (tier badge + sort)
//   - The match-history page header (tier badge next to the Riot ID)
//
/** Riot tier names. `null` = unranked. */
export type Tier =
  | "CHALLENGER"
  | "GRANDMASTER"
  | "MASTER"
  | "DIAMOND"
  | "EMERALD"
  | "PLATINUM"
  | "GOLD"
  | "SILVER"
  | "BRONZE"
  | "IRON";

/** Roman-numeral division. Apex tiers (Master+) don't have one. */
export type Division = "I" | "II" | "III" | "IV";

export interface RankedEntry {
  tier: Tier | null;
  division: Division | null;
  /** League points 0–99 (or higher in apex tiers). */
  lp: number | null;
}

export interface RankedEntries {
  solo: RankedEntry | null;
  flex: RankedEntry | null;
}

/** Apex tiers omit divisions. */
const APEX: ReadonlySet<Tier> = new Set(["CHALLENGER", "GRANDMASTER", "MASTER"]);

/**
 * Compute a single sortable integer for a ranked entry — must match the
 * `compute_tier_rank` SQL function in the cached_summoners migration so
 * client-side and DB-side sort orders agree.
 *
 * Higher = better. Unranked → 0.
 */
export function tierRank(entry: RankedEntry | null | undefined): number {
  if (!entry || !entry.tier) return 0;
  const tier = entry.tier;
  const lp = entry.lp ?? 0;

  // Apex tiers: base + raw LP (capped per bucket so they don't overflow).
  if (tier === "CHALLENGER") return 10000 + Math.min(lp, 9999);
  if (tier === "GRANDMASTER") return 9000 + Math.min(lp, 999);
  if (tier === "MASTER") return 8000 + Math.min(lp, 999);

  // Divisional tiers: base + division offset + half-LP nudge.
  const base: Record<Exclude<Tier, "CHALLENGER" | "GRANDMASTER" | "MASTER">, number> = {
    DIAMOND: 7000,
    EMERALD: 6000,
    PLATINUM: 5000,
    GOLD: 4000,
    SILVER: 3000,
    BRONZE: 2000,
    IRON: 1000,
  };
  const divOffset: Record<Division, number> = { I: 400, II: 300, III: 200, IV: 100 };
  const div = entry.division ?? "IV";
  return base[tier] + divOffset[div] + Math.min(Math.floor(lp / 2), 99);
}

/** Human-readable label, e.g. "Diamond II" or "Challenger". */
export function tierLabel(entry: RankedEntry | null | undefined): string {
  if (!entry || !entry.tier) return "Unranked";
  const tier = entry.tier;
  const pretty = tier.charAt(0) + tier.slice(1).toLowerCase();
  if (APEX.has(tier)) return pretty;
  return entry.division ? `${pretty} ${entry.division}` : pretty;
}

/** Compact label including LP, e.g. "Diamond II — 47 LP". */
export function tierLabelWithLp(entry: RankedEntry | null | undefined): string {
  if (!entry || !entry.tier) return "Unranked";
  const lp = entry.lp ?? 0;
  return `${tierLabel(entry)} — ${lp} LP`;
}

/**
 * Tailwind text/border color classes per tier — used by `<TierCrest>` and
 * the dropdown badge. Sticking to existing semantic tokens where possible
 * (gold = challenger feel) and falling back to chart colors for variety.
 */
export function tierColorClass(tier: Tier | null | undefined): string {
  switch (tier) {
    case "CHALLENGER":
      return "text-gold";
    case "GRANDMASTER":
      return "text-destructive";
    case "MASTER":
      return "text-chart-4";
    case "DIAMOND":
      return "text-hex-blue";
    case "EMERALD":
      return "text-success";
    case "PLATINUM":
      return "text-chart-2";
    case "GOLD":
      return "text-gold";
    case "SILVER":
      return "text-muted-foreground";
    case "BRONZE":
      return "text-chart-5";
    case "IRON":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

/**
 * Defensive parser for raw strings coming from the DB (which stores tier
 * as TEXT). Returns `null` for unknown values so callers can treat the
 * player as unranked rather than crashing.
 */
const VALID_TIERS: ReadonlySet<string> = new Set([
  "CHALLENGER",
  "GRANDMASTER",
  "MASTER",
  "DIAMOND",
  "EMERALD",
  "PLATINUM",
  "GOLD",
  "SILVER",
  "BRONZE",
  "IRON",
]);

export function parseTier(value: unknown): Tier | null {
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  return VALID_TIERS.has(upper) ? (upper as Tier) : null;
}

const VALID_DIVISIONS: ReadonlySet<string> = new Set(["I", "II", "III", "IV"]);

export function parseDivision(value: unknown): Division | null {
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  return VALID_DIVISIONS.has(upper) ? (upper as Division) : null;
}
