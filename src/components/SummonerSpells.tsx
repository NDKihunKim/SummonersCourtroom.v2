/**
 * SummonerSpells — renders a player's two summoner spells as a vertical
 * 2x1 grid of Data Dragon icons. Designed to sit immediately to the left
 * of the ItemGrid in a match row, mirroring the in-game HUD where the
 * summoner spells live next to the inventory.
 *
 * Why a dedicated component:
 *   - Keeps MatchCard.tsx focused on row layout / Judge workflow.
 *   - Centralises the unknown-spell + broken-image fallback in one place,
 *     same pattern as ItemGrid.
 */

import { useState } from "react";
import { summonerSpellIconUrl, useDDragonVersion } from "@/lib/ddragon";

type SummonerSpellsProps = {
  /** Tuple of the two summoner-spell display names (e.g. ["Flash", "Teleport"]). */
  spells: [string, string];
  /**
   * Per-cell size in px. Default is sized so two stacked cells (plus the
   * 2px gap) match the height of a 3x2 ItemGrid with `size=22`
   * (22 * 2 + 2 = 46 ≈ 22 * 2 + 2).
   */
  size?: number;
};

export function SummonerSpells({ spells, size = 22 }: SummonerSpellsProps) {
  const version = useDDragonVersion();
  return (
    <div
      className="grid gap-0.5"
      // 1 column, 2 rows — explicit inline width keeps the column stable
      // regardless of Tailwind's grid-cols defaults.
      style={{ gridTemplateColumns: `${size}px` }}
    >
      <SpellCell name={spells[0]} size={size} version={version} />
      <SpellCell name={spells[1]} size={size} version={version} />
    </div>
  );
}

/**
 * Single summoner-spell tile. Shows the Data Dragon icon when the spell
 * name maps to a known file, otherwise a muted empty placeholder. Falls
 * back to the placeholder if the icon URL 404s (e.g. unmapped new spell).
 */
function SpellCell({
  name,
  size,
  version,
}: {
  name: string;
  size: number;
  version: string;
}) {
  const [broken, setBroken] = useState(false);
  const url = summonerSpellIconUrl(name, version);
  const isEmpty = !url || broken;

  return (
    <div
      className={`overflow-hidden rounded-sm ring-1 ring-border ${
        isEmpty ? "bg-muted/40" : "bg-muted"
      }`}
      style={{ width: size, height: size }}
      title={name}
    >
      {!isEmpty && url && (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          width={size}
          height={size}
          className="block h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      )}
    </div>
  );
}