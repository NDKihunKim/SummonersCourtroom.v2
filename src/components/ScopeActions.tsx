import type { TranslationKey } from "@/i18n";

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

export function ScopeActions({
  onFullGame,
  onCancel,
  onSpecifyTime,
  onLegacyFullGame,
  onV2FullContext,
  isWin,
  isShortGame,
  subjectsReady,
  showSpecifyTime,
  t,
}: {
  onFullGame: () => void;
  onCancel?: () => void;
  onLegacyFullGame?: () => void;
  onV2FullContext?: () => void;
  /**
   * When provided, the "Specify Time" button is enabled and triggers this
   * callback. Omitted (undefined) for matches that lack the matchId/puuid
   * needed to fetch a timeline window — button stays disabled in that case.
   */
  onSpecifyTime?: () => void;
  isShortGame: boolean;
  subjectsReady: boolean;
  showSpecifyTime: boolean;
  /**
   * True when this match is a Victory. On wins we hide the "Full game"
   * button entirely — full-game judging is intentionally Defeat-only,
   * since the prompt is framed around assigning fault for a loss. Wins
   * can still be analyzed via the Specify-Time scope, which is neutral.
   */
  isWin: boolean;
  t: Translate;
}) {
  const fullGameDisabled = isWin || isShortGame || !subjectsReady;
  const fullGameTitle = isShortGame
    ? t("verdictGameTooShortWarning")
    : !subjectsReady
      ? undefined
      : isWin
        ? t("fullGameVictoryUnavailable")
        : undefined;
  const specifyTimeTitle = isShortGame
    ? t("verdictGameTooShortWarning")
    : !subjectsReady
      ? undefined
      : onSpecifyTime
        ? "Pick a 5-10 min slice of the game"
        : "Match metadata unavailable";
  const v2FullContextTitle = isShortGame
    ? t("verdictGameTooShortWarning")
    : !subjectsReady
      ? undefined
      : onV2FullContext
        ? "Open V2 full-game context from top gold-shift windows"
        : "Match metadata unavailable";
  const legacyFullGameTitle = isShortGame
    ? t("verdictGameTooShortWarning")
    : !subjectsReady
      ? undefined
      : isWin
        ? t("fullGameVictoryUnavailable")
        : onLegacyFullGame
          ? "Run legacy V1 full-game verdict"
          : "Match metadata unavailable";

  return (
    <div className="mt-4 animate-fade-in">
      <div className="flex flex-wrap justify-center gap-3">
        {showSpecifyTime && (
          <button
            onClick={onSpecifyTime}
            disabled={!onSpecifyTime || !subjectsReady}
            className={
              onSpecifyTime && subjectsReady
                ? "rounded-lg border border-gold bg-gold/10 px-5 py-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/20"
                : "cursor-not-allowed rounded-lg border border-border bg-muted/40 px-5 py-3 text-sm font-semibold text-muted-foreground"
            }
            title={specifyTimeTitle}
          >
            {t("specifyTime")}
          </button>
        )}
        {showSpecifyTime && (
          <button
            onClick={fullGameDisabled ? undefined : onLegacyFullGame}
            disabled={fullGameDisabled || !onLegacyFullGame}
            className={
              !fullGameDisabled && onLegacyFullGame
                ? "rounded-lg border border-border px-5 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:border-gold hover:text-gold"
                : "cursor-not-allowed rounded-lg border border-border bg-muted/40 px-5 py-3 text-sm font-semibold text-muted-foreground"
            }
            title={legacyFullGameTitle}
          >
            V1 Verdict
          </button>
        )}
        {showSpecifyTime && (
          <button
            onClick={onV2FullContext}
            disabled={!onV2FullContext || !subjectsReady}
            className={
              onV2FullContext && subjectsReady
                ? "rounded-lg border border-border px-5 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:border-gold hover:text-gold"
                : "cursor-not-allowed rounded-lg border border-border bg-muted/40 px-5 py-3 text-sm font-semibold text-muted-foreground"
            }
            title={v2FullContextTitle}
          >
            V2 Full Context
          </button>
        )}
        {/* Full-game scope is Defeat-only. Victory rows still show the
            option disabled so users understand the feature boundary. */}
        <button
          onClick={fullGameDisabled ? undefined : onFullGame}
          disabled={fullGameDisabled}
          title={fullGameTitle}
          className={
            fullGameDisabled
              ? "cursor-not-allowed rounded-lg border border-border bg-muted/40 px-5 py-3 text-sm font-semibold text-muted-foreground"
              : "rounded-lg border border-gold bg-gold/10 px-5 py-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/20"
          }
        >
          {t("fullGame")}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded-lg border border-gold bg-gold/10 px-5 py-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/20"
          >
            {t("cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
