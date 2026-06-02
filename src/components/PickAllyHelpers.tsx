import { ChampionIcon } from "./ChampionIcon";
import type { TranslationKey } from "@/i18n";

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

export function ModeButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? "border-gold bg-gold/15 text-gold"
          : disabled
            ? "cursor-not-allowed border-border bg-muted/30 text-muted-foreground/60"
            : "border-border bg-card text-muted-foreground hover:border-gold hover:text-gold"
      }`}
    >
      {children}
    </button>
  );
}

export function PlayerTile({
  name,
  champion,
  championLabel = champion,
  kda,
  highlighted,
  role,
}: {
  name: string;
  champion: string;
  championLabel?: string;
  kda: string;
  highlighted?: boolean;
  role?: string;
}) {
  return (
    <div
      className={`flex w-28 shrink-0 flex-col items-center gap-1 overflow-hidden rounded-lg border p-2 transition-all ${
        highlighted
          ? "border-gold bg-secondary/50"
          : "border-border bg-card hover:border-gold/40 hover:bg-secondary/40"
      }`}
    >
      {role ? (
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gold/80">
          {role}
        </span>
      ) : null}
      {/* Real champion square — instantly recognisable to LoL players,
          which is exactly what the "pick the bigger fault" UI needs. */}
      <ChampionIcon champion={champion} size={48} />
      {/* `w-full min-w-0` is required for `truncate` to engage on unbroken
          strings (e.g. CJK summoner names without spaces) inside a flex
          column with `items-center`. Without an explicit width, the span
          shrinks to fit its content and overflows the tile. The `title`
          attribute keeps the full name accessible on hover. */}
      <span
        className="block w-full min-w-0 truncate text-center text-xs font-semibold text-foreground"
        title={championLabel}
      >
        {championLabel}
      </span>
      <span
        className="block w-full min-w-0 truncate text-center text-[10px] text-muted-foreground"
        title={name}
      >
        {name}
      </span>
      <span className="text-[10px] text-muted-foreground">{kda}</span>
    </div>
  );
}
