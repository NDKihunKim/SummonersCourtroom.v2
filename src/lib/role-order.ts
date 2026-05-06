/**
 * role-order — small, dedicated utility for sorting League participants by
 * their lane/role (TOP → JUNGLE → MIDDLE → BOTTOM → UTILITY).
 *
 * Kept in its own module (instead of inlined in RosterColumns) because:
 *   - It's pure data logic with no React/JSX concerns.
 *   - It's reusable: any future surface that renders a 5-player list
 *     (scoreboard, draft preview, post-game share card) can reuse it.
 *   - It's trivially unit-testable without rendering anything.
 */

import type { Participant } from "@/lib/match-types";

/**
 * Canonical role order used across the app for any roster display.
 * Index in this array == sort priority (lower = earlier).
 */
const ROLE_ORDER = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;

/**
 * Lookup map for O(1) priority resolution. Built once at module load
 * (instead of per-call indexOf) so sorting an array of 5 participants
 * stays trivially cheap even when many MatchCards render at once.
 */
const ROLE_PRIORITY: Record<string, number> = ROLE_ORDER.reduce(
  (acc, role, idx) => {
    acc[role] = idx;
    return acc;
  },
  {} as Record<string, number>,
);

/**
 * Sentinel priority for participants whose `teamPosition` is missing,
 * empty, or unrecognized (e.g. remakes / custom games). They sort AFTER
 * all known roles, and among themselves they keep their original
 * relative order (we rely on Array#sort being stable in modern JS engines,
 * which is guaranteed since ES2019).
 */
const UNKNOWN_PRIORITY = ROLE_ORDER.length;

/** Resolve a participant's sort priority; tolerant of missing fields. */
function priorityOf(p: Participant): number {
  // Defensive: teamPosition can be undefined on cached rows written before
  // we started persisting it, or "" on Riot remakes. Normalize to upper-case
  // so a stray lowercase value from any source still matches the table.
  const pos = (p.teamPosition ?? "").toUpperCase();
  const pri = ROLE_PRIORITY[pos];
  return pri === undefined ? UNKNOWN_PRIORITY : pri;
}

/**
 * Return a NEW array of participants sorted by canonical role order.
 * Participants with unknown/missing roles are appended at the end while
 * preserving their original relative order (stable sort).
 *
 * Pure / non-mutating — safe to call inline in render without surprising
 * the caller's array.
 */
export function sortByRole(participants: Participant[]): Participant[] {
  // Shallow copy first so we never mutate the caller's array (React state
  // / props arrays must stay referentially stable for memoization).
  return [...participants].sort((a, b) => priorityOf(a) - priorityOf(b));
}
