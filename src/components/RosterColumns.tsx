/**
 * RosterColumns — renders the BLUE / RED roster shown on the right
 * side of each MatchCard row.
 *
 * Why a dedicated component (instead of inlining in MatchCard):
 *   - The roster has its own visual rules (fixed-width columns, zebra rows,
 *     truncated names, tooltip-on-hover, tiny champion icon per row) that
 *     have nothing to do with match-card orchestration. Keeping it separate
 *     means MatchCard stays focused on layout + Judge state.
 *   - It's also reusable: any future surface that needs to show a 5v5
 *     roster strip (e.g. compact match preview, share card) can reuse it.
 *
 * Visual rules (decided by user):
 *   - Fixed equal-width 2-column layout, monospaced row height so the two
 *     columns line up vertically regardless of name length / script.
 *   - Each name truncates with an ellipsis; the full Riot ID is shown in
 *     a styled shadcn Tooltip on hover (and via `title` for keyboard /
 *     screen-reader fallback).
 *   - Subtle zebra striping on alternating rows for left-right eye tracking.
 *   - Small champion icon (16px) next to each name — reuses the data
 *     already present in the match payload, no extra fetches.
 */

import type { Participant } from "@/lib/match-types";
import { ChampionIcon } from "./ChampionIcon";
import { sortByRole } from "@/lib/role-order";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** How many roster slots to render per side. League is always 5v5. */
const MAX_ROWS = 5;

interface ColumnProps {
  label: string;
  players: Participant[];
  /** Tailwind text color class for the column header (e.g. `text-hex-blue`). */
  accent: string;
  /**
   * Optional click handler — when present each row becomes a real <button>
   * so the entire row (icon + name) is clickable. We only render a button
   * when this is provided so non-interactive surfaces stay non-interactive
   * (preserves keyboard tab order on screens that don't need search).
   */
  onPlayerClick?: (summoner: string) => void;
  formatChampionName?: (champion: string) => string;
  highlightedPlayerKey?: string;
}

