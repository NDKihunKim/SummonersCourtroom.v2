/**
 * ProfileIcon — renders a summoner's real Data Dragon profile icon.
 *
 * Falls back to the existing colored letter avatar (`SummonerAvatar`) when:
 *   - We don't have a `profileIconId` for this player yet (e.g. local
 *     "recent" entries from before the cache stored it).
 *   - The image fails to load (very stale icon id no longer hosted, etc.).
 *
 * Keeping the fallback pixel-identical to the previous avatar means the
 * UI never has a blank slot while we wait for icons to backfill.
 */

import { useState } from "react";
import { profileIconUrl, useDDragonVersion } from "@/lib/ddragon";
import { SummonerAvatar } from "@/components/SummonerAvatar";

interface Props {
  /** Riot summoner profileIconId. When missing, we render the letter avatar. */
  iconId?: number | null;
  /** Stable seed for the letter-avatar fallback (so colors don't reshuffle). */
  seed: number;
  /** Square px size. */
  size?: number;
  /** Optional level badge — passed straight through to SummonerAvatar. */
  level?: number;
  className?: string;
  /** Accessible label — typically the Riot ID. */
  alt?: string;
}

export function ProfileIcon({ iconId, seed, size = 56, level, className = "", alt }: Props) {
  // Per-instance failure flag — lets us hot-swap to the fallback without
  // re-rendering the parent or losing scroll position.
  const [failed, setFailed] = useState(false);
  const version = useDDragonVersion();

  // No icon id (or load failed) → use the legacy letter avatar verbatim.
  if (failed || iconId == null || !Number.isFinite(iconId)) {
    return <SummonerAvatar seed={seed} size={size} level={level} className={className} />;
  }

  return (
    <div
      className={`relative inline-block ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={profileIconUrl(iconId, version)}
        alt={alt ?? "Summoner profile icon"}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        className="h-full w-full rounded-md object-cover ring-2 ring-gold/60"
      />
      {level !== undefined && (
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold text-gold ring-1 ring-gold/60">
          {level}
        </span>
      )}
    </div>
  );
}