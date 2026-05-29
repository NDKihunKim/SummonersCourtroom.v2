/**
 * useSampleSize — owns the user's preferred Performance Block sample size
 * (10 / 20 / 30) with localStorage persistence.
 *
 * Mirrors the resolution pattern used by `useShard`:
 *   1. SSR / first paint → DEFAULT_SAMPLE_SIZE so server HTML and the first
 *      client render match (no hydration warning).
 *   2. After mount, read localStorage and upgrade to the persisted value if
 *      it parses as a valid SampleSize.
 *   3. Setter writes through to localStorage so the choice survives reloads
 *      and follows the user across different searched players.
 *
 * All localStorage access is wrapped in try/catch — private mode, quota
 * errors, or disabled storage silently fall back to the in-memory state.
 */

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SAMPLE_SIZE, isSampleSize, type SampleSize } from "@/lib/match-stats";

/** localStorage key — namespaced like the other riftlog preferences. */
const STORAGE_KEY = "riftlog:sample-size";

/** Best-effort read; never throws. Returns null when nothing valid is stored. */
function readStored(): SampleSize | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    return isSampleSize(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Best-effort write; ignores failures so UI stays responsive. */
function writeStored(value: SampleSize): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    /* private mode / quota — ignore */
  }
}

export interface UseSampleSizeResult {
  sampleSize: SampleSize;
  setSampleSize: (next: SampleSize) => void;
}

export function useSampleSize(): UseSampleSizeResult {
  // SSR-safe initial — must match server output to avoid hydration mismatch.
  const [sampleSize, setSampleSizeState] = useState<SampleSize>(DEFAULT_SAMPLE_SIZE);

  // After mount, swap in the persisted value (if any). Only runs once.
  useEffect(() => {
    const stored = readStored();
    if (stored !== null && stored !== sampleSize) {
      setSampleSizeState(stored);
    }
    // Intentionally empty deps: we only want the post-hydration upgrade once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSampleSize = useCallback((next: SampleSize) => {
    // Guard at the boundary so even a misbehaving caller can't poison state.
    if (!isSampleSize(next)) return;
    setSampleSizeState(next);
    writeStored(next);
  }, []);

  return { sampleSize, setSampleSize };
}