function RosterColumn({
  label,
  players,
  accent,
  onPlayerClick,
  formatChampionName = (champion) => champion,
  highlightedPlayerKey,
}: ColumnProps) {
  // Cap the rendered list defensively. Riot can technically return weird
  // participant counts in custom games; never render more than MAX_ROWS so
  // the column height stays predictable.
  const rows = players.slice(0, MAX_ROWS);

  return (
    <div className="flex w-[120px] shrink-0 flex-col">
      <span
        className={`mb-0.5 text-[10px] font-semibold uppercase tracking-wider ${accent}`}
      >
        {label}
      </span>

      {rows.map((p, i) => {
        const playerKey = p.puuid ?? p.summoner?.toLowerCase() ?? "";
        const isHighlighted = Boolean(highlightedPlayerKey && playerKey === highlightedPlayerKey);
        // Zebra striping — every other row gets a faint background tint so
        // the eye can track horizontally between the two columns.
        const zebra = i % 2 === 1 ? "bg-muted/30" : "";

        // Row body — extracted so we can wrap it in either a <div> (read-only)
        // or a <button> (clickable) without duplicating the inner markup.
        // `min-w-0` on the parent + `truncate` on the name span is what
        // actually engages the ellipsis on long unbroken CJK strings.
        const rowInner = (
          <>
            <ChampionIcon
              champion={p.champion}
              size={14}
              ring={false}
              className="shrink-0"
            />
            <span
              className={`block min-w-0 flex-1 truncate text-left text-[11px] ${
                isHighlighted ? "font-semibold text-gold/80" : "text-muted-foreground"
              }`}
            >
              {p.summoner}
            </span>
          </>
        );

        // Shared visual classes for both the read-only and clickable variant.
        // Hover affordance is only added for the clickable variant so static
        // rows don't visually invite clicks.
        const baseRowClass = `flex h-[18px] w-full items-center gap-1 rounded px-1 ${zebra}`;
        const clickableClass =
          "cursor-pointer transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold";

        return (
          <Tooltip key={`${p.summoner}-${i}`}>
            <TooltipTrigger asChild>
              {onPlayerClick ? (
                // Clickable variant — whole row is a real <button> so the
                // name + icon together are the affordance. `type="button"`
                // prevents accidental form submission when the roster is
                // ever rendered inside a <form>. We guard against missing /
                // empty summoner names so a click on a malformed participant
                // never triggers a useless search.
                <button
                  type="button"
                  className={`${baseRowClass} ${clickableClass}`}
                  title={p.summoner}
                  aria-label={`Search ${p.summoner}`}
                  onClick={() => {
                    const name = p.summoner?.trim();
                    if (!name) return;
                    onPlayerClick(name);
                  }}
                >
                  {rowInner}
                </button>
              ) : (
                <div
                  className={baseRowClass}
                  // Native title attribute as a no-JS / screen-reader fallback
                  // — the styled tooltip below is the primary affordance.
                  title={p.summoner}
                >
                  {rowInner}
                </div>
              )}
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">
              <span className="font-medium">{formatChampionName(p.champion)}</span>
              <span className="mx-1.5 text-muted-foreground">·</span>
              <span>{p.summoner}</span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

interface Props {
  allies: Participant[];
  enemies: Participant[];
  /**
   * The "you" participant — the summoner whose match history is currently
   * being viewed. When provided, it is prepended to the Allies column so
   * both columns render a full 5v5 (Riot's match-v5 returns the 4 allies
   * minus you, so without this the Allies column always shows 4 vs 5).
   */
  you?: Participant;
  /**
   * Click handler invoked when a roster row is clicked. Receives the raw
   * Riot ID string (e.g. "Faker#KR1"). Optional — when omitted, rows are
   * non-interactive and preserve the previous behavior.
   */
  onPlayerClick?: (summoner: string) => void;
  formatChampionName?: (champion: string) => string;
}

export function RosterColumns({
  allies,
  enemies,
  you,
  onPlayerClick,
  formatChampionName = (champion) => champion,
}: Props) {
  const highlightedPlayerKey = you?.puuid ?? you?.summoner?.toLowerCase() ?? "";

  // Merge "you" into the full roster so Blue / Red columns show the actual
  // game sides rather than the viewed player's allies/enemies.
  const fullRoster = (() => {
    if (!you) return [...allies, ...enemies];
    const youKey = you.puuid ?? you.summoner?.toLowerCase() ?? "";
    const filtered = [...allies, ...enemies].filter((p) => {
      const key = p.puuid ?? p.summoner?.toLowerCase() ?? "";
      return key !== youKey;
    });
    return [...filtered, you];
  })();

  // Sort BOTH columns by canonical role order (TOP → JUNGLE → MIDDLE →
  // BOTTOM → UTILITY). Unknown / missing roles fall to the bottom while
  // preserving original relative order (stable sort).
  const sortedBlue = sortByRole(fullRoster.filter((p) => p.teamId === 100));
  const sortedRed = sortByRole(fullRoster.filter((p) => p.teamId === 200));
  const hasSideData = sortedBlue.length > 0 || sortedRed.length > 0;
  const bluePlayers = hasSideData ? sortedBlue : sortByRole(fullRoster.slice(0, MAX_ROWS));
  const redPlayers = hasSideData ? sortedRed : sortByRole(fullRoster.slice(MAX_ROWS, MAX_ROWS * 2));

  // Single TooltipProvider wraps both columns so all 9 tooltips share one
  // delay timer — feels snappier than the default 700ms per-trigger delay
  // and avoids spawning a provider per row.
  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={50}>
      <div className="flex gap-3">
        <div className="hidden min-[1060px]:block">
          <RosterColumn
            label="Blue Team"
            players={bluePlayers}
            accent="text-hex-blue"
            onPlayerClick={onPlayerClick}
            formatChampionName={formatChampionName}
            highlightedPlayerKey={highlightedPlayerKey}
          />
        </div>
        <div className="hidden min-[1180px]:block">
          <RosterColumn
            label="Red Team"
            players={redPlayers}
            accent="text-destructive"
            onPlayerClick={onPlayerClick}
            formatChampionName={formatChampionName}
            highlightedPlayerKey={highlightedPlayerKey}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
