import { useEffect, useState } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import type { TranslationKey } from "@/i18n";

/**
 * Dual-handle range picker for the "Specify Time" Judge scope.
 *
 * The component is intentionally presentational: it owns no async state and
 * exposes a controlled `value` / `onChange` pair. The parent decides when to
 * actually fetch (we only refetch on an explicit "Run" click — see
 * ScopeSpecifyTime).
 *
 * Constraints enforced here (also re-enforced server-side in Python):
 *   - window length ∈ [MIN_WINDOW_MS, MAX_WINDOW_MS]
 *   - both bounds clamped to [0, gameDurationMs]
 *   - dragging one handle past the other auto-pushes the partner so the
 *     window never inverts and never shrinks below MIN.
 */

export const MIN_WINDOW_MS = 5 * 60_000;    // 5 minutes
export const MAX_WINDOW_MS = 10 * 60_000;   // 10 minutes

export type TimeRange = [number, number];

/** Format ms as "m:ss" (LoL-style; hours unrealistic for a single match). */
export function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatKoreanLength(ms: number): { minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    minutes: Math.floor(total / 60),
    seconds: total % 60,
  };
}

/** Parse "m:ss" or "mm:ss" or plain "seconds". Returns null on garbage. */
function parseMmSs(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // "m:ss" form
  const colon = trimmed.match(/^(\d{1,3}):(\d{1,2})$/);
  if (colon) {
    const mins = Number(colon[1]);
    const secs = Number(colon[2]);
    if (secs >= 60) return null;
    return (mins * 60 + secs) * 1000;
  }
  // Bare integer = seconds.
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  return null;
}

