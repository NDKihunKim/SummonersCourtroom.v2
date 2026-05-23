/**
 * ChampionIcon — renders the Data Dragon champion square for the given
 * champion name, with a graceful fallback to a colored letter tile if the
 * image fails to load (404 from a misnamed champion, network error, etc.).
 *
 * Why a dedicated component:
 *   - Centralises the version lookup + URL construction so call sites stay
 *     declarative (`<ChampionIcon champion="Ahri" size={48} />`).
 *   - The `onError` fallback means a single bad icon never blanks the UI —
 *     critical because Riot can ship a new champion before our override map
 *     is updated.
 */

import { useState } from "react";
import { championIconUrl, useDDragonVersion } from "@/lib/ddragon";

interface Props {
  /** Champion display name as returned by Riot match-v5 (e.g. "Ahri"). */
  champion: string;
  /** Square px size — width === height. Defaults to 48. */
  size?: number;
  /** Extra classes on the wrapper. */
  className?: string;
  /**
   * When true, draws a thin gold ring matching the existing avatar style.
   * Defaults to true for visual parity with `SummonerAvatar`.
   */
  ring?: boolean;
}

/** Hash a string to a stable hue 0-359 for the fallback tile. */
function hueFor(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function ChampionIcon({ champion, size = 48, className = "", ring = true }: Props) {
  const version = useDDragonVersion();
  // Track per-instance load failure so a single bad name doesn't poison the
  // rest of the UI — also lets us re-attempt on prop change naturally.
  const [failed, setFailed] = useState(false);

  const ringClass = ring ? "ring-2 ring-gold/60" : "";
  const baseClass = `relative inline-block overflow-hidden rounded-md ${ringClass} ${className}`;

  // Fallback tile — colored gradient with the champion's first letter.
  // Mirrors the look of `SummonerAvatar` so it doesn't feel out of place.
  if (failed || !champion) {
    const hue = hueFor(champion || "?");
    const initial = (champion || "?").slice(0, 1).toUpperCase();
    return (
      <div
        className={baseClass}
        style={{
          width: size,
          height: size,
          background: `linear-gradient(135deg, hsl(${hue} 60% 45%), hsl(${hue} 70% 25%))`,
        }}
        aria-label={champion || "Unknown champion"}
      >
        <span
          className="flex h-full w-full items-center justify-center font-bold text-white"
          style={{ fontSize: size * 0.45 }}
        >
          {initial}
        </span>
      </div>
    );
  }

  return (
    <div className={baseClass} style={{ width: size, height: size }}>
      <img
        src={championIconUrl(champion, version)}
        alt={champion}
        width={size}
        height={size}
        // Lazy load — match cards render up to 10 icons + 4-5 ally tiles.
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        className="h-full w-full scale-[1.09] object-cover"
      />
    </div>
  );
}
