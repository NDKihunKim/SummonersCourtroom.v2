import { useCallback, useEffect, useRef, useState } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import {
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_SHARD,
  getShardInfo,
  type ShardInfo,
  type Shard,
} from "@/lib/regions";
import type { TranslationKey } from "@/i18n";

interface RegionPickerProps {
  value: Shard;
  onChange: (shard: Shard) => void;
  t?: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const REGIONAL_SHARD_ORDER: Shard[] = ["EUW", "NA", "EUNE", "LAN", "LAS", "SEA", "OCE", "ME"];
const COUNTRY_SHARD_ORDER: Shard[] = ["KR", "VN", "BR", "TR", "TW", "PH", "RU", "JP", "TH"];
const REGIONAL_SHARDS = new Set<Shard>(REGIONAL_SHARD_ORDER);
const SCROLL_RAIL_INSET_PX = 8;
const MIN_SCROLL_THUMB_PX = 24;

function isRegionalShard(shard: Shard): boolean {
  return REGIONAL_SHARDS.has(shard);
}

function ShardRow({ shard }: { shard: ShardInfo }) {
  const showEmoji = !isRegionalShard(shard.code);

  return (
    <span className="flex w-full items-center gap-2">
      {showEmoji && <span aria-hidden="true">{shard.emoji}</span>}
      <span className="font-semibold">{shard.label}</span>
      <span className="ml-auto truncate text-xs text-muted-foreground">
        {shard.fullName}
      </span>
    </span>
  );
}

/**
 * Compact shard selector showing flag/emoji + initials in the trigger,
 * with a grouped dropdown organized by Riot routing cluster.
 *
 * Designed to sit inline on the left side of the search bar — the trigger
 * is borderless so it visually belongs to the parent container.
 */
export function RegionPicker({ value, onChange, t }: RegionPickerProps) {
  // Defensive: render the default shard's visuals if value is somehow unknown.
  const current = getShardInfo(value);
  const regionalShards = REGIONAL_SHARD_ORDER.map(getShardInfo);
  const countryShards = COUNTRY_SHARD_ORDER.map(getShardInfo);
  const [open, setOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollThumb, setScrollThumb] = useState({
    visible: false,
    height: MIN_SCROLL_THUMB_PX,
    top: 0,
  });

  const updateScrollThumb = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const { clientHeight, scrollHeight, scrollTop } = viewport;
    const maxScroll = scrollHeight - clientHeight;
    if (maxScroll <= 0) {
      setScrollThumb((currentThumb) =>
        currentThumb.visible ? { ...currentThumb, visible: false } : currentThumb,
      );
      return;
    }

    const railHeight = Math.max(0, clientHeight - SCROLL_RAIL_INSET_PX * 2);
    const height = Math.max(
      MIN_SCROLL_THUMB_PX,
      Math.round((clientHeight / scrollHeight) * railHeight),
    );
    const top = Math.round((scrollTop / maxScroll) * Math.max(0, railHeight - height));

    setScrollThumb({ visible: true, height, top });
  }, []);

  useEffect(() => {
    if (!open) return;

    const frame = requestAnimationFrame(updateScrollThumb);
    window.addEventListener("resize", updateScrollThumb);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateScrollThumb);
    };
  }, [open, updateScrollThumb]);

  return (
    <Select value={current.code} onValueChange={(v) => onChange(v as Shard)} open={open} onOpenChange={setOpen}>
      <SelectTrigger
        // Borderless pill that lives inside the search-bar container.
        className="w-auto min-w-[88px] gap-1.5 border-0 bg-transparent px-3 font-semibold text-foreground shadow-none focus:ring-0 focus:ring-offset-0"
        aria-label={t?.("selectRegion") ?? "Select region / shard"}
      >
        <SelectValue>
          <span className="flex items-center gap-1.5">
            {!isRegionalShard(current.code) && <span aria-hidden="true">{current.emoji}</span>}
            <span>{current.label}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      {/*
        Custom SelectContent built directly on the Radix primitive so we can
        OMIT the SelectScrollUpButton / SelectScrollDownButton that the shared
        `@/components/ui/select` renders by default. Editing the shared
        primitive would affect every Select across the app — scoping the
        change here keeps the impact local to the region picker.

        The Viewport gets a real, always-visible scrollbar (`overflow-y-auto`
        + a max height) so users can simply scroll instead of using arrows.
      */}
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          // Match the visual treatment of the shared SelectContent (border,
          // bg, shadow, animations) so the dropdown still feels native.
          className="relative z-50 min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1"
        >
          {/* No SelectScrollUpButton here — the Viewport scrolls natively. */}
          <SelectPrimitive.Viewport
            ref={viewportRef}
            onScroll={updateScrollThumb}
            // `overflow-y-auto` exposes the browser scrollbar; capping height
            // to a compact panel while respecting Radix's available popper
            // height prevents the dropdown from running off-screen.
            // `scrollbar-always` (defined in styles.css) forces the vertical
            // scrollbar to remain visible so users see the dropdown is
            // scrollable without having to interact first.
            className="scrollbar-always max-h-56 min-w-[var(--radix-select-trigger-width)] overflow-y-scroll py-1 pl-1 pr-3"
            style={{ maxHeight: "min(14rem, var(--radix-select-content-available-height))" }}
          >
            {countryShards.map((s) => (
              <SelectItem
                key={s.code}
                value={s.code}
                className="pr-8 hover:bg-secondary/70 focus:bg-secondary/80 focus:text-foreground data-[highlighted]:bg-secondary/80"
              >
                <ShardRow shard={s} />
              </SelectItem>
            ))}
            <SelectPrimitive.Separator className="my-1 h-px bg-border" />
            {regionalShards.map((s) => (
              <SelectItem
                key={s.code}
                value={s.code}
                className="pr-8 hover:bg-secondary/70 focus:bg-secondary/80 focus:text-foreground data-[highlighted]:bg-secondary/80"
              >
                <ShardRow shard={s} />
              </SelectItem>
            ))}
          </SelectPrimitive.Viewport>
          {scrollThumb.visible && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute bottom-2 right-1.5 top-2 w-1.5 rounded-full bg-border/30"
            >
              <div
                className="mx-auto w-1 rounded-full bg-border"
                style={{
                  height: `${scrollThumb.height}px`,
                  transform: `translateY(${scrollThumb.top}px)`,
                }}
              />
            </div>
          )}
          {/* No SelectScrollDownButton either — scroll bar replaces them. */}
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </Select>
  );
}

export { DEFAULT_SHARD };
