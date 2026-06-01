import type { Match } from "@/lib/match-types";

function hasParticipantScoreboardFields(match: Match): boolean {
  return [...match.team, ...match.enemies].every(
    (participant) =>
      typeof participant.cs === "number" &&
      Number.isFinite(participant.cs) &&
      Array.isArray(participant.items) &&
      participant.items.length === 6 &&
      typeof participant.trinket === "number" &&
      Number.isFinite(participant.trinket),
  );
}

export function shouldRefetchCachedMatchForRefresh(match: Match): boolean {
  return (
    typeof match.playedAtMs !== "number" ||
    !Number.isFinite(match.playedAtMs) ||
    match.playedAtMs <= 0 ||
    !hasParticipantScoreboardFields(match)
  );
}
