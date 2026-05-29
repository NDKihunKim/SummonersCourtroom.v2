import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AdFrame } from "@/components/AdFrame";
import { SummonerSearchBar } from "@/components/SummonerSearchBar";
import { TurnstileWidget, type TurnstileHandle } from "@/components/TurnstileWidget";
import {
  getCachedMatchHistory,
  getOrFetchMatchHistory,
  type CachedSummonerPayload,
} from "@/functions/summoner-cache.functions";
import { useRecentSearches } from "@/hooks/useRecentSearches";
import { useSavedPlayers } from "@/hooks/useSavedPlayers";
import { SHARDS, type Shard } from "@/lib/regions";
import { useLocale } from "@/i18n";
import { buildPlayerProfileUrl } from "@/lib/profile-url";
import { MatchHistory } from "./index";

export const Route = createFileRoute("/summoner/$shard/$gameName/$tagLine")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.gameName}#${params.tagLine} | Summoner's Courtroom` },
      {
        name: "description",
        content: `View completed League of Legends match history for ${params.gameName}#${params.tagLine}.`,
      },
    ],
  }),
  component: SummonerProfilePage,
});

function isKnownShard(value: string): value is Shard {
  return SHARDS.some((s) => s.code === value);
}

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readOpenVerdictMatchId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("openVerdictMatch");
}

