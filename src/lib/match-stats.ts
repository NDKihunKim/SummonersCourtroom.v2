// Pure helpers for computing the Performance Block summary stats.
//
// Kept framework-free (no React) so it's trivially unit-testable and can be
// reused later by other surfaces (e.g. an op.gg-style sidebar, exports, etc.)
// without dragging component state along.

import type { Match } from "@/lib/match-types";

/** The fixed sample-size options exposed in the UI selector. */
export const SAMPLE_SIZE_OPTIONS = [10, 20, 30] as const;
export type SampleSize = (typeof SAMPLE_SIZE_OPTIONS)[number];

/** Default when nothing is persisted yet — matches the previous behavior. */
export const DEFAULT_SAMPLE_SIZE: SampleSize = 10;

/**
 * Type guard — narrows an unknown number/string into a valid SampleSize.
 * Used by the persistence hook to reject corrupt localStorage values.
 */
export function isSampleSize(value: unknown): value is SampleSize {
  return (
    typeof value === "number" &&
    (SAMPLE_SIZE_OPTIONS as readonly number[]).includes(value)
  );
}

export interface MatchStats {
  /** Wins inside the actual sampled window. */
  wins: number;
  /** Losses inside the actual sampled window. */
  losses: number;
  /** Integer percent (0–100). 0 when the window is empty. */
  wr: number;
  /** Average KDA as a 2-decimal string, e.g. "3.42". "0.00" when empty. */
  avgKda: string;
  /**
   * Number of matches actually used in the calculation. May be smaller than
   * the requested `sampleSize` when the cache holds fewer matches (new
   * accounts, or pre-bump cached payloads that only store 20). The UI uses
   * this in the trophy line so the label never lies about the math.
   */
  sampleUsed: number;
}

/**
 * Compute Win Rate / W-L / Avg KDA over the most recent `sampleSize` matches.
 *
 * - O(n) where n = min(sampleSize, matches.length); single pass, no allocations
 *   beyond the slice header.
 * - Defensive against zero-deaths (perfect KDA) via Math.max(1, totalD).
 * - Defensive against an empty window — returns a zero-stat shape rather than
 *   throwing, so callers can render unconditionally.
 */
export function computeMatchStats(
  matches: readonly Match[],
  sampleSize: number,
): MatchStats {
  const sampleUsed = Math.min(Math.max(0, sampleSize | 0), matches.length);

  if (sampleUsed === 0) {
    return { wins: 0, losses: 0, wr: 0, avgKda: "0.00", sampleUsed: 0 };
  }

  // Single linear pass — cheaper than three separate `.filter`/`.reduce` calls
  // and keeps the intent easy to audit.
  let wins = 0;
  let totalK = 0;
  let totalD = 0;
  let totalA = 0;
  for (let i = 0; i < sampleUsed; i++) {
    const m = matches[i];
    if (m.result === "Victory") wins++;
    totalK += m.kills;
    totalD += m.deaths;
    totalA += m.assists;
  }

  const losses = sampleUsed - wins;
  const wr = Math.round((wins / sampleUsed) * 100);
  const avgKda = ((totalK + totalA) / Math.max(1, totalD)).toFixed(2);

  return { wins, losses, wr, avgKda, sampleUsed };
}