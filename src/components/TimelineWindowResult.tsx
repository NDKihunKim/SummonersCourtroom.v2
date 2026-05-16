import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  getJudgeVerdict,
  getTimelineFullGame,
  getTimelineWindow,
} from "@/functions/timeline-window.functions";
import { PromptBlock } from "./judge-prompts/PromptBlock";
import { UPPER_PROMPT, buildLowerPrompt } from "./judge-prompts/promptText";
import { substituteSubjects } from "./judge-prompts/substituteSubjects";
import { buildTeamRundown } from "./judge-prompts/teamRundown";
import type { Match, Participant } from "@/lib/match-types";
import type { Locale } from "@/i18n";
import { useChampionNameFormatter } from "@/lib/ddragon";

/**
 * Fetches the merged participantFrames + events window from the local server function
 * and displays the JSON exactly like the dev "View context" page does for the
 * narrative output.
 *
 * It is intentionally driven by an explicit "Run" click in the parent —
 * we don't auto-refetch on every slider tick, both for politeness to the
 * Riot API and to keep the UI stable while the user fine-tunes the range.
 */

type WindowResponse = {
  // Bounds are formatted `[mm:ss]` strings (game time) by the local server function.
  window: { start: string; end: string };
  gameLength?: string;
  count: number;
  totalItems?: number;
  brief: string;
  evidence: unknown[];
  items?: unknown[];
  error?: string;
};

type JudgeRawResult = {
  content: string;
  reasoningContent?: string;
  model: string;
  thinking: { enabled: boolean; effort: "high" | "max" };
  usage?: unknown;
  costEstimate?: unknown;
  raw?: unknown;
  prompt?: unknown;
};

