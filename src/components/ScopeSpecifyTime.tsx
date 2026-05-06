import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import {
  TimeRangePicker,
  type TimeRange,
  MIN_WINDOW_MS,
  MAX_WINDOW_MS,
} from "./TimeRangePicker";
import { TimelineWindowResult } from "./TimelineWindowResult";
import type { Match, Participant } from "@/lib/match-types";

/**
 * Specify-Time scope panel. Composes:
 *   - TimeRangePicker (dual-handle slider + mm:ss inputs)
 *   - "Run" button (explicit fetch trigger, no auto-refetch on drag)
 *   - TimelineWindowResult (loading / error / JSON dump)
 *
 * Kept separate from MatchCard so the Judge state machine there doesn't have
 * to learn about timeline windows, slider state, or fetch state.
 */

/**
 * Parse a duration string (as stored on Match.duration) into ms.
 *
 * Accepts the two shapes the app produces / has historically produced:
 *   - "28m 34s"  ← current `formatDuration` output in src/server/riot.ts
 *   - "28:34"    ← legacy / mm:ss form, kept for backward compatibility
 *
 * Falls back to 30:00 only when the string is truly unparseable, so the
 * slider has a usable upper bound rather than collapsing to zero.
 */
function parseDurationToMs(duration: string): number {
  const trimmed = duration.trim();
  const FALLBACK = 30 * 60_000;

  // "28m 34s" / "5m 0s" / "28m" / "45s" — the format produced by
  // formatDuration() on the server. Seconds segment is optional so we
  // gracefully handle edge cases like a sub-minute remake ("45s") or an
  // exact-minute game ("30m").
  const mAndS = trimmed.match(/^(?:(\d{1,3})m)?\s*(?:(\d{1,2})s)?$/i);
  if (mAndS && (mAndS[1] || mAndS[2])) {
    const mins = Number(mAndS[1] ?? 0);
    const secs = Number(mAndS[2] ?? 0);
    if (secs < 60) return (mins * 60 + secs) * 1000;
  }

  // Legacy "m:ss" form.
  const colon = trimmed.match(/^(\d{1,3}):(\d{1,2})$/);
  if (colon) {
    const mins = Number(colon[1]);
    const secs = Number(colon[2]);
    if (secs < 60) return (mins * 60 + secs) * 1000;
  }

  return FALLBACK;
}

export function ScopeSpecifyTime({
  matchId,
  userPuuid,
  routingRegion,
  durationStr,
  onBack,
  subjectAChampion,
  subjectBChampion,
  match,
  you,
  onRun,
}: {
  matchId: string;
  userPuuid: string;
  routingRegion?: "americas" | "europe" | "asia" | "sea";
  /** Match duration in "m:ss" form (from Match.duration). */
  durationStr: string;
  onBack: () => void;
  /**
   * Champion names for the two compared subjects. Forwarded as-is to
   * TimelineWindowResult so the prompt preview can substitute the
   * SUBJECT_A / SUBJECT_B placeholders. Optional to keep this component
   * usable in contexts that don't yet have the picked ally.
   */
  subjectAChampion?: string;
  subjectBChampion?: string;
  /**
   * Full match + viewing player. Forwarded to TimelineWindowResult so it
   * can build the per-team champion+role rundown injected into the upper
   * prompt. Optional so callers without this data still render (the
   * rundown is simply omitted).
   */
  match?: Match;
  you?: Participant;
  /**
   * Optional override for the Run button. When provided, clicking Run
   * calls `onRun(range)` instead of fetching the merged timeline window
   * inline — the parent then drives the next stage (e.g. mocked Judge
   * pipeline). When omitted, the original inline fetch + prompt sandwich
   * preview is rendered as before.
   */
  onRun?: (range: TimeRange) => void;
}) {
  const gameDurationMs = useMemo(() => parseDurationToMs(durationStr), [durationStr]);

  // Initial window: first 1 minute, clamped to game length. We cap the
  // initial end at MAX so very long games still default to a sane slice.
  const initialEnd = Math.min(MIN_WINDOW_MS, Math.max(MIN_WINDOW_MS, gameDurationMs));
  const [range, setRange] = useState<TimeRange>([0, initialEnd]);

  // `runToken` is bumped on every "Run" click. TimelineWindowResult treats
  // this as the only signal that triggers a fetch, so dragging the slider
  // doesn't accidentally spam Riot.
  const [runToken, setRunToken] = useState(0);

  const span = range[1] - range[0];
  const validSpan = span >= MIN_WINDOW_MS && span <= MAX_WINDOW_MS;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to scope
        </button>
        <span className="text-xs uppercase tracking-wider text-gold">Specify Time</span>
      </div>

      <div className="flex flex-col items-center gap-4">
        <TimeRangePicker
          gameDurationMs={gameDurationMs}
          value={range}
          onChange={setRange}
        />

        <button
          onClick={() => {
            if (onRun) onRun(range);
            else setRunToken((t) => t + 1);
          }}
          disabled={!validSpan}
          className="rounded-lg border border-gold bg-gold/10 px-5 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Verdict
        </button>

        {!onRun && (
        <div className="w-full max-w-3xl">
          <TimelineWindowResult
            matchId={matchId}
            userPuuid={userPuuid}
            routingRegion={routingRegion}
            startMs={range[0]}
            endMs={range[1]}
            runToken={runToken}
            subjectAChampion={subjectAChampion}
            subjectBChampion={subjectBChampion}
            match={match}
            you={you}
          />
        </div>
        )}
      </div>
    </div>
  );
}