export function TimeRangePicker({
  gameDurationMs,
  value,
  onChange,
  t,
}: {
  /** Total match length in ms; the slider's hard upper bound. */
  gameDurationMs: number;
  value: TimeRange;
  onChange: (next: TimeRange) => void;
  t?: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  // Local string state for the inputs so the user can type "1:" mid-edit
  // without us snapping it back to a clamped numeric value on every keystroke.
  // We commit on blur / Enter.
  const [startStr, setStartStr] = useState(formatMs(value[0]));
  const [endStr, setEndStr] = useState(formatMs(value[1]));
  const windowLength = formatKoreanLength(value[1] - value[0]);

  // Keep the input strings in sync when the parent updates `value`
  // (e.g. via slider drag, or when reopening the panel).
  useEffect(() => {
    setStartStr(formatMs(value[0]));
    setEndStr(formatMs(value[1]));
  }, [value]);

  /**
   * Apply a candidate [start, end] pair through the constraint pipeline:
   *   1. Clamp both to [0, gameDurationMs].
   *   2. If window < MIN, push the *other* handle to satisfy MIN
   *      (preferring to keep the just-edited handle in place).
   *   3. If window > MAX, same idea but in reverse.
   *   4. Final clamp to game length so step 2/3 can't overflow.
   *
   * `editedHandle` tells us which handle the user just touched so we know
   * which one to pin when adjusting the partner.
   */
  function commit(
    rawStart: number,
    rawEnd: number,
    editedHandle: "start" | "end" | "both",
  ) {
    const cap = Math.max(MIN_WINDOW_MS, gameDurationMs);
    let s = Math.max(0, Math.min(rawStart, cap));
    let e = Math.max(0, Math.min(rawEnd, cap));

    if (e < s) [s, e] = [e, s]; // never invert

    let span = e - s;

    // Enforce minimum span.
    if (span < MIN_WINDOW_MS) {
      if (editedHandle === "start") {
        // Pin start, push end forward.
        e = Math.min(s + MIN_WINDOW_MS, cap);
        // If end hit the cap, drag start back instead.
        if (e - s < MIN_WINDOW_MS) s = Math.max(0, e - MIN_WINDOW_MS);
      } else {
        // Pin end, push start back.
        s = Math.max(0, e - MIN_WINDOW_MS);
        if (e - s < MIN_WINDOW_MS) e = Math.min(s + MIN_WINDOW_MS, cap);
      }
      span = e - s;
    }

    // Enforce maximum span.
    if (span > MAX_WINDOW_MS) {
      if (editedHandle === "end") {
        s = e - MAX_WINDOW_MS;
      } else {
        e = s + MAX_WINDOW_MS;
      }
    }

    onChange([s, e]);
  }

  function commitStartFromInput() {
    const parsed = parseMmSs(startStr);
    if (parsed == null) {
      // Invalid input → revert visual to current valid value.
      setStartStr(formatMs(value[0]));
      return;
    }
    commit(parsed, value[1], "start");
  }

  function commitEndFromInput() {
    const parsed = parseMmSs(endStr);
    if (parsed == null) {
      setEndStr(formatMs(value[1]));
      return;
    }
    commit(value[0], parsed, "end");
  }

  // The radix Slider needs us to render exactly as many <Thumb /> as the
  // value array has entries. The shadcn wrapper hard-codes a single thumb,
  // so we go directly to the primitive here for the dual-handle case.
  return (
    <div className="w-full max-w-2xl">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {t?.("timeSelection") ?? "Time:"}{" "}
          <span className="font-mono text-foreground">
            {formatMs(value[0])} – {formatMs(value[1])}
          </span>{" "}
          ({t?.("selectedWindowLength", windowLength) ?? `${formatMs(value[1] - value[0])} long`})
        </span>
        <span className="font-mono">
          {t?.("gameTime") ?? "Game:"} {formatMs(gameDurationMs)}
        </span>
      </div>

      <SliderPrimitive.Root
        // Dual-handle range; the Slider re-renders one Thumb per value entry.
        className="relative flex h-6 w-full touch-none select-none items-center"
        min={0}
        max={Math.max(MIN_WINDOW_MS, gameDurationMs)}
        // 1-second resolution — fine-grained enough for highlight selection,
        // coarse enough to keep the slider snappy.
        step={1000}
        value={[value[0], value[1]]}
        // `minStepsBetweenThumbs` enforces a small gap at the slider level
        // so the two thumbs can't visually overlap; the real MIN_WINDOW
        // constraint is enforced in commit().
        minStepsBetweenThumbs={1}
        onValueChange={(next) => {
          // Radix passes [a, b] sorted ascending. We can't tell which thumb
          // moved without comparing to the previous value — do that here so
          // commit() knows which side to pin.
          if (!Array.isArray(next) || next.length !== 2) return;
          const [na, nb] = next as [number, number];
          const movedStart = na !== value[0];
          const movedEnd = nb !== value[1];
          const edited =
            movedStart && !movedEnd ? "start" : movedEnd && !movedStart ? "end" : "both";
          commit(na, nb, edited);
        }}
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20">
          <SliderPrimitive.Range className="absolute h-full bg-gold" />
        </SliderPrimitive.Track>
        {/* Two thumbs — one per value entry. Radix pairs them by index. */}
        <SliderPrimitive.Thumb
          aria-label="Window start"
          className="block h-4 w-4 rounded-full border border-gold bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <SliderPrimitive.Thumb
          aria-label="Window end"
          className="block h-4 w-4 rounded-full border border-gold bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </SliderPrimitive.Root>

      <div className="mt-3 flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 text-muted-foreground">
          {t?.("startTime") ?? "Start"}
          <input
            type="text"
            inputMode="numeric"
            value={startStr}
            onChange={(e) => setStartStr(e.target.value)}
            onBlur={commitStartFromInput}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitStartFromInput();
              }
            }}
            placeholder="m:ss"
            className="w-16 rounded border border-border bg-card px-2 py-1 text-center font-mono text-foreground focus:border-gold focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          {t?.("endTime") ?? "End"}
          <input
            type="text"
            inputMode="numeric"
            value={endStr}
            onChange={(e) => setEndStr(e.target.value)}
            onBlur={commitEndFromInput}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitEndFromInput();
              }
            }}
            placeholder="m:ss"
            className="w-16 rounded border border-border bg-card px-2 py-1 text-center font-mono text-foreground focus:border-gold focus:outline-none"
          />
        </label>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
          {t?.("minMaxWindow") ?? "Min 5:00 · Max 10:00"}
        </span>
      </div>
    </div>
  );
}
