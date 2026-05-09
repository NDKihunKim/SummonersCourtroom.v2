/**
 * ShowMoreMatchesButton — full-width "Show more" button rendered directly
 * underneath the last `MatchCard` in the recent-matches list.
 *
 * Purely presentational. The parent owns the "expanded" state and decides
 * when to mount or unmount this component (per product spec: the button
 * disappears entirely once the list is fully expanded to 20 matches).
 *
 * Width matches a `MatchCard` row because both live inside the same
 * `flex flex-col gap-2` column in `index.tsx` and stretch to its full width
 * (`w-full`). No extra wrapper is needed.
 */

import { ChevronDown } from "lucide-react";
import type { TranslationKey } from "@/i18n";

interface Props {
  /** How many additional matches will be revealed when clicked. */
  remainingCount: number;
  /** Click handler — parent flips its `expanded` state. */
  onClick: () => void;
  t?: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

export function ShowMoreMatchesButton({ remainingCount, onClick, t }: Props) {
  // Defensive: never render a "Show 0 more" CTA. The parent already guards
  // this, but a second guard here keeps the component safe to drop in
  // anywhere without re-checking the precondition at the call site.
  if (remainingCount <= 0) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        t?.("showMoreMatches", {
          count: remainingCount,
          noun: remainingCount === 1 ? "match" : "matches",
        }) ?? `Show ${remainingCount} more matches`
      }
      className="group flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-gold hover:text-gold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span>
        {t?.("showMoreMatches", {
          count: remainingCount,
          noun: remainingCount === 1 ? "match" : "matches",
        }) ?? `Show ${remainingCount} more ${remainingCount === 1 ? "match" : "matches"}`}
      </span>
      <ChevronDown className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
    </button>
  );
}
