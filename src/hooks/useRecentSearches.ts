// React wrapper around the recent-searches storage layer.
//
// Keeps a copy of the recents list in component state so the UI re-renders on
// add/remove, and listens to the cross-tab `storage` event so two open tabs
// stay roughly in sync.

import { useCallback, useEffect, useState } from "react";
import {
  clearAllRecents,
  filterRecents,
  loadRecents,
  removeRecent as removeFromStorage,
  saveRecent as saveToStorage,
  type RecentSearch,
} from "@/lib/recent-searches";
import type { Shard } from "@/lib/regions";

export function useRecentSearches() {
  // Lazy initializer so we only touch localStorage once on mount.
  // Returns [] during SSR (loadRecents is SSR-safe).
  const [recents, setRecents] = useState<RecentSearch[]>(() => loadRecents());

  // Cross-tab sync: when another tab updates the recents key, refresh ours.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      // Re-read on any change to our key (or a full clear when key === null).
      if (e.key === null || e.key === "riftlog:recent-searches:v1") {
        setRecents(loadRecents());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const addRecent = useCallback((entry: { gameName: string; tagLine: string; shard: Shard }) => {
    setRecents(saveToStorage(entry));
  }, []);

  const removeRecent = useCallback((key: string) => {
    setRecents(removeFromStorage(key));
  }, []);

  /**
   * Wipe every entry. Returns the count cleared so the caller can show a
   * confirmation toast like "Cleared 7 recent searches.".
   */
  const clearAll = useCallback((): number => {
    const before = recents.length;
    setRecents(clearAllRecents());
    return before;
  }, [recents.length]);

  return { recents, addRecent, removeRecent, clearAll, filterRecents };
}
