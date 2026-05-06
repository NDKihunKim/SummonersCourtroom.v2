// TierCrest — small inline-SVG badge for a League ranked tier.
//
// Kept as a single component (no external image assets) so the bundle stays
// lean and we don't have to ship dozens of tier crest PNGs. The shape is a
// stylized hex/diamond with a single-letter abbreviation; color comes from
// the tier's semantic token via tierColorClass().

import { tierColorClass, type Tier } from "@/lib/tier";

interface Props {
  tier: Tier | null | undefined;
  /** Pixel size of the crest. Defaults to 18 to fit nicely in a dropdown row. */
  size?: number;
  /** Extra classes (e.g. "shrink-0"). */
  className?: string;
}

/** Single-letter abbreviation for the crest face. GM = G, Unranked = ? */
function tierLetter(tier: Tier | null | undefined): string {
  switch (tier) {
    case "CHALLENGER":
      return "C";
    case "GRANDMASTER":
      return "G";
    case "MASTER":
      return "M";
    case "DIAMOND":
      return "D";
    case "EMERALD":
      return "E";
    case "PLATINUM":
      return "P";
    case "GOLD":
      return "G";
    case "SILVER":
      return "S";
    case "BRONZE":
      return "B";
    case "IRON":
      return "I";
    default:
      return "?";
  }
}

export function TierCrest({ tier, size = 18, className = "" }: Props) {
  const colorClass = tierColorClass(tier);
  const letter = tierLetter(tier);

  // Hex shape — six points, draws inset so the stroke isn't clipped.
  // Coordinates pre-baked for a 24×24 viewBox; we scale via width/height.
  return (
    <span
      className={`inline-flex items-center justify-center ${colorClass} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      >
        {/* Hex outline */}
        <path d="M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z" />
        {/* Center letter rendered as text so it scales with the SVG */}
        <text
          x="12"
          y="15"
          textAnchor="middle"
          fontSize="9"
          fontWeight="700"
          fill="currentColor"
          stroke="none"
        >
          {letter}
        </text>
      </svg>
    </span>
  );
}
