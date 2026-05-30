import type { Match } from "@/lib/match-types";

export function shouldRefetchCachedMatchForRefresh(match: Match): boolean {
  return (
    typeof match.playedAtMs !== "number" ||
    !Number.isFinite(match.playedAtMs) ||
    match.playedAtMs <= 0
  );
}
