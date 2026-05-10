/**
 * ItemGrid — renders a player's end-game inventory in the familiar in-game
 * shape: a 3x2 grid of the 6 main items, with the trinket sitting as a
 * single tile to the right of the grid.
 *
 * Why a dedicated component:
 *   - Keeps MatchCard.tsx focused on row layout / Judge workflow.
 *   - Reusable on the verdict screen later if we want to surface the
 *     compared player's inventory there too.
 *   - Centralises the empty-slot + broken-image fallback rules.
 */

import { useState } from "react";
import { itemIconUrl, useDDragonVersion, useItemNameFormatter } from "@/lib/ddragon";
import type { Locale } from "@/i18n";

type ItemGridProps = {
  /** 6 main inventory slots (item0..item5). 0 = empty slot. */
  items: number[];
  /** Trinket slot (item6). 0 = no trinket. */
  trinket: number;
  /**
   * Tile size in px. Default keeps the 2-row grid roughly the same height
   * as the KDA column so match rows don't grow taller.
   */
  size?: number;
  locale?: Locale;
};

export function ItemGrid({ items, trinket, size = 22, locale = "en" }: ItemGridProps) {
  const version = useDDragonVersion();
  const itemName = useItemNameFormatter(locale);

  // Pad/trim to exactly 6 cells so the 3x2 grid never collapses, even if
  // upstream data ever sends a shorter array (defensive — Riot always
  // returns 6, but the type allows any length).
  const mainSix: number[] = Array.from({ length: 6 }, (_, i) => items[i] ?? 0);

  return (
    <div className="flex items-center gap-1.5">
      {/* 3 columns x 2 rows main inventory */}
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(3, ${size}px)` }}
      >
        {mainSix.map((id, i) => (
          <ItemCell
            key={i}
            id={id}
            size={size}
            version={version}
            name={id > 0 ? itemName(id) : undefined}
          />
        ))}
      </div>
      {/* Trinket — visually separated from the main grid by a thin divider
          so it reads as a distinct slot, mirroring the in-game HUD. */}
      <div className="h-full w-px bg-border/60" style={{ height: size * 2 + 2 }} />
      <ItemCell
        id={trinket}
        size={size}
        version={version}
        name={trinket > 0 ? itemName(trinket) : undefined}
      />
    </div>
  );
}

/**
 * A single inventory tile. Renders the Data Dragon icon when we have an
 * item id, otherwise an empty muted placeholder so the grid stays aligned.
 * If the icon URL 404s (e.g. the item was removed in a recent patch), we
 * swap to the empty-tile look instead of showing a broken-image glyph.
 */
function ItemCell({
  id,
  size,
  version,
  name,
}: {
  id: number;
  size: number;
  version: string;
  name?: string;
}) {
  const [broken, setBroken] = useState(false);
  const isEmpty = id <= 0 || broken;
  const label = !isEmpty ? name ?? `Item ${id}` : undefined;

  return (
    <div
      className={`overflow-hidden rounded-sm ring-1 ring-border ${
        isEmpty ? "bg-muted/40" : "bg-muted"
      }`}
      style={{ width: size, height: size }}
      title={label}
    >
      {!isEmpty && (
        <img
          src={itemIconUrl(id, version)}
          alt={label ?? ""}
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
