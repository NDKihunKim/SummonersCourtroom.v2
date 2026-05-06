// Presentational dropdown for the search-bar autocomplete.
//
// Pure rendering — no business logic, no storage access. The parent owns
// state (highlighted index, open/closed) and passes the already-filtered
// list of items in. This keeps the component trivially testable and easy
// to swap (e.g. when we later add a shared backend index).

import { Trash2, X } from "lucide-react";
import { getShardInfo } from "@/lib/regions";
import type { Suggestion } from "@/hooks/useSuggestions";
import { TierCrest } from "@/components/TierCrest";
import { tierLabel } from "@/lib/tier";
import { ProfileIcon } from "@/components/ProfileIcon";

/**
 * Stable, cheap hash → small int seed for the letter-avatar fallback so the
 * same Riot ID always lands on the same color across renders.
 */
function avatarSeed(name: string, tag: string): number {
  const s = `${name.toLowerCase()}#${tag.toLowerCase()}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 100;
}

interface Props {
  /** Already filtered + sorted suggestions to display (≤5 in practice). */
  items: Suggestion[];
  /** Index of the keyboard-highlighted row, or -1 for none. */
  highlightedIndex: number;
  /** Current query text — used to bold the matching prefix in each row. */
  query: string;
  /** id used to wire `aria-controls` / `aria-activedescendant` from the input. */
  listboxId: string;
  /** Mouse hover updates highlight so keyboard + mouse stay coherent. */
  onHover: (index: number) => void;
  /** User picked a suggestion (click or Enter on highlighted row). */
  onSelect: (item: Suggestion) => void;
  /**
   * User clicked the ✕ on a "recent" row. Only emitted for `source==="recent"`
   * — index entries cannot be removed locally.
   */
  onRemove: (key: string) => void;
  /**
   * Number of locally-stored recent searches (across ALL shards). Drives
   * whether the "Clear all history" footer is rendered. Footer hides when 0
   * to avoid an empty button on first-time visitors.
   */
  recentsCount: number;
  /** User clicked "Clear all history". */
  onClearAll: () => void;
}

/**
 * Renders the matched substring of `text` in bold. Case-insensitive.
 * Falls back to plain text when there's no match (e.g. substring match
 * elsewhere or empty query).
 */
function HighlightedName({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold text-foreground">
        {text.slice(idx, idx + q.length)}
      </span>
      {text.slice(idx + q.length)}
    </>
  );
}

/**
 * Lowercase dedupe key — matches the `recent-searches` storage layer so
 * `onRemove` resolves to the right entry.
 */
function recentRemoveKey(s: Suggestion): string {
  return `${s.shard}|${s.gameName.toLowerCase()}#${s.tagLine.toLowerCase()}`;
}

export function SearchSuggestions({
  items,
  highlightedIndex,
  query,
  listboxId,
  onHover,
  onSelect,
  onRemove,
  recentsCount,
  onClearAll,
}: Props) {
  // Empty list AND no recents to clear → nothing to show.
  // (If items is empty but the user has recents on OTHER shards, we still
  // want to surface the Clear-All affordance, so we don't bail early there.)
  if (items.length === 0 && recentsCount === 0) return null;

  return (
    <div className="animate-fade-in mt-2 overflow-hidden rounded-xl border border-border bg-card/95 backdrop-blur shadow-lg">
      <ul id={listboxId} role="listbox">
        {items.map((item, i) => {
          const shardInfo = getShardInfo(item.shard);
          const isActive = i === highlightedIndex;
          const optionId = `recent-option-${i}`;
          // Stable key per row — combines source + dedupe key so a recent
          // and a stale index row never collide if dedupe ever misses.
          const rowKey = `${item.source}:${item.shard}:${item.gameName}#${item.tagLine}`;
          return (
            <li
              key={rowKey}
              id={optionId}
              role="option"
              aria-selected={isActive}
              // mousedown (not click) so the input's onBlur doesn't fire
              // first and close the dropdown before the click registers.
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item);
              }}
              onMouseEnter={() => onHover(i)}
              className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? "bg-gold/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted/40"
              }`}
            >
            {/* Real profile icon (or letter-avatar fallback) so users
                visually recognise familiar players in the dropdown. */}
            <ProfileIcon
              iconId={item.profileIconId}
              seed={avatarSeed(item.gameName, item.tagLine)}
              size={24}
              className="shrink-0"
              alt=""
            />

              {/* Tier crest — only meaningful for index entries (recents
                  don't carry tier data in v1). Render an empty spacer for
                  recents so columns line up. */}
              {item.source === "index" ? (
                <TierCrest tier={item.tier} size={18} className="shrink-0" />
              ) : (
                <span className="inline-block w-[18px] shrink-0" aria-hidden />
              )}

              {/* Shard chip — subtle, just to remind users which server. */}
              <span
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-1.5 py-0.5 text-[10px] font-semibold"
                aria-hidden
              >
                <span>{shardInfo.emoji}</span>
                <span>{shardInfo.label}</span>
              </span>

              {/* Riot ID — gameName highlighted, tag muted. */}
              <span className="flex-1 truncate">
                <HighlightedName text={item.gameName} query={query} />
                <span className="text-muted-foreground">#{item.tagLine}</span>
              </span>

              {/* Tier label as muted text — only for index entries. */}
              {item.source === "index" && (
                <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                  {tierLabel({
                    tier: item.tier,
                    division: item.division,
                    lp: item.lp,
                  })}
                </span>
              )}

              {/* Remove ✕ — only for local recents. Index entries can't be
                  removed by a single user (they're shared). */}
              {item.source === "recent" ? (
                <button
                  type="button"
                  aria-label={`Remove ${item.gameName}#${item.tagLine} from recent searches`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRemove(recentRemoveKey(item));
                  }}
                  className="rounded p-1 text-muted-foreground opacity-60 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                // Spacer so the row height stays consistent.
                <span className="inline-block w-[22px] shrink-0" aria-hidden />
              )}
            </li>
          );
        })}
      </ul>

      {/* Clear-all footer — only when the user has anything to clear. */}
      {recentsCount > 0 && (
        <div className="border-t border-border bg-background/40">
          <button
            type="button"
            // mousedown so we beat the input's blur close.
            onMouseDown={(e) => {
              e.preventDefault();
              onClearAll();
            }}
            className="flex w-full items-center justify-center gap-2 px-4 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear all history ({recentsCount})
          </button>
        </div>
      )}
    </div>
  );
}