export function TimelineWindowResult({
  matchId,
  userPuuid,
  routingRegion,
  startMs,
  endMs,
  scope = "window",
  /** When this token changes, re-fetch. Parent bumps it on "Run" click. */
  runToken,
  subjectAChampion,
  subjectBChampion,
  match,
  you,
  locale = "en",
  onGameLengthChange,
}: {
  matchId: string;
  userPuuid: string;
  routingRegion?: "americas" | "europe" | "asia" | "sea";
  startMs: number;
  endMs: number;
  scope?: "window" | "full";
  runToken: number;
  /**
   * Champion names used to substitute SUBJECT_A / SUBJECT_B placeholders in
   * the upper/lower prompts. Optional so the component still renders the
   * raw tokens if a parent forgets to pass them (visible fallback rather
   * than silently empty text).
   */
  subjectAChampion?: string;
  subjectBChampion?: string;
  /**
   * Full match + viewing player. When provided, a "TEAMS:" block listing
   * each team's champions and roles is appended to the upper prompt so the
   * Judge LLM has a quick at-a-glance roster. Optional — when omitted the
   * upper prompt renders without the rundown.
   */
  match?: Match;
  you?: Participant;
  locale?: Locale;
  onGameLengthChange?: (gameLength: string | null) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WindowResponse | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [judgeLoading, setJudgeLoading] = useState(false);
  const [judgeResult, setJudgeResult] = useState<JudgeRawResult | null>(null);

  // Memo-light: just two string substitutions per render. Plenty fast and
  // avoids the boilerplate of useMemo for sub-millisecond work.
  // The team rundown (TEAMS: ... block) is appended to the upper prompt
  // when we have both `match` and `you`, so the LLM can see the full 5v5
  // roster + roles at the top of the brief.
  const teamRundown = match && you ? buildTeamRundown(match, you) : "";
  const formatChampionName = useChampionNameFormatter(locale);
  const championLocalization = buildChampionLocalization({
    locale,
    subjectAChampion,
    subjectBChampion,
    match,
    formatChampionName,
  });
  const upperPromptBase = substituteSubjects(UPPER_PROMPT, {
    subjectA: subjectAChampion ?? "",
    subjectB: subjectBChampion ?? "",
  });
  const upperPromptBody = teamRundown ? `${upperPromptBase}\n\n${teamRundown}` : upperPromptBase;
  const upperPromptText = upperPromptBody;
  const lowerPromptText = substituteSubjects(buildLowerPrompt(locale, championLocalization), {
    subjectA: subjectAChampion ?? "",
    subjectB: subjectBChampion ?? "",
  });

  // Fetch is triggered when `runToken` changes (parent bumps it on "Run").
  // We deliberately do NOT depend on startMs/endMs so the user can fine-tune
  // the slider without hammering the Riot API.
  useEffectOnRunToken(runToken, async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setJudgeResult(null);
    setDurationMs(null);
    onGameLengthChange?.(null);
    const t0 = performance.now();
    try {
      const data =
        scope === "full"
          ? await getTimelineFullGame({
              data: {
                matchId,
                userPuuid,
                ...(routingRegion ? { routingRegion } : {}),
                subjects: {
                  a: {
                    champion: subjectAChampion,
                    puuid: you?.puuid ?? userPuuid,
                  },
                  b: {
                    champion: subjectBChampion,
                  },
                },
              },
            })
          : await getTimelineWindow({
              data: {
                matchId,
                userPuuid,
                ...(routingRegion ? { routingRegion } : {}),
                startMs,
                endMs,
                subjects: {
                  a: {
                    champion: subjectAChampion,
                    puuid: you?.puuid ?? userPuuid,
                  },
                  b: {
                    champion: subjectBChampion,
                  },
                },
              },
            });
      setDurationMs(Math.round(performance.now() - t0));
      if (data.error) throw new Error(data.error);
      onGameLengthChange?.(data.gameLength ?? null);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  });

  /**
   * Copy the prompt sandwich — upper prompt + brief + lower prompt — as a
   * single plaintext blob. The JSON remains visible for development review,
   * but is intentionally excluded from the copied Judge payload.
   *
   * Defensive try/catch: clipboard access can throw on insecure contexts
   * or when the user denies permission; we surface that as the inline
   * `error` state instead of letting the promise reject silently.
   */
  async function copyAll() {
    if (!result) return;
    try {
      const blob = [
        upperPromptText,
        "",
        result.brief,
        "",
        lowerPromptText,
      ].join("\n");
      await navigator.clipboard.writeText(blob);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clipboard write failed");
    }
  }

  async function runDeepSeekForContext() {
    if (!result) return;
    setJudgeLoading(true);
    setError(null);
    setJudgeResult(null);
    try {
      const data = await getJudgeVerdict({
        data: {
          matchId,
          userPuuid,
          ...(routingRegion ? { routingRegion } : {}),
          scope,
          ...(scope === "window" ? { startMs, endMs } : {}),
          locale,
          includeRaw: true,
          subjects: {
            a: {
              champion: subjectAChampion,
              puuid: you?.puuid ?? userPuuid,
            },
            b: {
              champion: subjectBChampion,
            },
          },
        },
      });
      setJudgeResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "DeepSeek request failed");
    } finally {
      setJudgeLoading(false);
    }
  }

  if (runToken === 0 && !loading && !error && !result) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-card/40 p-4 text-center text-xs text-muted-foreground">
        Pick a 1–3 minute window above and click <span className="text-gold">Run</span> to fetch the
        merged timeline.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-3 text-xs">
        {loading && (
          <span className="inline-flex items-center gap-1.5 text-gold">
            <Loader2 className="h-3 w-3 animate-spin" /> Fetching timeline window…
          </span>
        )}
        {result && !loading && (
          <>
            <span className="rounded bg-hex-blue/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-hex-blue">
              {result.count} evidence items
            </span>
            {typeof result.totalItems === "number" && result.totalItems !== result.count && (
              <span className="text-muted-foreground">{result.totalItems} extracted</span>
            )}
            {durationMs != null && <span className="text-muted-foreground">{durationMs} ms</span>}
            <button
              onClick={() => void copyAll()}
              className="ml-auto rounded border border-border px-2 py-1 text-xs hover:border-gold"
            >
              {copied ? "Copied" : "Copy all"}
            </button>
            <button
              onClick={() => void runDeepSeekForContext()}
              disabled={judgeLoading}
              className="rounded border border-gold/60 px-2 py-1 text-xs text-gold hover:border-gold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {judgeLoading ? "Running DeepSeek..." : "Run DeepSeek"}
            </button>
          </>
        )}
      </div>

      {error && (
        <pre className="overflow-auto rounded border border-destructive bg-destructive/10 p-3 text-xs text-destructive whitespace-pre-wrap">
          {error}
        </pre>
      )}

      {result && !error && (
        // Display-only prompt sandwich: upper framing → brief → lower
        // FINAL INSTRUCTION → JSON dump. The JSON remains visible for
        // development review, but copyAll intentionally excludes it.
        <div className="flex flex-col gap-3">
          <PromptBlock label="Upper prompt" text={upperPromptText} tone="intro" />

          <PromptBlock label="Structured context brief" text={result.brief} tone="intro" />

          <PromptBlock label="Lower prompt" text={lowerPromptText} tone="instruction" />

          <pre className="max-h-[400px] overflow-auto rounded border border-border bg-background p-4 font-mono text-[11px] leading-relaxed text-foreground">
            {JSON.stringify(result.evidence ?? result.items ?? [], null, 2)}
          </pre>

          {judgeResult && (
            <div className="flex flex-col gap-3">
              <PromptBlock
                label="DeepSeek final content"
                text={judgeResult.content}
                tone="instruction"
              />
              {judgeResult.reasoningContent && (
                <PromptBlock
                  label="DeepSeek reasoning_content"
                  text={judgeResult.reasoningContent}
                  tone="intro"
                />
              )}
              <pre className="max-h-[420px] overflow-auto rounded border border-gold/50 bg-background p-4 font-mono text-[11px] leading-relaxed text-foreground">
                {JSON.stringify(
                  {
                    model: judgeResult.model,
                    thinking: judgeResult.thinking,
                    usage: judgeResult.usage,
                    costEstimate: judgeResult.costEstimate,
                    raw: judgeResult.raw,
                    prompt: judgeResult.prompt,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Tiny effect helper local to this module: runs `fn` whenever `token`
 * changes to a value > 0. Pulled out of the component body so React's
 * dependency rules stay obvious — `fn` is captured fresh per render via a ref.
 */
function useEffectOnRunToken(token: number, fn: () => void | Promise<void>) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (token <= 0) return;
    void fnRef.current();
  }, [token]);
}

function buildChampionLocalization({
  locale,
  subjectAChampion,
  subjectBChampion,
  match,
  formatChampionName,
}: {
  locale: Locale;
  subjectAChampion?: string;
  subjectBChampion?: string;
  match?: Match;
  formatChampionName: (champion: string) => string;
}): string {
  if (locale !== "ko") return "";

  const championNames = new Set<string>();
  if (subjectAChampion) championNames.add(subjectAChampion);
  if (subjectBChampion) championNames.add(subjectBChampion);
  if (match) {
    championNames.add(match.champion);
    for (const participant of [...match.team, ...match.enemies]) {
      championNames.add(participant.champion);
    }
  }

  const rows = [...championNames]
    .map((champion) => {
      const localized = formatChampionName(champion);
      return localized && localized !== champion ? `- ${champion} → ${localized}` : null;
    })
    .filter((row): row is string => row !== null);

  if (rows.length === 0) return "";
  return `**NAME LOCALIZATION:**

Use these Korean champion names in the verdict and reasoning:
${rows.join("\n")}`;
}
