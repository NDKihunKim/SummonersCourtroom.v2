/**
 * SampleSizeSelector — segmented 10 / 20 / 30 control for the Performance
 * Block in the Summoner Header.
 *
 * Design notes:
 * - Pure presentational component. State lives in `useSampleSize` (parent).
 * - Uses the existing semantic Tailwind tokens only (no hardcoded colors)
 *   so it inherits theme changes for free.
 * - Accessible: rendered as a `radiogroup` with arrow-key navigation and
 *   `aria-checked` reflecting the selected option.
 */

import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { SAMPLE_SIZE_OPTIONS, type SampleSize } from "@/lib/match-stats";

export interface SampleSizeSelectorProps {
  value: SampleSize;
  onChange: (next: SampleSize) => void;
  /** Optional wrapper class — lets the parent fine-tune spacing. */
  className?: string;
}

export function SampleSizeSelector({
  value,
  onChange,
  className,
}: SampleSizeSelectorProps) {
  // Track button refs so arrow-key navigation can move focus to the next
  // option. Index-aligned with SAMPLE_SIZE_OPTIONS.
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Keyboard handler — left/right cycle through the options, wrapping at the
  // ends. Mirrors the WAI-ARIA Authoring Practices radiogroup pattern.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const nextIdx =
        (idx + dir + SAMPLE_SIZE_OPTIONS.length) % SAMPLE_SIZE_OPTIONS.length;
      const nextValue = SAMPLE_SIZE_OPTIONS[nextIdx];
      onChange(nextValue);
      btnRefs.current[nextIdx]?.focus();
    },
    [onChange],
  );

  return (
    <div
      role="radiogroup"
      aria-label="Number of recent matches to use for performance stats"
      className={cn(
        // Compact pill group — borrows the same border/radius vocabulary as
        // the surrounding card so it feels native to the header.
        "inline-flex items-center rounded-full border border-border bg-card/60 p-0.5",
        className,
      )}
    >
      {SAMPLE_SIZE_OPTIONS.map((opt, idx) => {
        const isActive = opt === value;
        return (
          <button
            key={opt}
            ref={(el) => {
              btnRefs.current[idx] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            // Only the active option is in the tab order; arrow keys move
            // between the rest. Standard radiogroup behavior.
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(opt)}
            onKeyDown={(e) => onKeyDown(e, idx)}
            className={cn(
              "min-w-[2rem] rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              isActive
                ? // Active uses the gold accent already used by the trophy
                  // icon for visual continuity.
                  "bg-gold/15 text-gold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}