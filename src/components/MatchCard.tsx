import { useState } from "react";
import { Loader2, Gavel, ArrowLeft, Check } from "lucide-react";
import type { Match, Participant } from "@/lib/match-types";
import { ChampionIcon } from "./ChampionIcon";
import { MatchupHeader } from "./MatchupHeader";
import { ItemGrid } from "./ItemGrid";
import { SummonerSpells } from "./SummonerSpells";
import { RosterColumns } from "./RosterColumns";
import { ExpandToggle } from "./ExpandToggle";
import { ScopeSpecifyTime } from "./ScopeSpecifyTime";

type Stage = "closed" | "pickAlly" | "pickScope" | "specifyTime" | "loading" | "verdict";
type PipelineStep = "contextualize" | "judge" | "parse";
type Scope = "full" | "window";

export function MatchCard({
  match,
  you,
  onPlayerClick,
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
}) {
  const win = match.result === "Victory";
  const kda = ((match.kills + match.assists) / Math.max(1, match.deaths)).toFixed(2);

  const [stage, setStage] = useState<Stage>("closed");
  const [pickedAlly, setPickedAlly] = useState<Participant | null>(null);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [verdictName, setVerdictName] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<PipelineStep>("contextualize");
  const [completed, setCompleted] = useState<Set<PipelineStep>>(new Set());
  const [verdictScope, setVerdictScope] = useState<Scope | null>(null);
  const [verdictWindow, setVerdictWindow] = useState<[number, number] | null>(null);

  const expanded = stage !== "closed";

  function reset() {
    setStage("closed");
    setPickedAlly(null);
    setReasoning(null);
    setVerdictName(null);
    setCompleted(new Set());
    setActiveStep("contextualize");
    setVerdictScope(null);
    setVerdictWindow(null);
  }

  async function runJudge(scope: Scope, windowRange?: [number, number]) {
    if (!pickedAlly) return;
    setStage("loading");
    setReasoning(null);
    setVerdictName(null);
    setCompleted(new Set());
    setActiveStep("contextualize");

    // ============================================================
    // MOCK MODE — the real Judge pipeline (Contextualize → Judge →
    // Parse) is intentionally NOT invoked here. We keep the existing
    // 3-step loading stepper UX by walking through the stages with
    // small delays, then render a hardcoded sample verdict so the
    // user can preview the output layout without spending any AI
    // tokens. The Verdict panel surfaces a clear "preview only"
    // warning so this isn't mistaken for a real ruling.
    // ============================================================
    const allyName = pickedAlly.summoner;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    await wait(600);
    setCompleted((s) => new Set(s).add("contextualize"));
    setActiveStep("judge");

    await wait(700);
    const fmt = (ms: number) => {
      const t = Math.floor(ms / 1000);
      return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    };
    const windowPrefix =
      scope === "window" && windowRange
        ? `In the ${fmt(windowRange[0])}–${fmt(windowRange[1])} window, `
        : "";
    const sampleReasoning =
      `Verdict: ${windowPrefix}${allyName} is more at fault.\n\n` +
      `1. At 12:30 ${allyName} overextended past the enemy mid turret with no vision while down two summoner spells, giving up first blood and a 400g shutdown that snowballed mid lane.\n` +
      `2. At 18:10 ${allyName} was farming the enemy top jungle while the team contested Dragon — the resulting 4v5 cost the objective and a follow-up tower.\n` +
      `3. At 24:45 ${allyName} face-checked the Baron pit bush without wards, starting a fight her team lost 0-for-4 and conceding Baron.`;
    setReasoning(sampleReasoning);
    setCompleted((s) => new Set(s).add("judge"));
    setActiveStep("parse");

    await wait(500);
    setVerdictName(allyName);
    setCompleted((s) => new Set(s).add("parse"));

    setVerdictScope(scope);
    setVerdictWindow(windowRange ?? null);
    setStage("verdict");
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
              {match.result}
            </div>
            <div className="text-xs text-muted-foreground">{match.queue}</div>
            <div className="mt-1 text-xs text-muted-foreground">{match.duration}</div>
            <div className="text-xs text-muted-foreground">{match.playedAt}</div>
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
              title={match.champion}
            >
              {match.champion}
            </span>
          </div>

          <div className="ml-2 min-w-[110px]">
            <div className="text-lg font-bold text-foreground">
              {match.kills} <span className="text-muted-foreground">/</span>{" "}
              <span className="text-destructive">{match.deaths}</span>{" "}
              <span className="text-muted-foreground">/</span> {match.assists}
            </div>
            <div className="text-xs text-muted-foreground">{kda} KDA</div>
          </div>

          {/* Loadout column — summoner spells (2x1) on the left, then the
              3x2 inventory grid + trinket tile on the right. The order and
              divider style mirror the in-game HUD where summoner spells
              sit immediately next to the inventory.
              Hidden on small screens to keep the row from wrapping (same
              breakpoint as the stats column to its right). */}
          <div className="hidden items-center gap-1.5 md:flex">
            <SummonerSpells spells={match.spells} />
            {/* Same vertical divider used inside ItemGrid (between items
                and trinket) so the loadout reads as three grouped sections:
                spells | items | trinket. */}
            <div className="w-px bg-border/60" style={{ height: 22 * 2 + 2 }} />
            <ItemGrid items={match.items} trinket={match.trinket} />
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
                kills: match.kills,
                deaths: match.deaths,
                assists: match.assists,
              }}
              allies={match.team}
              onCancel={reset}
              onPick={(a) => {
                setPickedAlly(a);
                // For Victory matches, skip the scope picker entirely —
                // Full-game judging is Defeat-only, so Specify Time is the
                // only available path. Jump straight there.
                setStage(win && match.riotMatchId && match.userPuuid ? "specifyTime" : "pickScope");
              }}
            />
          )}

          {stage === "pickScope" && pickedAlly && (
            <PickScope
              you={{
                champion: match.champion,
                kills: match.kills,
                deaths: match.deaths,
                assists: match.assists,
              }}
              ally={pickedAlly}
              onBack={() => setStage("pickAlly")}
              onCancel={reset}
              onFullGame={() => runJudge("full")}
              isWin={win}
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
              // Wins skip the scope picker, so "back" returns to the ally
              // picker. Losses still go back to the scope picker.
              onBack={() => setStage(win ? "pickAlly" : "pickScope")}
              // SUBJECT_A = the viewer's champion on this match
              // SUBJECT_B = the ally the user picked in the previous step
              subjectAChampion={match.champion}
              subjectBChampion={pickedAlly.champion}
              // Full match + viewer so TimelineWindowResult can build the
              // per-team champion+role rundown injected into the upper prompt.
              match={match}
              you={you}
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
                    kills: match.kills,
                    deaths: match.deaths,
                    assists: match.assists,
                  }}
                  ally={pickedAlly}
                />
              )}
              <JudgeLoading active={activeStep} completed={completed} />
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
                    kills: match.kills,
                    deaths: match.deaths,
                    assists: match.assists,
                  }}
                  ally={pickedAlly}
                />
              )}
              <Verdict
                verdictName={verdictName}
                reasoning={reasoning}
                onClose={reset}
                onAgain={() => setStage("pickAlly")}
                onViewContext={() => {
                  const params = new URLSearchParams();
                  params.set("scope", verdictScope ?? "full");
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
}: {
  you: { champion: string; kills: number; deaths: number; assists: number };
  allies: Participant[];
  onPick: (a: Participant) => void;
  onCancel: () => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gold">
          <Gavel className="mr-1 inline h-3.5 w-3.5" /> Who's the bigger fault?
        </h3>
        <button
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <PlayerTile
          highlighted
          name="You"
          champion={you.champion}
          kda={`${you.kills}/${you.deaths}/${you.assists}`}
        />
        <span className="text-xl font-bold text-muted-foreground">vs</span>
        <div className="flex flex-wrap gap-3">
          {allies.map((a, i) => (
            <button key={i} onClick={() => onPick(a)} className="group">
              <PlayerTile
                name={a.summoner}
                champion={a.champion}
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
  kda,
  highlighted,
}: {
  name: string;
  champion: string;
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
      <span className="block w-full min-w-0 truncate text-center text-xs font-semibold text-foreground" title={champion}>
        {champion}
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
}: {
  you: { champion: string; kills: number; deaths: number; assists: number };
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
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Pick again
        </button>
        <button
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
      {/* Visual matchup card — replaces the prior text-only "Judging You vs X"
          line so the user sees both subjects (champion icon + name + KDA)
          before confirming the scope. Same component used on the loading
          and verdict stages for consistency across the pipeline. */}
      <MatchupHeader you={you} ally={ally} />
      <div className="flex flex-wrap justify-center gap-3">
        {/* Full-game scope is Defeat-only — the prompt is built around
            assigning fault for a loss, so we don't surface it on wins. */}
        {!isWin && (
          <button
            onClick={onFullGame}
            className="rounded-lg border border-gold bg-gold/10 px-5 py-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/20"
          >
            Full game
          </button>
        )}
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
          Specify Time
        </button>
      </div>
    </div>
  );
}

function JudgeLoading({
  active,
  completed,
}: {
  active: PipelineStep;
  completed: Set<PipelineStep>;
}) {
  const steps: { id: PipelineStep; label: string; sub: string }[] = [
    { id: "contextualize", label: "Contextualize", sub: "Translating raw stats into human language" },
    { id: "judge", label: "Judge", sub: "AI is weighing the evidence" },
    { id: "parse", label: "Verdict", sub: "Extracting the final ruling" },
  ];
  return (
    <div className="flex flex-col items-center gap-5 py-6">
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-gold">
        The Judge is deliberating
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
  verdictName,
  reasoning,
  onClose,
  onAgain,
  onViewContext,
}: {
  verdictName: string | null;
  reasoning: string;
  onClose: () => void;
  onAgain: () => void;
  onViewContext: () => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Gavel className="h-4 w-4 text-gold" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gold">
          The Verdict
        </h3>
      </div>
      {/* Preview-only warning — the Full Game flow currently renders a
          hardcoded sample verdict instead of calling the AI pipeline,
          so we make that explicit here to avoid confusing the viewer. */}
      <div className="mb-3 rounded-lg border border-destructive/60 bg-destructive/10 p-3 text-center text-xs font-medium text-destructive">
        Preview only — this is an example of how the verdict will be displayed. No AI was used to generate this output.
      </div>
      {verdictName && (
        <div className="mb-3 rounded-lg border border-gold bg-gold/10 p-4 text-center">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gold/80">
            More at fault
          </div>
          <div className="mt-1 text-xl font-bold text-gold">{verdictName}</div>
        </div>
      )}
      <p className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm leading-relaxed text-foreground">
        {reasoning}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onViewContext}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          View context
        </button>
        <button
          onClick={onAgain}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Judge another
        </button>
        <button
          onClick={onClose}
          className="rounded-md border border-gold bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/20"
        >
          Close
        </button>
      </div>
    </div>
  );
}