/**
 * TierEmblem — displays the ranked tier emblem from Community Dragon.
 * The source images are wide canvases with transparent padding, so the image
 * is scaled inside a clipped square box to make the visible emblem readable.
 */

import { useEffect, useState } from "react";
import { TierCrest } from "@/components/TierCrest";
import type { Tier } from "@/lib/tier";

interface Props {
  /** Ranked tier; null/undefined renders the unranked fallback crest. */
  tier: Tier | null | undefined;
  /** Square px size of the emblem. Defaults to 96 — tuned for the header. */
  size?: number;
  className?: string;
}

const EMBLEM_ZOOM = 4.8;

function emblemUrl(tier: Tier): string {
  const slug = tier.toLowerCase();
  return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${slug}.png`;
}

export function TierEmblem({ tier, size = 96, className = "" }: Props) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [tier]);

  if (!tier || failed) {
    return <TierCrest tier={tier ?? null} size={size} className={className} />;
  }

  return (
    <span
      className={`inline-flex items-center justify-center overflow-hidden${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
    >
      <img
        src={emblemUrl(tier)}
        alt={`${tier.charAt(0)}${tier.slice(1).toLowerCase()} ranked emblem`}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        className="block max-w-none object-contain"
        style={{ width: size * EMBLEM_ZOOM, height: "auto" }}
      />
    </span>
  );
}
