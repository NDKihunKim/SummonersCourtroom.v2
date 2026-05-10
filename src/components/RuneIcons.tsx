/**
 * RuneIcons — renders a player's keystone rune (top) and secondary tree
 * icon (bottom) as a vertical 2x1 grid. Designed to sit between the
 * SummonerSpells and ItemGrid in a match row.
 *
 * Falls back to muted empty placeholders for unknown ids or broken images,
 * matching SummonerSpells' visual style.
 */

import { useState } from "react";
import { runeIconUrl, runeStyleIconUrl, useRuneNameFormatter } from "@/lib/ddragon";
import type { Locale } from "@/i18n";

type RuneIconsProps = {
  /** Keystone perk + secondary tree ids. Undefined renders empty tiles. */
  runes?: { keystoneId: number; secondaryStyleId: number };
  /** Per-cell size in px. Matches SummonerSpells default. */
  size?: number;
  locale?: Locale;
};

export function RuneIcons({ runes, size = 22, locale = "en" }: RuneIconsProps) {
  const { perkName, styleName } = useRuneNameFormatter(locale);

  return (
    <div className="grid gap-0.5" style={{ gridTemplateColumns: `${size}px` }}>
      <RuneCell
        url={runes ? runeIconUrl(runes.keystoneId) : null}
        size={size}
        title={runes ? perkName(runes.keystoneId) ?? "Keystone" : undefined}
      />
      <RuneCell
        url={runes ? runeStyleIconUrl(runes.secondaryStyleId) : null}
        size={size}
        title={runes ? styleName(runes.secondaryStyleId) ?? "Secondary tree" : undefined}
        // Tree icons are smaller PNGs with transparent backgrounds — use
        // contain so they don't get cropped to a square fill.
        contain
      />
    </div>
  );
}

function RuneCell({
  url,
  size,
  title,
  contain,
}: {
  url: string | null;
  size: number;
  title?: string;
  contain?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const isEmpty = !url || broken;
  return (
    <div
      className={`overflow-hidden rounded-sm ring-1 ring-border ${
        isEmpty ? "bg-muted/40" : "bg-muted"
      }`}
      style={{ width: size, height: size }}
      title={title}
    >
      {!isEmpty && url && (
        <img
          src={url}
          alt={title ?? ""}
          loading="lazy"
          decoding="async"
          width={size}
          height={size}
          className={`block h-full w-full ${contain ? "object-contain" : "object-cover"}`}
          onError={() => setBroken(true)}
        />
      )}
    </div>
  );
}
