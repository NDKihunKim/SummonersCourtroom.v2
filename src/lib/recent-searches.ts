// Recent-searches storage layer.
//
// Persists successfully searched Riot IDs to localStorage so we can power a
// lightweight autocomplete dropdown in the search bar. This is a v1 design:
// device-local only (no shared backend), filtered by shard, capped to a small
// number of entries.
//
// All public functions are SSR-safe: they no-op (return defaults) when
// `window`/`localStorage` is unavailable, and they swallow storage errors
// (private mode, quota exceeded, corrupt JSON) so the UI never crashes.

import type { Shard } from "@/lib/regions";

/** Versioned storage key — bump suffix when the shape changes. */
const STORAGE_KEY = "riftlog:recent-searches:v1";
/** Hard cap on stored entries; oldest are evicted. Keeps storage small. */
const MAX_ENTRIES = 25;

export interface RecentSearch {
  gameName: string;
  tagLine: string;
  shard: Shard;
  /** Epoch ms of the last time this entry was searched. Used for sorting. */
  lastUsedAt: number;
}

/** Stable dedupe key per (shard + gameName#tagLine), case-insensitive. */
function keyOf(e: Pick<RecentSearch, "shard" | "gameName" | "tagLine">): string {
  return `${e.shard}|${e.gameName.toLowerCase()}#${e.tagLine.toLowerCase()}`;
}

/** True when localStorage is reachable (browser, not blocked). */
function hasStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

/** Validate a single deserialized entry — defensive against schema drift. */
function isValidEntry(x: unknown): x is RecentSearch {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.gameName === "string" &&
    e.gameName.length > 0 &&
    typeof e.tagLine === "string" &&
    e.tagLine.length > 0 &&
    typeof e.shard === "string" &&
    typeof e.lastUsedAt === "number" &&
    Number.isFinite(e.lastUsedAt)
  );
}

/** Load all entries. Returns [] on any failure (and resets corrupt JSON). */
export function loadRecents(): RecentSearch[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filter out malformed entries silently rather than dropping everything.
    return parsed.filter(isValidEntry);
  } catch {
    // Corrupt JSON → reset so we don't keep failing every load.
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore quota / disabled-storage errors */
    }
    return [];
  }
}

/** Internal: persist a new array. Silently no-ops on storage failure. */
function writeRecents(entries: RecentSearch[]): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* quota exceeded or disabled — feature degrades gracefully */
  }
}

/**
 * Insert (or update) a single entry. Dedupes by (shard, name#tag),
 * refreshes `lastUsedAt`, sorts most-recent-first, and caps to MAX_ENTRIES.
 * Returns the new list so callers can keep React state in sync.
 */
export function saveRecent(entry: Omit<RecentSearch, "lastUsedAt">): RecentSearch[] {
  // Trim & guard against empty values — never store junk.
  const clean: RecentSearch = {
    gameName: entry.gameName.trim(),
    tagLine: entry.tagLine.trim(),
    shard: entry.shard,
    lastUsedAt: Date.now(),
  };
  if (!clean.gameName || !clean.tagLine) return loadRecents();

  const k = keyOf(clean);
  const existing = loadRecents().filter((e) => keyOf(e) !== k);
  const next = [clean, ...existing].slice(0, MAX_ENTRIES);
  writeRecents(next);
  return next;
}

/** Remove a single entry by its dedupe key. Returns the new list. */
export function removeRecent(key: string): RecentSearch[] {
  const next = loadRecents().filter((e) => keyOf(e) !== key);
  writeRecents(next);
  return next;
}

/**
 * Wipe every recent search from local storage.
 *
 * Used by the "Clear all history" footer in the search dropdown. Returns the
 * new empty list so React state can sync without a re-read. This only
 * affects the current device — the shared backend index is untouched.
 */
export function clearAllRecents(): RecentSearch[] {
  if (!hasStorage()) return [];
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* quota / disabled-storage — silently degrade */
  }
  return [];
}

/** Public re-export so callers can compute keys (e.g. for remove buttons). */
export const getRecentKey = keyOf;

/**
 * Filter + sort recents for autocomplete display.
 *
 * Rules (v1):
 * - Always shard-scoped — we only suggest within the user's selected shard.
 * - Empty query → return up to `limit` most-recent entries.
 * - Otherwise prefix-match `gameName` (case-insensitive). If fewer than
 *   `limit` prefix matches exist, top up with substring matches so the user
 *   still gets useful hints (e.g. typing "ker" still surfaces "Faker").
 * - Sort by `lastUsedAt` desc within each tier.
 */
export function filterRecents(
  all: RecentSearch[],
  query: string,
  shard: Shard,
  limit = 5,
): RecentSearch[] {
  const scoped = all.filter((e) => e.shard === shard).sort((a, b) => b.lastUsedAt - a.lastUsedAt);

  const q = query.trim().toLowerCase();
  if (!q) return scoped.slice(0, limit);

  const prefix: RecentSearch[] = [];
  const substring: RecentSearch[] = [];
  for (const e of scoped) {
    const name = e.gameName.toLowerCase();
    if (name.startsWith(q)) prefix.push(e);
    else if (name.includes(q)) substring.push(e);
    if (prefix.length >= limit) break;
  }

  // Top up with substring matches only if prefix matches alone don't fill the slot.
  if (prefix.length >= limit) return prefix.slice(0, limit);
  return [...prefix, ...substring].slice(0, limit);
}
