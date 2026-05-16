import { useState } from "react";
import { Loader2, Gavel, ArrowLeft, Check } from "lucide-react";
import { toast } from "sonner";
import type { Match, Participant } from "@/lib/match-types";
import { ChampionIcon } from "./ChampionIcon";
import { MatchupHeader } from "./MatchupHeader";
import { ItemGrid } from "./ItemGrid";
import { SummonerSpells } from "./SummonerSpells";
import { RuneIcons } from "./RuneIcons";
import { RosterColumns } from "./RosterColumns";
import { ExpandToggle } from "./ExpandToggle";
import { ScopeSpecifyTime } from "./ScopeSpecifyTime";
import { getJudgeVerdict } from "@/functions/timeline-window.functions";
import { useChampionNameFormatter } from "@/lib/ddragon";
import type { Locale, TranslationKey } from "@/i18n";

type Stage = "closed" | "pickAlly" | "pickScope" | "specifyTime" | "loading" | "verdict";
type PipelineStep = "contextualize" | "judge" | "parse";
type Scope = "full" | "window";
type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;
type VerdictDisplay = { championName: string; summonerName?: string };

const SHOW_DEV_CONTEXT = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_CONTEXT === "true";
const MAX_FULL_GAME_VERDICT_MS = 60 * 60_000;

const defaultT: Translate = (key, vars) => {
  const text = String(key);
  if (!vars) return text;
  return Object.entries(vars).reduce(
    (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
    text,
  );
};

const QUEUE_KEYS: Array<[RegExp, TranslationKey]> = [
  [/ranked\s+solo/i, "queueRankedSolo"],
  [/ranked\s+flex/i, "queueRankedFlex"],
  [/normal\s+draft|swiftplay|queue\s+480/i, "queueNormalGame"],
  [/normal\s+blind/i, "queueNormalBlind"],
  [/\baram\b/i, "queueAram"],
  [/\barena\b/i, "queueArena"],
  [/quickplay/i, "queueQuickplay"],
];

function formatQueue(queue: string, locale: Locale, t: Translate): string {
  const key = QUEUE_KEYS.find(([pattern]) => pattern.test(queue))?.[1];
  if (key && (locale === "ko" || /^queue\s+\d+$/i.test(queue))) return t(key);
  return queue;
}

function formatDuration(duration: string, locale: Locale, t: Translate): string {
  if (locale !== "ko") return duration;
  const match = duration.match(/^(?:(\d+)m\s*)?(?:(\d+)s)?$/i);
  if (!match) return duration;
  const minutes = match[1] ? Number(match[1]) : 0;
  const seconds = match[2] ? Number(match[2]) : 0;
  if (minutes > 0 && seconds > 0) return t("durationMinutesSeconds", { minutes, seconds });
  if (minutes > 0) return t("durationMinutes", { minutes });
  return t("durationSeconds", { seconds });
}

function parseMatchDurationToMs(duration: string): number | null {
  const trimmed = duration.trim();

  const mAndS = trimmed.match(/^(?:(\d{1,3})m)?\s*(?:(\d{1,2})s)?$/i);
  if (mAndS && (mAndS[1] || mAndS[2])) {
    const minutes = Number(mAndS[1] ?? 0);
    const seconds = Number(mAndS[2] ?? 0);
    return seconds < 60 ? (minutes * 60 + seconds) * 1000 : null;
  }

  const colon = trimmed.match(/^(\d{1,3}):(\d{1,2})$/);
  if (colon) {
    const minutes = Number(colon[1]);
    const seconds = Number(colon[2]);
    return seconds < 60 ? (minutes * 60 + seconds) * 1000 : null;
  }

  return null;
}

function formatMsClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPlayedAt(playedAt: string, locale: Locale, t: Translate): string {
  if (locale !== "ko") return playedAt;
  if (playedAt.toLowerCase() === "just now") return t("justNow");
  const match = playedAt.match(/^(\d+)\s*([smhd])\s+ago$/i);
  if (!match) return playedAt;
  const count = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "s") return t("relativeSecondsAgo", { count });
  if (unit === "m") return t("relativeMinutesAgo", { count });
  if (unit === "h") return t("relativeHoursAgo", { count });
  return t("relativeDaysAgo", { count });
}

function normalizeVerdictToken(value: string): string {
  return value.replace(/[^a-z0-9가-힣]/gi, "").toLowerCase();
}

