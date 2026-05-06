/**
 * teamRundown — build the human-readable "TEAMS:" block injected into the
 * upper Judge prompt so the LLM has a quick at-a-glance roster (which
 * champions are on which side, in which roles).
 *
 * Pure / stateless — derives everything from the already-fetched `Match`
 * + viewing `Participant`. No network, no React.
 *
 * Output shape (single string with a trailing line break suitable for
 * concatenation onto the upper prompt):
 *
 *   TEAMS:
 *   Blue (your team): Top Garen, Jungle LeeSin, Mid Ahri, Bot Jinx, Support Thresh
 *   Red (enemy team): Top Darius, Jungle Vi, Mid Zed, Bot Caitlyn, Support Lulu
 *
 * Edge-case handling:
 *   - Missing `teamId` (old cached rows) → fall back to "Your team" /
 *     "Enemy team" labels instead of guessing Blue/Red.
 *   - Missing `teamPosition` (remakes, blind queues) → role label
 *     becomes "Unknown" and those entries sort last within their team.
 *   - Empty rosters → that team line is omitted entirely (no "Blue: " stub).
 */

import type { Match, Participant } from "@/lib/match-types";

/** Riot position code → display label. */
const ROLE_LABEL: Record<string, string> = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Mid",
  BOTTOM: "Bot",
  UTILITY: "Support",
};

/**
 * Sort weight for roles so output order is always
 * Top → Jungle → Mid → Bot → Support → Unknown.
 * Stable regardless of how Riot orders participants in the payload.
 */
const ROLE_ORDER: Record<string, number> = {
  TOP: 0,
  JUNGLE: 1,
  MIDDLE: 2,
  BOTTOM: 3,
  UTILITY: 4,
};

function roleLabel(position: string | undefined): string {
  if (!position) return "Unknown";
  return ROLE_LABEL[position] ?? "Unknown";
}

function roleWeight(position: string | undefined): number {
  if (!position) return 99;
  return ROLE_ORDER[position] ?? 99;
}

/** Format a single team's roster line — "Top Garen, Jungle LeeSin, ...". */
function formatRoster(members: Participant[]): string {
  // Copy before sort so we never mutate the caller's array.
  return [...members]
    .sort((a, b) => roleWeight(a.teamPosition) - roleWeight(b.teamPosition))
    .map((p) => `${roleLabel(p.teamPosition)} ${p.champion}`)
    .join(", ");
}

/**
 * Build the full TEAMS block. `you` is the viewing player as a Participant
 * (already constructed by MatchCard from `match.champion` + the viewer's
 * KDA) — required because the viewer is not in `match.team` / `match.enemies`.
 */
export function buildTeamRundown(match: Match, you: Participant): string {
  // The viewer's full team = themselves + the other 4 allies.
  // Inject userTeamId/userTeamPosition onto the synthesized "you" entry so
  // sorting + sided labels work even when the caller didn't pre-populate it.
  const youWithSide: Participant = {
    ...you,
    teamId: you.teamId ?? match.userTeamId,
    teamPosition: you.teamPosition ?? match.userTeamPosition ?? "",
  };

  const allies: Participant[] = [youWithSide, ...match.team];
  const enemies: Participant[] = match.enemies;

  // Determine Blue vs. Red labelling. We need the viewer's actual teamId —
  // without it we can't honestly call a side Blue or Red, so we fall back
  // to relational labels that are still useful to the LLM.
  const youSide = youWithSide.teamId ?? match.userTeamId;

  let alliesLabel: string;
  let enemiesLabel: string;
  if (youSide === 100) {
    alliesLabel = "Blue (your team)";
    enemiesLabel = "Red (enemy team)";
  } else if (youSide === 200) {
    alliesLabel = "Red (your team)";
    enemiesLabel = "Blue (enemy team)";
  } else {
    // Old cached rows without teamId — degrade gracefully.
    alliesLabel = "Your team";
    enemiesLabel = "Enemy team";
  }

  const lines: string[] = ["TEAMS:"];
  if (allies.length > 0) lines.push(`${alliesLabel}: ${formatRoster(allies)}`);
  if (enemies.length > 0) lines.push(`${enemiesLabel}: ${formatRoster(enemies)}`);

  return lines.join("\n");
}
