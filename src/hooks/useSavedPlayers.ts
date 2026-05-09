import { useCallback, useEffect, useState } from "react";
import {
  getSavedPlayerKey,
  isPlayerSaved,
  loadSavedPlayers,
  removeSavedPlayer,
  savePlayer,
  SAVED_PLAYERS_STORAGE_KEY,
  type SavedPlayer,
} from "@/lib/saved-players";

export function useSavedPlayers() {
  const [savedPlayers, setSavedPlayers] = useState<SavedPlayer[]>(() => loadSavedPlayers());

  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key === null || e.key === SAVED_PLAYERS_STORAGE_KEY) {
        setSavedPlayers(loadSavedPlayers());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const addSavedPlayer = useCallback((entry: Omit<SavedPlayer, "savedAt">) => {
    setSavedPlayers(savePlayer(entry));
  }, []);

  const removeSaved = useCallback((key: string) => {
    setSavedPlayers(removeSavedPlayer(key));
  }, []);

  const isSaved = useCallback(
    (player: Parameters<typeof isPlayerSaved>[1]) => isPlayerSaved(savedPlayers, player),
    [savedPlayers],
  );

  return {
    savedPlayers,
    addSavedPlayer,
    removeSavedPlayer: removeSaved,
    isSaved,
    getSavedPlayerKey,
  };
}