function parseJudgeOutput(
  output: string,
  subjects: Array<{ champion: string; championLabel: string; summoner?: string }>,
): { verdict: VerdictDisplay | null; reasoning: string } {
  const lines = output.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex === -1) return { verdict: null, reasoning: output };

  const verdictLine = lines[firstContentIndex].trim();
  const verdictToken = normalizeVerdictToken(verdictLine);
  const subject = subjects.find((candidate) => {
    const candidates = [
      candidate.champion,
      candidate.championLabel,
      candidate.summoner ?? "",
    ].map(normalizeVerdictToken);
    return candidates.some((candidateToken) => candidateToken && candidateToken === verdictToken);
  });

  const reasoning = [...lines.slice(0, firstContentIndex), ...lines.slice(firstContentIndex + 1)]
    .join("\n")
    .trim();

  return {
    verdict: subject
      ? { championName: subject.championLabel, summonerName: subject.summoner }
      : { championName: verdictLine },
    reasoning: reasoning || output,
  };
}

export function MatchCard({
  match,
  you,
  onPlayerClick,
  locale = "en",
  t = defaultT,
}: {
  match: Match;
  /**
   * The viewing player as a Participant. Forwarded to RosterColumns so the
   * Allies column renders a full 5 (you + 4 teammates). Optional so existing
   * call sites that don't have the viewing player handy keep working.
   */
  you?: Participant;
  /**
   * Invoked when any roster row (ally or enemy) is clicked. Receives the
   * raw Riot ID string. Optional — when omitted roster rows are read-only.
   */
  onPlayerClick?: (summoner: string) => void;
  locale?: Locale;
  t?: Translate;
}) {
  const win = match.result === "Victory";
  const kda = ((match.kills + match.assists) / Math.max(1, match.deaths)).toFixed(2);
  const formatChampionName = useChampionNameFormatter(locale);
  const resultLabel = win ? t("victory") : t("defeat");
  const queueLabel = formatQueue(match.queue, locale, t);
  const durationLabel = formatDuration(match.duration, locale, t);
  const matchDurationMs = parseMatchDurationToMs(match.duration);
  const playedAtLabel = formatPlayedAt(match.playedAt, locale, t);
  const championLabel = formatChampionName(match.champion);

  const [stage, setStage] = useState<Stage>("closed");
  const [pickedAlly, setPickedAlly] = useState<Participant | null>(null);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [verdictDisplay, setVerdictDisplay] = useState<VerdictDisplay | null>(null);
  const [activeStep, setActiveStep] = useState<PipelineStep>("contextualize");
  const [completed, setCompleted] = useState<Set<PipelineStep>>(new Set());
  const [verdictScope, setVerdictScope] = useState<Scope | null>(null);
  const [verdictWindow, setVerdictWindow] = useState<[number, number] | null>(null);

  const expanded = stage !== "closed";
  const verdictWindowLabel =
    verdictScope === "window" && verdictWindow
      ? `${formatMsClock(verdictWindow[0])}-${formatMsClock(verdictWindow[1])}`
      : verdictScope === "full"
        ? `Full Game - ${matchDurationMs != null ? formatMsClock(matchDurationMs) : match.duration}`
        : null;

  function reset() {
    setStage("closed");
    setPickedAlly(null);
    setReasoning(null);
    setVerdictDisplay(null);
    setCompleted(new Set());
    setActiveStep("contextualize");
    setVerdictScope(null);
    setVerdictWindow(null);
  }

  async function runJudge(scope: Scope, windowRange?: [number, number]) {
    if (!pickedAlly) return;
    if (scope === "full") {
      const durationMs = parseMatchDurationToMs(match.duration);
      if (durationMs != null && durationMs > MAX_FULL_GAME_VERDICT_MS) {
        toast.warning(t("fullGameTooLongWarning"));
        return;
      }
    }

    setStage("loading");
    setReasoning(null);
    setVerdictDisplay(null);
    setCompleted(new Set());
    setActiveStep("contextualize");

    if (!match.riotMatchId || !match.userPuuid) {
      toast.error("Match metadata unavailable for AI verdict.");
      reset();
      return;
    }

    const allyChampionLabel = formatChampionName(pickedAlly.champion);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    try {
      await wait(250);
      setCompleted((s) => new Set(s).add("contextualize"));
      setActiveStep("judge");

      const verdict = await getJudgeVerdict({
        data: {
          matchId: match.riotMatchId,
          userPuuid: match.userPuuid,
          ...(match.routingRegion ? { routingRegion: match.routingRegion } : {}),
          scope,
          ...(scope === "window" && windowRange
            ? { startMs: windowRange[0], endMs: windowRange[1] }
            : {}),
          locale,
          subjects: {
            a: {
              champion: match.champion,
              puuid: you?.puuid ?? match.userPuuid,
            },
            b: {
              champion: pickedAlly.champion,
              puuid: pickedAlly.puuid,
            },
          },
        },
      });
      const parsed = parseJudgeOutput(verdict.content, [
        { champion: match.champion, championLabel, summoner: you?.summoner },
        {
          champion: pickedAlly.champion,
          championLabel: allyChampionLabel,
          summoner: pickedAlly.summoner,
        },
      ]);
      setReasoning(parsed.reasoning);
      setVerdictDisplay(parsed.verdict);
      setCompleted((s) => new Set(s).add("judge"));
      setActiveStep("parse");

      await wait(200);
      setCompleted((s) => new Set(s).add("parse"));

      setVerdictScope(scope);
      setVerdictWindow(windowRange ?? null);
      setStage("verdict");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI verdict request failed.");
      reset();
    }
  }

  return (
    <div
      className={`group relative overflow-hidden rounded-lg border-l-4 bg-card transition-all ${
        win ? "border-l-hex-blue" : "border-l-destructive"
      } ${expanded ? "" : "hover:translate-x-1"}`}
      style={{ boxShadow: "var(--shadow-elegant)" }}
    >
      <div className="relative p-4">
        <div className="flex items-center gap-4">
          <div className="w-24 shrink-0">
            <div className={`text-sm font-bold ${win ? "text-hex-blue" : "text-destructive"}`}>
              {resultLabel}
            </div>
            <div className="text-xs text-muted-foreground">{queueLabel}</div>
            <div className="mt-1 text-xs text-muted-foreground">{durationLabel}</div>
            <div className="text-xs text-muted-foreground">{playedAtLabel}</div>
          </div>

          {/* Champion identity column — icon stacked above the name so the
              champion square stays the dominant visual anchor and the name
              reads as its label directly underneath. `min-w-0` + `truncate`
              keep long / unbroken champion names (e.g. "Aurelion Sol")
              from pushing the rest of the row sideways. */}
          <div className="flex w-[60px] shrink-0 flex-col items-center gap-1">
            {/* Real Data Dragon champion square (with letter-tile fallback
                if Riot ships an unmapped name or the image fails to load). */}
            <ChampionIcon champion={match.champion} size={52} />
            <span
              className="block w-full min-w-0 truncate text-center text-xs font-semibold text-foreground"
              title={championLabel}
            >
              {championLabel}
            </span>
          </div>

          {/* Loadout: spells | runes — sits right after the champion so
              players read champion → spells → runes → KDA → items → stats,
          matching the requested order. */}
          <div className="hidden items-center gap-1.5 md:flex">
            <SummonerSpells spells={match.spells} locale={locale} />
            <div className="w-px bg-border/60" style={{ height: 22 * 2 + 2 }} />
            <RuneIcons runes={match.runes} locale={locale} />
          </div>

          <div className="ml-2 min-w-[110px]">
            <div className="text-lg font-bold text-foreground">
              {match.kills} <span className="text-muted-foreground">/</span>{" "}
              <span className="text-destructive">{match.deaths}</span>{" "}
              <span className="text-muted-foreground">/</span> {match.assists}
            </div>
            <div className="text-xs text-muted-foreground">{kda} KDA</div>
          </div>

          {/* Items + trinket */}
          <div className="hidden items-center md:flex">
            <ItemGrid items={match.items} trinket={match.trinket} locale={locale} />
          </div>

          {/* Stats */}
          <div className="hidden flex-col text-xs text-muted-foreground md:flex">
            <span>CS {match.cs}</span>
            <span>{match.gold.toLocaleString()} gold</span>
            <span>{match.damage.toLocaleString()} dmg</span>
            <span>{match.vision} vision</span>
          </div>

          {/* Ally + enemy roster — fixed left offset so every match row's
              roster starts at the same x-position regardless of which
              optional columns (stats, loadout) actually rendered for this
              row. Previously this used `ml-auto`, which pushed the roster
              all the way to the right edge — making rows with a Defeat
              down-arrow shift the roster slightly left vs. Victory rows
              and creating visible misalignment between adjacent cards. */}
          <div className="ml-6 hidden lg:block">
            <RosterColumns
              allies={match.team}
              enemies={match.enemies}
              you={you}
              onPlayerClick={onPlayerClick}
              formatChampionName={formatChampionName}
            />
          </div>

          {/* Down-arrow region — takes the remaining horizontal space
              between the participants preview (RosterColumns) and the
              right edge of the card, then centers the toggle inside that
              region. `flex-1` claims the leftover space; `justify-center`
              horizontally centers the chevron so it visually anchors the
              midpoint of that gap (instead of hugging the right edge as
              before). `ml-auto` on the wrapper still ensures the region
              starts immediately after the roster — so on narrow layouts
              where the roster is hidden (`lg:block`), the toggle stays
              right-aligned via the wrapper's own `ml-auto`.
              Only rendered on Defeat rows whose Judge slide is still
              closed — the parent owns this gating so <ExpandToggle />
              can stay dumb/reusable. */}
          {stage === "closed" && (
            <div className="ml-auto flex flex-1 justify-center">
              <ExpandToggle onClick={() => setStage("pickAlly")} />
            </div>
          )}
        </div>
      </div>

      {/* Expanded Judge slide */}
      {expanded && (
        <div className="border-t border-border bg-background/40 px-4 py-5 animate-fade-in">
          {stage === "pickAlly" && (
            <PickAlly
              you={{
                champion: match.champion,
                summoner: you?.summoner,
                kills: match.kills,
                deaths: match.deaths,
                assists: match.assists,
              }}
              allies={match.team}
              onCancel={reset}
              t={t}
              formatChampionName={formatChampionName}
              onPick={(a) => {
                setPickedAlly(a);
                setStage("pickScope");
              }}
            />
          )}

          {stage === "pickScope" && pickedAlly && (
            <PickScope
              you={{
                champion: match.champion,
                summoner: you?.summoner,
                kills: match.kills,
                deaths: match.deaths,
                assists: match.assists,
              }}
              ally={pickedAlly}
              onBack={() => setStage("pickAlly")}
              onCancel={reset}
              onFullGame={() => runJudge("full")}
              isWin={win}
              t={t}
              formatChampionName={formatChampionName}
              onSpecifyTime={
                match.riotMatchId && match.userPuuid
                  ? () => setStage("specifyTime")
                  : undefined
              }
            />
          )}

          {stage === "specifyTime" && pickedAlly && match.riotMatchId && match.userPuuid && (
            <ScopeSpecifyTime
              matchId={match.riotMatchId}
              userPuuid={match.userPuuid}
              routingRegion={match.routingRegion}
              durationStr={match.duration}
              onBack={() => setStage("pickScope")}
              // SUBJECT_A = the viewer's champion on this match
              // SUBJECT_B = the ally the user picked in the previous step
              subjectAChampion={match.champion}
              subjectBChampion={pickedAlly.champion}
              // Full match + viewer so TimelineWindowResult can build the
              // per-team champion+role rundown injected into the upper prompt.
              match={match}
              you={you}
              locale={locale}
              t={t}
              onRun={(range) => void runJudge("window", range)}
            />
          )}

          {stage === "loading" && (
            <>
              {/* Pinned "You vs Ally" matchup card so the user always knows
                  which two subjects the Judge is comparing while the
                  pipeline runs. Reuses PlayerTile for visual parity with
                  the PickAlly screen. */}
              {pickedAlly && (
                <MatchupHeader
                  you={{
                    champion: match.champion,
                    summoner: you?.summoner,
                    kills: match.kills,
                    deaths: match.deaths,
                    assists: match.assists,
                  }}
                  ally={pickedAlly}
                  formatChampionName={formatChampionName}
                />
              )}
              <JudgeLoading active={activeStep} completed={completed} t={t} />
            </>
          )}

          {stage === "verdict" && reasoning && (
            <>
              {/* Same matchup header on the verdict screen so the ruling
                  is always read in the context of the two compared
                  players (especially useful after re-judging). */}
              {pickedAlly && (
                <MatchupHeader
                  you={{
                    champion: match.champion,
                    summoner: you?.summoner,
                    kills: match.kills,
                    deaths: match.deaths,
                    assists: match.assists,
                  }}
                  ally={pickedAlly}
                  formatChampionName={formatChampionName}
                />
              )}
              <Verdict
                verdictDisplay={verdictDisplay}
                reasoning={reasoning}
                windowLabel={verdictWindowLabel}
                onClose={reset}
                onAgain={() => setStage("pickAlly")}
                onViewContext={() => {
                  const params = new URLSearchParams();
                  params.set("scope", verdictScope ?? "full");
                  params.set("locale", locale);
                  if (match.userPuuid) params.set("puuid", match.userPuuid);
                  if (match.routingRegion) params.set("region", match.routingRegion);
                  params.set("subjectA", match.champion);
                  if (pickedAlly) params.set("subjectB", pickedAlly.champion);
                  if (verdictScope === "window" && verdictWindow) {
                    params.set("startMs", String(verdictWindow[0]));
                    params.set("endMs", String(verdictWindow[1]));
                  }
                  const id = match.riotMatchId ?? "unknown";
                  window.open(`/dev/context/${id}?${params.toString()}`, "_blank");
                }}
                t={t}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// NameColumn was the previous inline roster renderer. It has been replaced
// by the dedicated `RosterColumns` component (see ./RosterColumns.tsx),
// which adds truncation + tooltip + champion icon + zebra striping.

function PickAlly({
  you,
  allies,
  onPick,
  onCancel,
  t,
  formatChampionName,
}: {
  you: { champion: string; summoner?: string; kills: number; deaths: number; assists: number };
  allies: Participant[];
  onPick: (a: Participant) => void;
  onCancel: () => void;
  t: Translate;
  formatChampionName: (champion: string) => string;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gold">
          <Gavel className="mr-1 inline h-3.5 w-3.5" /> {t("biggerFaultQuestion")}
        </h3>
        <button
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {t("cancel")}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <PlayerTile
          highlighted
          name={you.summoner ?? "You"}
          champion={you.champion}
          championLabel={formatChampionName(you.champion)}
          kda={`${you.kills}/${you.deaths}/${you.assists}`}
        />
        <span className="text-xl font-bold text-muted-foreground">vs</span>
        <div className="flex flex-wrap gap-3">
          {allies.map((a, i) => (
            <button key={i} onClick={() => onPick(a)} className="group">
              <PlayerTile
                name={a.summoner}
                champion={a.champion}
                championLabel={formatChampionName(a.champion)}
                kda={`${a.kills}/${a.deaths}/${a.assists}`}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlayerTile({
  name,
  champion,
  championLabel = champion,
  kda,
  highlighted,
}: {
  name: string;
  champion: string;
  championLabel?: string;
  kda: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`flex w-28 shrink-0 flex-col items-center gap-1 overflow-hidden rounded-lg border p-2 transition-all ${
        highlighted
          ? "border-gold bg-secondary/50"
          : "border-border bg-card hover:border-gold hover:bg-secondary/40"
      }`}
    >
      {/* Real champion square — instantly recognisable to LoL players,
          which is exactly what the "pick the bigger fault" UI needs. */}
      <ChampionIcon champion={champion} size={48} />
      {/* `w-full min-w-0` is required for `truncate` to engage on unbroken
          strings (e.g. CJK summoner names without spaces) inside a flex
          column with `items-center`. Without an explicit width, the span
          shrinks to fit its content and overflows the tile. The `title`
          attribute keeps the full name accessible on hover. */}
      <span className="block w-full min-w-0 truncate text-center text-xs font-semibold text-foreground" title={championLabel}>
        {championLabel}
      </span>
      <span className="block w-full min-w-0 truncate text-center text-[10px] text-muted-foreground" title={name}>
        {name}
      </span>
      <span className="text-[10px] text-muted-foreground">{kda}</span>
    </div>
  );
}

function PickScope({
  you,
  ally,
  onBack,
  onCancel,
  onFullGame,
  onSpecifyTime,
  isWin,
  t,
  formatChampionName,
}: {
  you: { champion: string; summoner?: string; kills: number; deaths: number; assists: number };
  ally: Participant;
  onBack: () => void;
  onCancel: () => void;
  onFullGame: () => void;
  /**
   * When provided, the "Specify Time" button is enabled and triggers this
   * callback. Omitted (undefined) for matches that lack the matchId/puuid
   * needed to fetch a timeline window — button stays disabled in that case.
   */
  onSpecifyTime?: () => void;
  /**
   * True when this match is a Victory. On wins we hide the "Full game"
   * button entirely — full-game judging is intentionally Defeat-only,
   * since the prompt is framed around assigning fault for a loss. Wins
   * can still be analyzed via the Specify-Time scope, which is neutral.
   */
  isWin: boolean;
  t: Translate;
  formatChampionName: (champion: string) => string;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> {t("pickAgain")}
        </button>
        <button
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {t("cancel")}
        </button>
      </div>
      {/* Visual matchup card — replaces the prior text-only "Judging You vs X"
          line so the user sees both subjects (champion icon + name + KDA)
          before confirming the scope. Same component used on the loading
          and verdict stages for consistency across the pipeline. */}
      <MatchupHeader you={you} ally={ally} formatChampionName={formatChampionName} />
      <div className="flex flex-wrap justify-center gap-3">
        {/* Full-game scope is Defeat-only. Victory rows still show the
            option disabled so users understand the feature boundary. */}
        <button
          onClick={isWin ? undefined : onFullGame}
          disabled={isWin}
          title={isWin ? t("fullGameVictoryUnavailable") : undefined}
          className={
            isWin
              ? "cursor-not-allowed rounded-lg border border-border bg-muted/40 px-5 py-3 text-sm font-semibold text-muted-foreground"
              : "rounded-lg border border-gold bg-gold/10 px-5 py-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/20"
          }
        >
          {t("fullGame")}
        </button>
        <button
          onClick={onSpecifyTime}
          disabled={!onSpecifyTime}
          className={
            onSpecifyTime
              ? "rounded-lg border border-gold bg-gold/10 px-5 py-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/20"
              : "cursor-not-allowed rounded-lg border border-border bg-muted/40 px-5 py-3 text-sm font-semibold text-muted-foreground"
          }
          title={onSpecifyTime ? "Pick a 1–3 min slice of the game" : "Match metadata unavailable"}
        >
          {t("specifyTime")}
        </button>
      </div>
    </div>
  );
}

function JudgeLoading({
  active,
  completed,
  t,
}: {
  active: PipelineStep;
  completed: Set<PipelineStep>;
  t: Translate;
}) {
  const steps: { id: PipelineStep; label: string; sub: string }[] = [
    { id: "contextualize", label: t("contextualizeStep"), sub: t("contextualizeStepSub") },
    { id: "judge", label: t("judgeStep"), sub: t("judgeStepSub") },
    { id: "parse", label: t("verdictStep"), sub: t("verdictStepSub") },
  ];
  return (
    <div className="flex flex-col items-center gap-5 py-6">
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-gold">
        {t("judgeDeliberating")}
      </p>
      <ol className="flex w-full max-w-2xl items-start justify-between gap-2">
        {steps.map((s, i) => {
          const isDone = completed.has(s.id);
          const isActive = active === s.id && !isDone;
          return (
            <li key={s.id} className="flex flex-1 flex-col items-center gap-2 text-center">
              <div className="flex w-full items-center">
                <div className={`h-px flex-1 ${i === 0 ? "opacity-0" : isDone || isActive ? "bg-gold" : "bg-border"}`} />
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all ${
                    isDone
                      ? "border-gold bg-gold/20 text-gold"
                      : isActive
                        ? "border-gold bg-card text-gold"
                        : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {isDone ? (
                    <Check className="h-4 w-4" />
                  ) : isActive ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className="text-xs font-semibold">{i + 1}</span>
                  )}
                </div>
                <div className={`h-px flex-1 ${i === steps.length - 1 ? "opacity-0" : isDone ? "bg-gold" : "bg-border"}`} />
              </div>
              <div>
                <div
                  className={`text-xs font-semibold uppercase tracking-wider ${
                    isDone || isActive ? "text-gold" : "text-muted-foreground"
                  }`}
                >
                  {s.label}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{s.sub}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Verdict({
  verdictDisplay,
  reasoning,
  windowLabel,
  onClose,
  onAgain,
  onViewContext,
  t,
}: {
  verdictDisplay: VerdictDisplay | null;
  reasoning: string;
  windowLabel: string | null;
  onClose: () => void;
  onAgain: () => void;
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
          <div className="rounded-md border border-gold/60 bg-gold/10 px-3 py-1 text-xs font-semibold text-gold">
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
      <p className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm leading-relaxed text-foreground">
        {reasoning}
      </p>
      <div className="mt-3 flex justify-end gap-2">
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
          {t("judgeAnother")}
        </button>
        <button
          onClick={onClose}
          className="rounded-md border border-gold bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/20"
        >
          {t("close")}
        </button>
      </div>
    </div>
  );
}