function SummonerProfilePage() {
  const { locale, setLocale, t } = useLocale();
  const navigate = useNavigate();
  const params = Route.useParams();
  const shard = isKnownShard(params.shard) ? params.shard : null;
  const gameName = decodeParam(params.gameName);
  const tagLine = decodeParam(params.tagLine);
  const [data, setData] = useState<CachedSummonerPayload | null>(null);
  const [isLoadingCache, setIsLoadingCache] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [openVerdictMatchId, setOpenVerdictMatchId] = useState<string | null>(
    readOpenVerdictMatchId,
  );
  const turnstileRef = useRef<TurnstileHandle>(null);
  const autoFetchAttemptedRef = useRef(false);
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || undefined;
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const { addRecent } = useRecentSearches();
  const { addSavedPlayer, removeSavedPlayer, isSaved } = useSavedPlayers();

  const resetTurnstile = useCallback(() => {
    turnstileRef.current?.reset();
    setTurnstileResetKey((key) => key + 1);
  }, []);

  const executeTurnstile = useCallback(async () => {
    if (!turnstileSiteKey) return undefined;
    if (!turnstileRef.current) {
      throw new Error("Human verification is not ready. Please try again.");
    }
    const token = await turnstileRef.current.execute();
    if (!token) throw new Error("Human verification did not complete. Please try again.");
    return token;
  }, [turnstileSiteKey]);

  const fetchProfile = useCallback(async () => {
    if (!shard) return;
    setIsFetching(true);
    try {
      const turnstileToken = await executeTurnstile();
      const result = await getOrFetchMatchHistory({
        data: { shard, gameName, tagLine, turnstileToken },
      });
      setData(result);
      addRecent({
        gameName: result.account.gameName,
        tagLine: result.account.tagLine,
        shard,
      });
      if (result.account.gameName !== gameName || result.account.tagLine !== tagLine) {
        void navigate({
          to: "/summoner/$shard/$gameName/$tagLine",
          params: {
            shard,
            gameName: result.account.gameName,
            tagLine: result.account.tagLine,
          },
          replace: true,
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("failedToLoadMatches"));
    } finally {
      setIsFetching(false);
      resetTurnstile();
    }
  }, [addRecent, executeTurnstile, gameName, navigate, resetTurnstile, shard, t, tagLine]);

  useEffect(() => {
    let cancelled = false;
    autoFetchAttemptedRef.current = false;
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const nextOpenVerdictMatchId = params.get("openVerdictMatch");
      if (nextOpenVerdictMatchId) setOpenVerdictMatchId(nextOpenVerdictMatchId);
      if (params.has("openVerdictMatch")) {
        params.delete("openVerdictMatch");
        const nextSearch = params.toString();
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`,
        );
      }
    }

    async function loadCachedProfile() {
      if (!shard) {
        setIsLoadingCache(false);
        return;
      }

      setIsLoadingCache(true);
      try {
        const cached = await getCachedMatchHistory({
          data: { shard, gameName, tagLine },
        });
        if (!cancelled) setData(cached);
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : t("failedToLoadMatches"));
        }
      } finally {
        if (!cancelled) setIsLoadingCache(false);
      }
    }

    void loadCachedProfile();
    return () => {
      cancelled = true;
    };
  }, [gameName, shard, t, tagLine]);

  useEffect(() => {
    if (isLoadingCache || data || !shard || autoFetchAttemptedRef.current) return;
    autoFetchAttemptedRef.current = true;
    void fetchProfile();
  }, [data, fetchProfile, isLoadingCache, shard]);

  function openPlayer(rawRiotId: string) {
    const hash = rawRiotId.lastIndexOf("#");
    if (!shard || hash < 1 || hash === rawRiotId.length - 1 || typeof window === "undefined")
      return;
    const nextGameName = rawRiotId.slice(0, hash).trim();
    const nextTagLine = rawRiotId.slice(hash + 1).trim();
    window.open(
      buildPlayerProfileUrl(shard, nextGameName, nextTagLine),
      "_blank",
      "noopener,noreferrer",
    );
  }

  if (!shard) {
    return (
      <AdFrame locale={locale} onLocaleChange={setLocale} t={t}>
        <main className="min-h-dvh px-4 py-24" style={{ background: "var(--gradient-hero)" }}>
          <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">
            {t("selectRegion")}
          </div>
        </main>
      </AdFrame>
    );
  }

  if (data) {
    const saved = isSaved({
      gameName: data.account.gameName,
      tagLine: data.account.tagLine,
      shard,
    });

    return (
      <AdFrame homeHref="/" locale={locale} onLocaleChange={setLocale} t={t}>
        <MatchHistory
          result={data}
          shard={shard}
          isSaved={saved}
          onToggleSaved={() => {
            const player = {
              gameName: data.account.gameName,
              tagLine: data.account.tagLine,
              shard,
            };
            if (saved) {
              removeSavedPlayer(
                `${shard}|${data.account.gameName.toLowerCase()}#${data.account.tagLine.toLowerCase()}`,
              );
              toast.success(
                t("unsavedPlayer", { riotId: `${data.account.gameName}#${data.account.tagLine}` }),
              );
            } else {
              addSavedPlayer({
                ...player,
                profileIconId: data.profileIconId ?? null,
                tier: data.ranked?.tier ?? null,
                division: data.ranked?.division ?? null,
                lp: data.ranked?.lp ?? null,
              });
              toast.success(
                t("savedPlayer", { riotId: `${data.account.gameName}#${data.account.tagLine}` }),
              );
            }
          }}
          onRefreshed={setData}
          onBack={() => void navigate({ to: "/" })}
          onSearchPlayer={openPlayer}
          topSlot={<SummonerSearchBar t={t} preferredShard={shard} className="w-full max-w-xl" />}
          openVerdictMatchId={openVerdictMatchId}
          locale={locale}
          t={t}
        />
      </AdFrame>
    );
  }

  return (
    <AdFrame locale={locale} onLocaleChange={setLocale} t={t}>
      <main className="min-h-dvh px-4 py-24" style={{ background: "var(--gradient-hero)" }}>
        <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-6 text-center">
          {isLoadingCache || isFetching || !autoFetchAttemptedRef.current ? (
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("loading")}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  {gameName}
                  <span className="text-muted-foreground">#{tagLine}</span>
                </h1>
                <p className="mt-2 text-sm font-semibold text-gold">{t("profileNotCached")}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t("profileNotCachedHelp")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void fetchProfile()}
                disabled={isFetching}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-gold bg-gold/10 px-5 py-2.5 text-sm font-semibold text-gold transition-colors hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isFetching ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
                  </>
                ) : (
                  t("fetchPlayerProfile")
                )}
              </button>
            </div>
          )}
          <TurnstileWidget
            ref={turnstileRef}
            siteKey={turnstileSiteKey}
            resetKey={turnstileResetKey}
          />
        </div>
      </main>
    </AdFrame>
  );
}
