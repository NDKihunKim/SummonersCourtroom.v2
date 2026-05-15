import { createFileRoute, useSearch, Link } from "@tanstack/react-router";
import { useState } from "react";
import { TimelineWindowResult } from "@/components/TimelineWindowResult";
import type { Locale } from "@/i18n";

/**
 * Standalone "View context" page opened in a new tab from the Verdict
 * panel. Shows what would have been sent to the AI for this judged
 * match — either the timeline-window prompt sandwich (Specify Time
 * scope) or the temporary full-game contextualizer output.
 */

type Search = {
  scope?: "full" | "window";
  puuid?: string;
  region?: "americas" | "europe" | "asia" | "sea";
  subjectA?: string;
  subjectB?: string;
  startMs?: number;
  endMs?: number;
  locale?: Locale;
};

const SHOW_DEV_CONTEXT = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_CONTEXT === "true";

export const Route = createFileRoute("/dev/context/$matchId")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex,nofollow" }],
  }),
  validateSearch: (raw: Record<string, unknown>): Search => ({
    scope: raw.scope === "window" ? "window" : raw.scope === "full" ? "full" : undefined,
    puuid: typeof raw.puuid === "string" ? raw.puuid : undefined,
    region:
      raw.region === "americas" || raw.region === "europe" || raw.region === "asia" || raw.region === "sea"
        ? raw.region
        : undefined,
    subjectA: typeof raw.subjectA === "string" ? raw.subjectA : undefined,
    subjectB: typeof raw.subjectB === "string" ? raw.subjectB : undefined,
    startMs: raw.startMs != null ? Number(raw.startMs) : undefined,
    endMs: raw.endMs != null ? Number(raw.endMs) : undefined,
    locale: raw.locale === "ko" ? "ko" : raw.locale === "en" ? "en" : undefined,
  }),
  component: DevContextPage,
});

function DevContextPage() {
  const { matchId } = Route.useParams();
  const search = useSearch({ from: "/dev/context/$matchId" }) as Search;
  const [gameLength, setGameLength] = useState<string | null>(null);

  if (!SHOW_DEV_CONTEXT) {
    return (
      <div className="min-h-screen bg-background px-6 py-8">
        <div className="mx-auto max-w-2xl rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="text-xl font-bold text-foreground">Context view disabled</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Prompt and evidence inspection is available only in development.
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex rounded-md border border-gold bg-gold/10 px-4 py-2 text-sm font-semibold text-gold hover:bg-gold/20"
          >
            Back home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Judge context</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Match <span className="font-mono text-foreground">{matchId}</span>
              {gameLength && (
                <>
                  {" "}
                  · Game Length: <span className="text-foreground">{gameLength}</span>
                </>
              )}{" "}
              · scope:{" "}
              <span className="text-gold">{search.scope ?? "unknown"}</span>
            </p>
            {search.puuid && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                PUUID: <span className="font-mono text-foreground break-all">{search.puuid}</span>
              </p>
            )}
          </div>
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
            ← Back home
          </Link>
        </div>

        <div className="mb-4 rounded-lg border border-destructive/60 bg-destructive/10 p-3 text-center text-xs font-medium text-destructive">
          Preview only — this page shows the context that would be sent to the AI. No AI was used to generate the verdict you saw.
        </div>

        {search.scope === "window" &&
        search.puuid &&
        search.startMs != null &&
        search.endMs != null ? (
          <TimelineWindowResult
            matchId={matchId}
            userPuuid={search.puuid}
            routingRegion={search.region}
            startMs={search.startMs}
            endMs={search.endMs}
            scope="window"
            // Auto-fetch on mount so the user immediately sees the
            // prompt sandwich without an extra Run click.
            runToken={1}
            subjectAChampion={search.subjectA}
            subjectBChampion={search.subjectB}
            locale={search.locale ?? "en"}
            onGameLengthChange={setGameLength}
          />
        ) : search.scope === "full" && search.puuid ? (
          <TimelineWindowResult
            matchId={matchId}
            userPuuid={search.puuid}
            routingRegion={search.region}
            startMs={0}
            endMs={0}
            scope="full"
            // Auto-fetch on mount so the user immediately sees the
            // full-game prompt sandwich without an extra Run click.
            runToken={1}
            subjectAChampion={search.subjectA}
            subjectBChampion={search.subjectB}
            locale={search.locale ?? "en"}
            onGameLengthChange={setGameLength}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
            Missing context parameters. Return to the match page and open
            context from a verdict preview.
          </div>
        )}
      </div>
    </div>
  );
}
