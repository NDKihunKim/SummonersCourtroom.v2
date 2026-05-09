/**
 * useShard — owns the user's selected League shard with a 3-tier resolution:
 *
 *   1. URL query (`?shard=KR`) — used by home/deep links to carry the
 *      currently viewed region across a page load.
 *   2. localStorage (`riftlog:shard`) — if present, the user has either
 *      explicitly picked a shard before, or accepted the auto-detected
 *      one on a prior visit. Either way, respect it.
 *   3. Auto-detection from the browser's IANA timezone + locale
 *      (`detectShard()`). Runs ONCE on mount, post-hydration.
 *   4. `DEFAULT_SHARD` as the absolute fallback.
 *
 * SSR safety: the initial render returns `DEFAULT_SHARD` so the server-
 * rendered HTML and the first client paint match (no hydration warning).
 * The detected/persisted value is applied inside `useEffect` immediately
 * after, which the user perceives as instant.
 */

import { useEffect, useState } from "react";
import { DEFAULT_SHARD, SHARDS, type Shard } from "@/lib/regions";
import { detectShard } from "@/lib/region-detect";

/** localStorage key — namespaced to avoid colliding with other apps. */
const STORAGE_KEY = "riftlog:shard";

/** Best-effort localStorage read; never throws (private mode, quota). */
function readStored(): Shard | null {
  try {
    if (typeof window === "undefined") return null;
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v ? (v as Shard) : null;
  } catch {
    return null;
  }
}

function isKnownShard(value: string): value is Shard {
  return SHARDS.some((s) => s.code === value);
}

/** URL shard wins over storage so home/deep links cannot be reset by defaults. */
function readUrlShard(): Shard | null {
  try {
    if (typeof window === "undefined") return null;
    const value = new URLSearchParams(window.location.search).get("shard");
    return value && isKnownShard(value) ? value : null;
  } catch {
    return null;
  }
}

/** Best-effort localStorage write; ignores failures so UI stays responsive. */
function writeStored(value: Shard): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* private mode / quota — ignore */
  }
}

export interface UseShardResult {
  shard: Shard;
  /**
   * Set the shard. Persists to localStorage immediately so future visits
   * skip auto-detection (the user's explicit choice always wins).
   */
  setShard: (next: Shard) => void;
  /**
   * True iff the current shard came from auto-detection on this visit
   * (i.e. nothing was in localStorage). Useful if we want to show a small
   * "we picked this for you" hint — currently unused but exposed for
   * future UI work without forcing another refactor.
   */
  isAutoDetected: boolean;
}

export function useShard(): UseShardResult {
  // SSR-safe initial value — must match server render.
  const [shard, setShardState] = useState<Shard>(DEFAULT_SHARD);
  const [isAutoDetected, setIsAutoDetected] = useState(false);

  // Resolve the real shard once on mount. We split this from the setter
  // effect below so user-driven `setShard` calls always persist, while
  // the initial detection only persists when it's truly the first visit.
  useEffect(() => {
    const urlShard = readUrlShard();
    if (urlShard) {
      setShardState(urlShard);
      setIsAutoDetected(false);
      writeStored(urlShard);
      return;
    }

    const stored = readStored();
    if (stored) {
      // Returning visitor — honour their previous choice.
      setShardState(stored);
      setIsAutoDetected(false);
    } else {
      // First visit — auto-detect, persist, and flag it.
      const detected = detectShard();
      setShardState(detected);
      setIsAutoDetected(true);
      writeStored(detected);
    }
  }, []);

  /**
   * Public setter: updates state and persists. Marks the shard as no
   * longer "auto-detected" since the user has now expressed an explicit
   * (or confirming) choice.
   */
  function setShard(next: Shard): void {
    setShardState(next);
    setIsAutoDetected(false);
    writeStored(next);
  }

  return { shard, setShard, isAutoDetected };
}
