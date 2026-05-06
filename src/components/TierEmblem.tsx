/**
 * TierEmblem — displays the official Riot ranked tier emblem image.
 *
 * Source: Community Dragon CDN (community-maintained mirror of Riot's
 * client assets). We deliberately avoid bundling the emblem PNGs locally
 * because:
 *   - There are 10 tiers × multiple resolutions; bundling bloats the app.
 *   - Riot occasionally re-skins the emblems each season; the CDN tracks
 *     "latest" automatically so we get refreshed art for free.
 *
 * Asset selection (in priority order):
 *   1. `ranked-mini-crests/<tier>.png` — tight 80×80 square crops with only
 *      ~8px transparent padding. These make the crest fill the rendered box,
 *      avoiding the "tiny icon floating in a huge frame" problem caused by
 *      the wide 1280×720 hero emblems (where the crest only occupies ~20%
 *      of the canvas, so `object-contain` shrinks it dramatically).
 *   2. `ranked-emblem/emblem-<tier>.png` — the wide hero emblem. Used as a
 *      fallback because some tiers (notably Emerald, added mid-2024) are
 *      not published as mini-crests on Community Dragon.
 *   3. Inline `TierCrest` SVG — final fallback when both CDN URLs fail
 *      (offline, network blocked, totally new tier name).
 *
 * Also rendered when the player is unranked (`tier == null`).
 *
 * This keeps the header layout stable even when the emblem can't render.
 */

import { useState } from "react";
import { TierCrest } from "@/components/TierCrest";
import type { Tier } from "@/lib/tier";

interface Props {
  /** Ranked tier; null/undefined renders the unranked fallback crest. */
  tier: Tier | null | undefined;
  /** Square px size of the emblem. Defaults to 96 — tuned for the header. */
  size?: number;
  className?: string;
}

/**
 * Build the tight mini-crest URL (80×80, almost no transparent padding).
 * Tier names map directly to the CDN's lowercase filenames
 * (e.g. "GRANDMASTER" → "grandmaster.png").
 *
 * Note: Emerald is not published under this path as of writing — the
 * `<img onError>` handler will transparently swap to the wide emblem.
 */
function miniCrestUrl(tier: Tier): string {
  const slug = tier.toLowerCase();
  return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/${slug}.png`;
}

/**
 * Build the wide hero emblem URL (1280×720 with large transparent padding).
 * Used as a fallback for tiers without a mini-crest.
 */
function emblemUrl(tier: Tier): string {
  const slug = tier.toLowerCase();
  return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${slug}.png`;
}

/**
 * Image source fallback chain. Each stage is attempted in order, advancing
 * on `<img onError>` until we either succeed or exhaust the chain.
 *   "mini" → tight square crest (best visual fit; the default).
 *   "wide" → wide hero emblem (covers Emerald + any future gaps).
 *   "svg"  → inline SVG fallback (handles total network failure).
 */
type ImgStage = "mini" | "wide" | "svg";

export function TierEmblem({ tier, size = 96, className = "" }: Props) {
  // Track which CDN asset we're currently attempting. Local to this instance,
  // so sibling emblems don't share failure state. Implicitly resets to
  // "mini" when the parent re-mounts the component (e.g. on profile refresh).
  const [stage, setStage] = useState<ImgStage>("mini");

  // Unranked or upstream image error → render the inline SVG crest at a
  // similar visual weight so the column doesn't collapse.
  if (!tier || stage === "svg") {
    return <TierCrest tier={tier ?? null} size={size} className={className} />;
  }

  // Pick the URL for the current attempt. The mini-crest is preferred
  // because its content fills almost the entire image — no wasted box.
  const src = stage === "mini" ? miniCrestUrl(tier) : emblemUrl(tier);

  return (
    <img
      // `key` forces React to treat each stage as a fresh <img>, ensuring
      // the browser actually re-fetches the new src instead of reusing a
      // cached error state from the previous attempt.
      key={stage}
      src={src}
      alt={`${tier.charAt(0)}${tier.slice(1).toLowerCase()} ranked emblem`}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      // Advance the fallback chain on any load error: mini → wide → svg.
      // Keeps the layout stable across CDN coverage gaps and offline cases.
      onError={() => setStage((prev) => (prev === "mini" ? "wide" : "svg"))}
      // `object-contain` preserves whatever transparent padding the asset
      // ships with, so the crest art is never cropped against the box edges.
      // For mini-crests the padding is tiny (~10%), so the visible crest
      // fills the rendered box — fixing the "tiny icon, huge border" issue.
      className={`block h-auto w-auto object-contain${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
    />
  );
}
