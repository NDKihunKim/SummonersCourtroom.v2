import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PromptBlock } from "./judge-prompts/PromptBlock";
import { UPPER_PROMPT, LOWER_PROMPT } from "./judge-prompts/promptText";
import { substituteSubjects } from "./judge-prompts/substituteSubjects";
import { buildTeamRundown } from "./judge-prompts/teamRundown";
import type { Match, Participant } from "@/lib/match-types";

/**
 * Fetches the merged participantFrames + events window from the edge function
 * and displays the JSON exactly like the dev "View context" page does for the
 * narrative output.
 *
 * Pure consumer of the `judge-match` edge function (stage="timeline-window").
 * It is intentionally driven by an explicit "Run" click in the parent —
 * we don't auto-refetch on every slider tick, both for politeness to the
 * Riot API and to keep the UI stable while the user fine-tunes the range.
 */

type WindowResponse = {
  // Bounds are formatted `[mm:ss]` strings (game time) coming from the
  // Python /timeline-window endpoint. Renamed from startMs/endMs so the
  // field names reflect the new value type.
  window: { start: string; end: string };
  count: number;
  items: unknown[];
  error?: string;
};

export function TimelineWindowResult({
  matchId,
  userPuuid,
  routingRegion,
  startMs,
  endMs,
  /** When this token changes, re-fetch. Parent bumps it on "Run" click. */
  runToken,
  subjectAChampion,
  subjectBChampion,
  match,
  you,
}: {
  matchId: string;
  userPuuid: string;
  routingRegion?: "americas" | "europe" | "asia" | "sea";
  startMs: number;
  endMs: number;
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
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WindowResponse | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  // Memo-light: just two string substitutions per render. Plenty fast and
  // avoids the boilerplate of useMemo for sub-millisecond work.
  // The team rundown (TEAMS: ... block) is appended to the upper prompt
  // when we have both `match` and `you`, so the LLM can see the full 5v5
  // roster + roles at the top of the brief.
  const teamRundown =
    match && you ? buildTeamRundown(match, you) : "";
  const upperPromptBase = substituteSubjects(UPPER_PROMPT, {
    subjectA: subjectAChampion ?? "",
    subjectB: subjectBChampion ?? "",
  });
  const upperPromptBody = teamRundown
    ? `${upperPromptBase}\n\n${teamRundown}`
    : upperPromptBase;
  const upperPromptText = upperPromptBody;
  const lowerPromptText = substituteSubjects(LOWER_PROMPT, {
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
    setDurationMs(null);
    const t0 = performance.now();
    try {
      const res = await supabase.functions.invoke("judge-match", {
        body: {
          stage: "timeline-window",
          matchId,
          userPuuid,
          ...(routingRegion ? { routingRegion } : {}),
          startMs,
          endMs,
          // The edge function's Body type still requires these two — they're
          // unused by the timeline-window stage but the type is shared with
          // the judge stages. Pass minimal stubs.
          matchContext: { queue: "", duration: "", result: "" },
          playerA: { name: "", champion: "", kills: 0, deaths: 0, assists: 0 },
          playerB: { name: "", champion: "", kills: 0, deaths: 0, assists: 0 },
        },
      });
      setDurationMs(Math.round(performance.now() - t0));
      if (res.error) throw res.error;
      const data = res.data as WindowResponse;
      if (data.error) throw new Error(data.error);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  });

  /**
   * Copy the full prompt sandwich — upper prompt + JSON timeline + lower
   * prompt — as a single plaintext blob. This matches what's visually
   * rendered on screen (with SUBJECT_A / SUBJECT_B already substituted) so
   * the user can paste the exact preview into another tool / model.
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
        JSON.stringify(result, null, 2),
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

  if (runToken === 0 && !loading && !error && !result) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-card/40 p-4 text-center text-xs text-muted-foreground">
        Pick a 1–3 minute window above and click <span className="text-gold">Run</span> to fetch the merged
        timeline.
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
              {result.count} items
            </span>
            {durationMs != null && (
              <span className="text-muted-foreground">{durationMs} ms</span>
            )}
            <button
              onClick={() => void copyAll()}
              className="ml-auto rounded border border-border px-2 py-1 text-xs hover:border-gold"
            >
              {copied ? "Copied" : "Copy all"}
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
        // Display-only prompt sandwich: upper framing → JSON dump → lower
        // FINAL INSTRUCTION. The JSON in the middle is the real
        // /timeline-window response and keeps its own scroll container so
        // the surrounding prompt blocks stay visible above and below.
        <div className="flex flex-col gap-3">
          <PromptBlock label="Upper prompt" text={upperPromptText} tone="intro" />

          <pre className="max-h-[400px] overflow-auto rounded border border-border bg-background p-4 font-mono text-[11px] leading-relaxed text-foreground">
            {JSON.stringify(result, null, 2)}
          </pre>

          <PromptBlock
            label="Lower prompt"
            text={lowerPromptText}
            tone="instruction"
          />
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
}