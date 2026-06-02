import { Gavel, Share2 } from "lucide-react";
import { ObjectionPanel } from "./ObjectionPanel";
import { MatchupHeader } from "./MatchupHeader";
import type { SharedVerdictPayload } from "@/functions/shared-verdict.functions";
import type { Participant } from "@/lib/match-types";
import type { TranslationKey } from "@/i18n";

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;
type VerdictDisplay = { championName: string; championKey?: string; summonerName?: string };
type ReasoningChoice = { index: number; text: string; explanation?: string };

const SHOW_DEV_CONTEXT = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_CONTEXT === "true";

export function SharedVerdictResult({
  verdict,
  t,
  onNewVerdict,
}: {
  verdict: SharedVerdictPayload;
  t: Translate;
  onNewVerdict?: () => void;
}) {
  const sharedPlayers = verdict.selectedPlayers.map(
    (player): Participant => ({
      champion: player.champion,
      summoner: player.summoner ?? player.championLabel ?? player.champion,
      kills: player.kills ?? 0,
      deaths: player.deaths ?? 0,
      assists: player.assists ?? 0,
    }),
  );
  const championLabels = new Map(
    verdict.selectedPlayers.map((player) => [
      player.champion,
      player.championLabel ?? player.champion,
    ]),
  );

  return (
    <div>
      {sharedPlayers.length >= 2 ? (
        <MatchupHeader
          you={sharedPlayers[0]}
          ally={sharedPlayers[1]}
          players={sharedPlayers.length > 2 ? sharedPlayers : undefined}
          highlightChampionKey={verdict.verdictDisplay.championKey}
          highlightChampionName={verdict.verdictDisplay.championName}
          formatChampionName={(champion) => championLabels.get(champion) ?? champion}
        />
      ) : null}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gavel className="h-4 w-4 text-gold" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gold">
            Shared Verdict
          </h3>
        </div>
        {verdict.scopeLabel && (
          <div className="text-right text-sm font-semibold uppercase tracking-wider text-gold">
            {verdict.scopeLabel}
          </div>
        )}
      </div>
      <div className="mb-3 rounded-lg border border-gold bg-gold/10 p-4 text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gold/80">
          {t("moreAtFault")}
        </div>
        <div className="mt-1 text-2xl font-bold text-gold">
          {verdict.verdictDisplay.championName}
        </div>
        {verdict.verdictDisplay.summonerName && (
          <div className="mt-1 text-xs font-medium text-muted-foreground">
            {verdict.verdictDisplay.summonerName}
          </div>
        )}
      </div>
      <p className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm leading-relaxed text-foreground">
        {verdict.reasoning}
      </p>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onNewVerdict}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {t("newVerdict")}
        </button>
      </div>
    </div>
  );
}

export function Verdict({
  verdictDisplay,
  reasoning,
  windowLabel,
  onClose,
  onAgain,
  onShare,
  sharing,
  shareDisabled,
  onSubmitObjection,
  onAfterObjection,
  onViewContext,
  t,
}: {
  verdictDisplay: VerdictDisplay | null;
  reasoning: string;
  windowLabel: string | null;
  onClose: () => void;
  onAgain: () => void;
  onShare: () => void;
  sharing: boolean;
  shareDisabled: boolean;
  onSubmitObjection: (selectedReasons: ReasoningChoice[], feedback?: string) => Promise<void>;
  onAfterObjection: () => void;
  onViewContext: () => void;
  t: Translate;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gavel className="h-4 w-4 text-gold" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gold">
            {t("verdictTitle")}
          </h3>
        </div>
        {windowLabel && (
          <div className="text-right text-sm font-semibold uppercase tracking-wider text-gold">
            {windowLabel}
          </div>
        )}
      </div>
      {verdictDisplay && (
        <div className="mb-3 rounded-lg border border-gold bg-gold/10 p-4 text-center">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gold/80">
            {t("moreAtFault")}
          </div>
          <div className="mt-1 text-2xl font-bold text-gold">{verdictDisplay.championName}</div>
          {verdictDisplay.summonerName && (
            <div className="mt-1 text-xs font-medium text-muted-foreground">
              {verdictDisplay.summonerName}
            </div>
          )}
        </div>
      )}
      <p
        role="status"
        aria-live="polite"
        className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm leading-relaxed text-foreground"
      >
        {reasoning}
      </p>
      <ObjectionPanel
        reasoning={reasoning}
        t={t}
        onSubmit={onSubmitObjection}
        onAfterSubmit={onAfterObjection}
        renderActions={(button, saved) => (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={onShare}
                disabled={sharing || shareDisabled}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Share2 className="h-3.5 w-3.5" />
                {sharing ? t("loading") : t("share")}
              </button>
              {button}
              {saved}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {SHOW_DEV_CONTEXT && (
                <button
                  onClick={onViewContext}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  View context
                </button>
              )}
              <button
                onClick={onAgain}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {t("newVerdict")}
              </button>
              <button
                onClick={onClose}
                className="rounded-md border border-gold bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/20"
              >
                {t("close")}
              </button>
            </div>
          </div>
        )}
      />
    </div>
  );
}
