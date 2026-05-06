/**
 * useSuggestions — composes local recent searches with the shared backend
 * index into a single ordered list for the autocomplete dropdown.
 *
 * Ordering rule: local recents first (filtered + sorted by `filterRecents`),
 * then index entries sorted Challenger -> Iron by the server. Duplicates
 * (same name#tag on the same shard) are removed in favour of the local
 * recent so the per-row `lastUsedAt` timestamp remains accurate.
 *
 * The backend call is debounced by 200ms via TanStack Query's `enabled`
 * gating + a small useEffect — keeps typing snappy without spamming the
 * server.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { filterRecents, type RecentSearch } from "@/lib/recent-searches";
import type { Shard } from "@/lib/regions";
import type { Tier, Division } from "@/lib/tier";
import {
  getSuggestionsFromIndex,
  type IndexSuggestion,
  getProfileIconsForKeys,
} from "@/server/summoner-cache.functions";

/** Source tag — UI uses this to decide whether to render a tier crest. */
export type SuggestionSource = "recent" | "index";

export interface Suggestion {
  source: SuggestionSource;
  gameName: string;
  tagLine: string;
  shard: Shard;
  /** Present for index entries (and any future tier-cached recents). */
  tier: Tier | null;
  division: Division | null;
  lp: number | null;
  /**
   * Real Riot profile icon id. Present for index entries that have been
   * backfilled; null for local "recent" entries (we don't have it locally
   * yet) and for older index rows from before the column existed.
   */
  profileIconId: number | null;
}

/** Lowercase dedupe key — must match the server-side `indexKey` shape. */
function dedupeKey(name: string, tag: string): string {
  return `${name.toLowerCase()}#${tag.toLowerCase()}`;
}

function recentToSuggestion(r: RecentSearch): Suggestion {
  return {
    source: "recent",
    gameName: r.gameName,
    tagLine: r.tagLine,
    shard: r.shard,
    tier: null,
    division: null,
    lp: null,
    profileIconId: null,
  };
}

function indexToSuggestion(i: IndexSuggestion): Suggestion {
  return {
    source: "index",
    gameName: i.gameName,
    tagLine: i.tagLine,
    shard: i.shard as Shard,
    tier: i.tier,
    division: i.division,
    lp: i.lp,
    profileIconId: i.profileIconId,
  };
}

interface Options {
  recents: RecentSearch[];
  query: string;
  shard: Shard;
  /** Total max items in the dropdown across both sources. */
  limit?: number;
}

export function useSuggestions({ recents, query, shard, limit = 5 }: Options) {
  // Local recents — instant, no network. Already filtered + shard-scoped.
  const localItems = useMemo(
    () => filterRecents(recents, query, shard, limit).map(recentToSuggestion),
    [recents, query, shard, limit],
  );

  // Enrich local recents with their real Data Dragon profile icon ids by
  // looking the keys up in the shared cache. Missing keys (player never
  // searched on this shard before) gracefully fall back to the letter
  // avatar in <ProfileIcon>. Stable cache key so the same set of recents
  // doesn't re-trigger a network round-trip on every keystroke.
  const recentKeyPairs = useMemo(
    () =>
      localItems.map((s) => ({ gameName: s.gameName, tagLine: s.tagLine })),
    [localItems],
  );
  const recentKeyHash = useMemo(
    () =>
      recentKeyPairs
        .map((k) => `${k.gameName.toLowerCase()}#${k.tagLine.toLowerCase()}`)
        .sort()
        .join("|"),
    [recentKeyPairs],
  );

  const { data: iconMap = {} } = useQuery({
    queryKey: ["recent-icons", shard, recentKeyHash],
    queryFn: () =>
      getProfileIconsForKeys({
        data: { shard, keys: recentKeyPairs },
      }),
    enabled: recentKeyPairs.length > 0,
    // Profile icons rarely change — 5 minutes is plenty fresh.
    staleTime: 5 * 60_000,
  });

  const enrichedLocalItems = useMemo<Suggestion[]>(() => {
    if (Object.keys(iconMap).length === 0) return localItems;
    return localItems.map((s) => {
      const k = `${s.gameName.toLowerCase()}#${s.tagLine.toLowerCase()}`;
      const icon = iconMap[k];
      return icon != null ? { ...s, profileIconId: icon } : s;
    });
  }, [localItems, iconMap]);

  // Debounce the query for the backend call only — local recents stay live.
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(handle);
  }, [query]);

  // Build the exclude list from local items so the server doesn't bother
  // returning duplicates we'd just filter out.
  const excludeKeys = useMemo(
    () => enrichedLocalItems.map((s) => dedupeKey(s.gameName, s.tagLine)),
    [enrichedLocalItems],
  );

  // How many index entries do we still need? If recents already fill the
  // dropdown, skip the network call entirely.
  const indexLimit = Math.max(0, limit - localItems.length);

  // Only surface backend index suggestions while the user is actively
  // typing. With an empty query the index would return "popular players on
  // this shard" — visually indistinguishable from local recents, which made
  // it look like search history reappeared after the user clicked
  // "Clear all history". Gating on a non-empty trimmed query keeps the
  // typeahead useful for discovery (typing "fak" still surfaces Faker)
  // while making the cleared-history state genuinely empty.
  const hasTypedQuery = debouncedQuery.trim().length > 0;

  const { data: indexItems = [] } = useQuery({
    // Cache key includes everything that affects the result.
    queryKey: [
      "suggestions",
      shard,
      debouncedQuery.trim().toLowerCase(),
      indexLimit,
      excludeKeys.join("|"),
    ],
    queryFn: () =>
      getSuggestionsFromIndex({
        data: {
          shard,
          query: debouncedQuery,
          excludeKeys,
          limit: indexLimit,
        },
      }),
    // Gate on both: must have room AND the user must have typed something.
    enabled: indexLimit > 0 && hasTypedQuery,
    // Suggestions can change as people search — but a 30s window is plenty
    // fresh for an autocomplete dropdown.
    staleTime: 30_000,
  });

  // Final dedupe pass in case the server's exclusion missed something
  // (e.g. casing race), then cap at `limit`.
  const suggestions = useMemo<Suggestion[]>(() => {
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    for (const s of enrichedLocalItems) {
      const k = dedupeKey(s.gameName, s.tagLine);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    for (const i of indexItems) {
      const k = dedupeKey(i.gameName, i.tagLine);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(indexToSuggestion(i));
      if (out.length >= limit) break;
    }
    return out.slice(0, limit);
  }, [enrichedLocalItems, indexItems, limit]);

  return suggestions;
}
