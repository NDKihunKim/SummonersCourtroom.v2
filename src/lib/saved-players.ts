import type { Shard } from "@/lib/regions";
import type { Division, Tier } from "@/lib/tier";

const STORAGE_KEY = "riftlog:saved-players:v1";
const MAX_ENTRIES = 50;

export interface SavedPlayer {
  gameName: string;
  tagLine: string;
  shard: Shard;
  profileIconId: number | null;
  tier: Tier | null;
  division: Division | null;
  lp: number | null;
  savedAt: number;
}

function keyOf(e: Pick<SavedPlayer, "shard" | "gameName" | "tagLine">): string {
  return `${e.shard}|${e.gameName.toLowerCase()}#${e.tagLine.toLowerCase()}`;
}

function hasStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function isValidEntry(x: unknown): x is SavedPlayer {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.gameName === "string" &&
    e.gameName.length > 0 &&
    typeof e.tagLine === "string" &&
    e.tagLine.length > 0 &&
    typeof e.shard === "string" &&
    (typeof e.profileIconId === "number" || e.profileIconId === null) &&
    (typeof e.tier === "string" || e.tier === null) &&
    (typeof e.division === "string" || e.division === null) &&
    (typeof e.lp === "number" || e.lp === null) &&
    typeof e.savedAt === "number" &&
    Number.isFinite(e.savedAt)
  );
}

export function loadSavedPlayers(): SavedPlayer[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return [];
  }
}

function writeSavedPlayers(entries: SavedPlayer[]): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
}

export function savePlayer(entry: Omit<SavedPlayer, "savedAt">): SavedPlayer[] {
  const clean: SavedPlayer = {
    gameName: entry.gameName.trim(),
    tagLine: entry.tagLine.trim(),
    shard: entry.shard,
    profileIconId: entry.profileIconId,
    tier: entry.tier,
    division: entry.division,
    lp: entry.lp,
    savedAt: Date.now(),
  };
  if (!clean.gameName || !clean.tagLine) return loadSavedPlayers();

  const k = keyOf(clean);
  const existing = loadSavedPlayers().filter((e) => keyOf(e) !== k);
  const next = [clean, ...existing].slice(0, MAX_ENTRIES);
  writeSavedPlayers(next);
  return next;
}

export function removeSavedPlayer(key: string): SavedPlayer[] {
  const next = loadSavedPlayers().filter((e) => keyOf(e) !== key);
  writeSavedPlayers(next);
  return next;
}

export function isPlayerSaved(
  all: SavedPlayer[],
  player: Pick<SavedPlayer, "shard" | "gameName" | "tagLine">,
): boolean {
  const k = keyOf(player);
  return all.some((e) => keyOf(e) === k);
}

export function filterSavedPlayers(all: SavedPlayer[], query: string, limit = 5): SavedPlayer[] {
  const scoped = [...all].sort((a, b) => b.savedAt - a.savedAt);

  const q = query.trim().toLowerCase();
  if (!q) return scoped.slice(0, limit);

  const prefix: SavedPlayer[] = [];
  const substring: SavedPlayer[] = [];
  for (const e of scoped) {
    const name = e.gameName.toLowerCase();
    if (name.startsWith(q)) prefix.push(e);
    else if (name.includes(q)) substring.push(e);
    if (prefix.length >= limit) break;
  }

  if (prefix.length >= limit) return prefix.slice(0, limit);
  return [...prefix, ...substring].slice(0, limit);
}

export const getSavedPlayerKey = keyOf;
export const SAVED_PLAYERS_STORAGE_KEY = STORAGE_KEY;
