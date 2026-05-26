/**
 * MatchupHeader — pinned "You vs Ally" card shown above the Judge's
 * loading stepper and final verdict, so the user always sees which two
 * subjects are being compared.
 *
 * Why a dedicated component:
 *   - Used in two places (loading + verdict stages) — extracting it
 *     avoids duplicating JSX and keeps `MatchCard.tsx` readable.
 *   - Visually matches the PickAlly screen by reusing the same tile
 *     primitive (champion icon + name + KDA, vertical layout).
 *
 * Edge cases handled:
 *   - Missing/invalid KDA values fall back to "0" via `safeNum` so the
 *     card never renders `NaN/undefined/undefined`.
 *   - Long Riot IDs are truncated by the underlying tile component.
 */

import type { Participant } from "@/lib/match-types";
import { ChampionIcon } from "./ChampionIcon";

/** Coerce a possibly-missing number to a safe integer for display. */
function safeNum(n: number | undefined | null): number {
  return Number.isFinite(n) ? (n as number) : 0;
}

/**
 * Local tile — intentionally a near-copy of `PlayerTile` from MatchCard.
 * We don't re-export PlayerTile from MatchCard to keep that file's internal
 * helpers private; the duplication here is tiny (~10 lines) and lets each
 * component evolve independently (e.g. if the matchup header later wants
 * a slightly different visual treatment).
 */
function Tile({
  name,
  champion,
  championLabel = champion,
  kda,
  highlighted,
  loadingSequence,
  sequenceIndex = 0,
  sequenceCount = 1,
}: {
  name: string;
  champion: string;
  championLabel?: string;
  kda: string;
  highlighted?: boolean;
  loadingSequence?: boolean;
  sequenceIndex?: number;
  sequenceCount?: number;
}) {
  const sequenceDuration = Math.max(1, sequenceCount) * 650;
  return (
    <div
      // `shrink-0` keeps the 112px width when sat inside the flex row,
      // and `overflow-hidden` ensures truncated children clip cleanly
      // instead of bleeding past the rounded border.
      className={`flex w-28 shrink-0 flex-col items-center gap-1 overflow-hidden rounded-lg border p-2 ${
        highlighted ? "border-gold bg-secondary/50" : "border-border bg-card"
      } ${loadingSequence ? "animate-verdict-card-sequence motion-reduce:animate-none" : ""}`}
      style={
        loadingSequence
          ? {
              animationDelay: `${sequenceIndex * 650}ms`,
              animationDuration: `${sequenceDuration}ms`,
            }
          : undefined
      }
    >
      <ChampionIcon champion={champion} size={48} />
      {/* For ellipsis to engage inside a flex column with `items-center`,
          the text element MUST have an explicit width (`w-full`) — relying
          on `max-w-full` alone fails for unbroken strings (e.g. Korean
          summoner names without spaces) because the span's intrinsic
          content width can exceed the centered child's resolved width.
          `min-w-0` resets the flex default that would otherwise let the
          child grow to fit content. */}
      <span className="block w-full min-w-0 truncate text-center text-xs font-semibold text-foreground">
        {championLabel}
      </span>
      <span
        className="block w-full min-w-0 truncate text-center text-[10px] text-muted-foreground"
        title={name}
      >
        {name}
      </span>
      <span className="text-[10px] text-muted-foreground">{kda}</span>
    </div>
  );
}

export interface MatchupHeaderProps {
  /** The searched player ("You") — already known from the parent Match. */
  you: { champion: string; kills: number; deaths: number; assists: number; summoner?: string };
  /** The ally chosen on the PickAlly screen. */
  ally: Participant;
  players?: Participant[];
  loadingSequence?: boolean;
  highlightChampionKey?: string | null;
  highlightChampionName?: string | null;
  formatChampionName?: (champion: string) => string;
}

export function MatchupHeader({
  you,
  ally,
  players,
  loadingSequence = false,
  highlightChampionKey,
  highlightChampionName,
  formatChampionName = (champion) => champion,
}: MatchupHeaderProps) {
  function isHighlightedChampion(champion: string): boolean {
    if (highlightChampionKey) {
      return normalizeChampionToken(champion) === normalizeChampionToken(highlightChampionKey);
    }
    if (!highlightChampionName) return false;
    const target = normalizeChampionToken(highlightChampionName);
    return [champion, formatChampionName(champion)]
      .map(normalizeChampionToken)
      .some((candidate) => candidate.length > 0 && candidate === target);
  }

  if (players?.length) {
    const sequenceCount = players.length;
    return (
      <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
        {players.map((player, index) => (
          <div key={`${player.puuid ?? player.summoner}-${index}`} className="flex items-center gap-3">
            {index > 0 ? <span className="text-lg font-bold text-muted-foreground">vs</span> : null}
            <Tile
              name={player.summoner}
              champion={player.champion}
              championLabel={formatChampionName(player.champion)}
              kda={`${safeNum(player.kills)}/${safeNum(player.deaths)}/${safeNum(player.assists)}`}
              highlighted={isHighlightedChampion(player.champion)}
              loadingSequence={loadingSequence}
              sequenceIndex={index}
              sequenceCount={sequenceCount}
            />
          </div>
        ))}
      </div>
    );
  }

  // Format KDA defensively — the contextualizer pipeline can in theory
  // hand back a participant with missing stats; we never want to render
  // "undefined/undefined/undefined" inside the header.
  const youKda = `${safeNum(you.kills)}/${safeNum(you.deaths)}/${safeNum(you.assists)}`;
  const allyKda = `${safeNum(ally.kills)}/${safeNum(ally.deaths)}/${safeNum(ally.assists)}`;
  const sequenceCount = 2;

  return (
    <div className="mb-4 flex items-center justify-center gap-3">
      <Tile
        name={you.summoner ?? "You"}
        champion={you.champion}
        championLabel={formatChampionName(you.champion)}
        kda={youKda}
        highlighted={isHighlightedChampion(you.champion)}
        loadingSequence={loadingSequence}
        sequenceIndex={0}
        sequenceCount={sequenceCount}
      />
      <span className="text-lg font-bold text-muted-foreground">vs</span>
      <Tile
        name={ally.summoner}
        champion={ally.champion}
        championLabel={formatChampionName(ally.champion)}
        kda={allyKda}
        highlighted={isHighlightedChampion(ally.champion)}
        loadingSequence={loadingSequence}
        sequenceIndex={1}
        sequenceCount={sequenceCount}
      />
    </div>
  );
}

function normalizeChampionToken(value: string): string {
  return value.replace(/[^a-z0-9가-힣]/gi, "").toLowerCase();
}
