import { ChevronDown } from "lucide-react";

/**
 * ExpandToggle — the circular chevron button that opens the AI Judge
 * workflow on a Defeat match row.
 *
 * Why this lives in its own file:
 * - MatchCard already does a lot (roster, items, judge pipeline). Pulling
 *   the toggle's styling concerns out keeps that file focused on
 *   composition.
 * - The toggle has its own visual contract (size, pulse, focus ring) that
 *   we want to keep consistent if we ever reuse it elsewhere.
 *
 * Contract with the caller (MatchCard):
 * - The parent decides WHEN to render this (only on Defeat rows whose
 *   judge slide is closed). This component does NOT gate itself on win/
 *   loss — it just renders the button. That keeps the component dumb /
 *   reusable and lets the parent own match-domain logic.
 */
export function ExpandToggle({
  onClick,
  ariaLabel = "Open AI Judge",
}: {
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      // Layout: 40px circle (h-10/w-10) — noticeably larger than the
      // previous 32px target so it reads as an actual CTA.
      // Color: gold border + soft gold tint at rest so the button stands
      //   apart from the neutral card surface.
      // Animation: `animate-judge-pulse` (defined in src/styles.css)
      //   layers a breathing ring on top of the constant gold glow to
      //   draw the eye. We pause the pulse on hover so the user feels
      //   "in control" once they're targeting it, and we disable it
      //   entirely under prefers-reduced-motion (motion-reduce:*).
      // Interaction: scale up slightly on hover, scale down on press
      //   for tactile feedback. focus-visible ring keeps keyboard users
      //   covered.
      className="
        flex h-9 w-9 shrink-0 items-center justify-center self-center
        rounded-full border-2 border-gold bg-gold/10 text-gold
        transition-all duration-200
        animate-judge-pulse
        hover:bg-gold/20 hover:scale-110 hover:[animation-play-state:paused]
        active:scale-95
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background
        motion-reduce:animate-none
      "
    >
      {/* 18px chevron (size prop on the lucide icon). Slightly bolder
          stroke so the arrow stays crisp at the new size. */}
      <ChevronDown size={18} strokeWidth={2.5} />
    </button>
  );
}
