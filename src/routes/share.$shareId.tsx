import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Gavel, Loader2 } from "lucide-react";
import { AdFrame } from "@/components/AdFrame";
import { ChampionIcon } from "@/components/ChampionIcon";
import {
  getSharedVerdict,
  type SharedVerdictPayload,
  type SharedVerdictPlayer,
} from "@/functions/shared-verdict.functions";
import { useLocale } from "@/i18n";

export const Route = createFileRoute("/share/$shareId")({
  head: () => ({
    meta: [
      { title: "Shared Verdict | Summoner's Courtroom" },
      {
        name: "description",
        content: "View a shared Summoner's Courtroom AI verdict snapshot.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: SharePage,
});

function SharePage() {
  const { locale, setLocale, t } = useLocale();
  const { shareId } = Route.useParams();
  const [verdict, setVerdict] = useState<SharedVerdictPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVerdict(null);
    setError(null);

    async function loadShare() {
      try {
        const data = await getSharedVerdict({ data: { id: shareId } });
        if (!cancelled) setVerdict(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Shared verdict not found or expired.");
        }
      }
    }

    void loadShare();
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  return (
    <AdFrame homeHref="/" locale={locale} onLocaleChange={setLocale} t={t}>
      <main className="min-h-dvh px-4 py-16" style={{ background: "var(--gradient-hero)" }}>
        <div className="mx-auto max-w-5xl">
          {!verdict && !error ? (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-gold" />
              {t("loading")}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-border bg-card p-6 text-center">
              <h1 className="text-xl font-bold text-foreground">Shared verdict unavailable</h1>
              <p className="mt-2 text-sm text-muted-foreground">{error}</p>
              <Link
                to="/"
                className="mt-4 inline-flex rounded-md border border-gold bg-gold/10 px-4 py-2 text-sm font-semibold text-gold hover:bg-gold/20"
              >
                Back home
              </Link>
            </div>
          ) : null}

          {verdict ? <SharedVerdictView verdict={verdict} /> : null}
        </div>
      </main>
    </AdFrame>
  );
}

function SharedVerdictView({ verdict }: { verdict: SharedVerdictPayload }) {
  return (
    <section className="rounded-xl border border-border bg-card/95 p-5 shadow-lg">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gavel className="h-4 w-4 text-gold" />
          <h1 className="text-sm font-semibold uppercase tracking-wider text-gold">
            Shared Verdict
          </h1>
        </div>
        {verdict.scopeLabel && (
          <div className="text-right text-sm font-semibold uppercase tracking-wider text-gold">
            {verdict.scopeLabel}
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
        {verdict.selectedPlayers.map((player, index) => (
          <div key={`${player.summoner ?? player.champion}-${index}`} className="flex items-center gap-3">
            {index > 0 ? <span className="text-lg font-bold text-muted-foreground">vs</span> : null}
            <SharedPlayerTile player={player} />
          </div>
        ))}
      </div>

      <div className="mb-3 rounded-lg border border-gold bg-gold/10 p-4 text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gold/80">
          More at fault
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

      <p className="whitespace-pre-wrap rounded-lg border border-border bg-background p-4 text-sm leading-relaxed text-foreground">
        {verdict.reasoning}
      </p>
    </section>
  );
}

function SharedPlayerTile({ player }: { player: SharedVerdictPlayer }) {
  const kda =
    typeof player.kills === "number" && typeof player.deaths === "number" && typeof player.assists === "number"
      ? `${player.kills}/${player.deaths}/${player.assists}`
      : null;

  return (
    <div className="flex w-28 shrink-0 flex-col items-center gap-1 overflow-hidden rounded-lg border border-border bg-card p-2">
      <ChampionIcon champion={player.champion} size={48} />
      <span className="block w-full min-w-0 truncate text-center text-xs font-semibold text-foreground">
        {player.championLabel ?? player.champion}
      </span>
      {player.summoner && (
        <span
          className="block w-full min-w-0 truncate text-center text-[10px] text-muted-foreground"
          title={player.summoner}
        >
          {player.summoner}
        </span>
      )}
      {kda && <span className="text-[10px] text-muted-foreground">{kda}</span>}
    </div>
  );
}
