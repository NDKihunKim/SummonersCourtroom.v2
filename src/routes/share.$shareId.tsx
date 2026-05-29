import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AdFrame } from "@/components/AdFrame";
import {
  getCachedMatchHistory,
  type CachedSummonerPayload,
} from "@/functions/summoner-cache.functions";
import { getSharedVerdict, type SharedVerdictPayload } from "@/functions/shared-verdict.functions";
import { SHARDS, type Shard } from "@/lib/regions";
import { useLocale } from "@/i18n";
import { buildPlayerProfileUrl, MatchHistory } from "./index";

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

function isKnownShard(value: string): value is Shard {
  return SHARDS.some((shard) => shard.code === value);
}

function SharePage() {
  const { locale, setLocale, t } = useLocale();
  const navigate = useNavigate();
  const { shareId } = Route.useParams();
  const [verdict, setVerdict] = useState<SharedVerdictPayload | null>(null);
  const [profile, setProfile] = useState<CachedSummonerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileUnavailable, setProfileUnavailable] = useState(false);

  const canonicalProfileUrl =
    verdict?.profile && isKnownShard(verdict.profile.shard)
      ? buildPlayerProfileUrl(
          verdict.profile.shard,
          verdict.profile.gameName,
          verdict.profile.tagLine,
        )
      : null;

  const sharedMatchIndex =
    verdict?.matchId && profile
      ? profile.matches
          .slice(0, 20)
          .findIndex(
            (match) => match.riotMatchId === verdict.matchId || match.id === verdict.matchId,
          )
      : -1;
  const sharedMatchInRecent = sharedMatchIndex >= 0;

  function replaceWithCanonicalProfile(openVerdictMatchId?: string) {
    if (!canonicalProfileUrl || typeof window === "undefined") return;
    const url = new URL(canonicalProfileUrl, window.location.origin);
    if (openVerdictMatchId) url.searchParams.set("openVerdictMatch", openVerdictMatchId);
    window.location.replace(url.toString());
  }

  useEffect(() => {
    let cancelled = false;
    setVerdict(null);
    setProfile(null);
    setError(null);
    setProfileUnavailable(false);

    async function loadShare() {
      try {
        const shared = await getSharedVerdict({ data: { id: shareId } });
        if (cancelled) return;
        if (shared.locale !== locale) setLocale(shared.locale);
        setVerdict(shared);

        if (!shared.profile || !isKnownShard(shared.profile.shard)) {
          setProfileUnavailable(true);
          return;
        }

        const cached = await getCachedMatchHistory({
          data: {
            shard: shared.profile.shard,
            gameName: shared.profile.gameName,
            tagLine: shared.profile.tagLine,
          },
        });
        if (cancelled) return;
        if (cached) setProfile(cached);
        else setProfileUnavailable(true);
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
  }, [locale, setLocale, shareId]);

  if (error) {
    return (
      <AdFrame homeHref="/" locale={locale} onLocaleChange={setLocale} t={t}>
        <UnavailableCard title="Shared verdict unavailable" message={error} />
      </AdFrame>
    );
  }

  if (!verdict) {
    return (
      <AdFrame homeHref="/" locale={locale} onLocaleChange={setLocale} t={t}>
        <main className="min-h-dvh px-4 py-16" style={{ background: "var(--gradient-hero)" }}>
          <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-gold" />
            {t("loading")}
          </div>
        </main>
      </AdFrame>
    );
  }

  if (!profile || !verdict.profile || !isKnownShard(verdict.profile.shard)) {
    return (
      <AdFrame homeHref="/" locale={locale} onLocaleChange={setLocale} t={t}>
        <UnavailableCard
          title="Shared profile unavailable"
          message={
            profileUnavailable
              ? "This shared player profile is not available from cache. Start a new search to view current match history."
              : "Loading shared player profile..."
          }
          loading={!profileUnavailable}
        />
      </AdFrame>
    );
  }

  return (
    <AdFrame homeHref="/" locale={locale} onLocaleChange={setLocale} t={t}>
      <MatchHistory
        result={profile}
        shard={verdict.profile.shard}
        isSaved={false}
        onToggleSaved={() => undefined}
        onRefreshed={(fresh) => {
          setProfile(fresh);
          replaceWithCanonicalProfile();
        }}
        onBack={() => void navigate({ to: "/" })}
        onSearchPlayer={(rawRiotId) => {
          const hash = rawRiotId.lastIndexOf("#");
          if (hash < 1 || hash === rawRiotId.length - 1) return;
          const gameName = rawRiotId.slice(0, hash).trim();
          const tagLine = rawRiotId.slice(hash + 1).trim();
          window.open(
            buildPlayerProfileUrl(verdict.profile!.shard, gameName, tagLine),
            "_blank",
            "noopener,noreferrer",
          );
        }}
        onProfileInteraction={replaceWithCanonicalProfile}
        shareNotice={
          sharedMatchInRecent
            ? undefined
            : "This shared match is no longer in this player's recent match history. It may have been pushed out by newer games."
        }
        sharedVerdict={sharedMatchInRecent ? verdict : null}
        locale={locale}
        t={t}
      />
    </AdFrame>
  );
}

function UnavailableCard({
  title,
  message,
  loading,
}: {
  title: string;
  message: string;
  loading?: boolean;
}) {
  return (
    <main className="min-h-dvh px-4 py-16" style={{ background: "var(--gradient-hero)" }}>
      <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-6 text-center">
        {loading ? <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-gold" /> : null}
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        {!loading && (
          <Link
            to="/"
            className="mt-4 inline-flex rounded-md border border-gold bg-gold/10 px-4 py-2 text-sm font-semibold text-gold hover:bg-gold/20"
          >
            Back home
          </Link>
        )}
      </div>
    </main>
  );
}
