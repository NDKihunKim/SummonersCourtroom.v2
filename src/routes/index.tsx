import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Star, Swords, Trophy } from "lucide-react";
import { toast } from "sonner";
import { MatchCard } from "@/components/MatchCard";
import { AdFrame } from "@/components/AdFrame";
import { ShowMoreMatchesButton } from "@/components/ShowMoreMatchesButton";
import type { Shard } from "@/lib/regions";
import type { CachedSummonerPayload } from "@/functions/summoner-cache.functions";
import { RefreshButton } from "@/components/RefreshButton";
import { TierEmblem } from "@/components/TierEmblem";
import { tierLabel, type RankedEntry } from "@/lib/tier";
import { ProfileIcon } from "@/components/ProfileIcon";
import type { Participant } from "@/lib/match-types";
import { SampleSizeSelector } from "@/components/SampleSizeSelector";
import { useSampleSize } from "@/hooks/useSampleSize";
import { computeMatchStats } from "@/lib/match-stats";
import { useLocale, type Locale, type TranslationKey } from "@/i18n";
import type { SharedVerdictPayload } from "@/functions/shared-verdict.functions";
import { SummonerSearchBar } from "@/components/SummonerSearchBar";

const SHOW_DEV_CONTEXT = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_CONTEXT === "true";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Summoner's Courtroom — League of Legends Match History" },
      {
        name: "description",
        content:
          "Search any League of Legends Riot ID and view recent match history, KDA, and AI judgement.",
      },
      { property: "og:title", content: "Summoner's Courtroom — League of Legends Match History" },
      {
        property: "og:description",
        content: "Search any Riot ID and view recent League match history with AI judgement.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const { locale, setLocale, t } = useLocale();
  return (
    <AdFrame fitViewport locale={locale} onLocaleChange={setLocale} t={t}>
      {/* h-full lets the hero fill the leftover space between the
          north & south ads (AdFrame's middle row is flex-1 in fit
          mode). Padding is reduced so the form stays visible on
          shorter viewports without scrolling. */}
      <div
        className="min-h-[calc(100dvh-4rem)] sm:min-h-[calc(100dvh-5rem)]"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-3xl flex-col items-center justify-center px-3 py-16 sm:min-h-[calc(100dvh-5rem)] sm:px-4 sm:py-8 md:py-10">
          <div className="mb-3 flex items-center gap-2 text-center text-[10px] font-semibold uppercase tracking-[0.22em] text-gold sm:text-xs sm:tracking-[0.3em]">
            <Swords className="h-3.5 w-3.5" /> {t("heroLabel")}
          </div>
          <img
            src="/summoners-courtroom-title.png"
            alt="Summoner's Courtroom"
            className="mt-1 h-auto max-h-24 w-full max-w-xl object-contain sm:max-h-28 md:max-h-36"
          />
          <SummonerSearchBar
            t={t}
            reserveSuggestionSpace
            className="mt-8 w-full max-w-xl sm:mt-10"
          />

          <p className="mt-6 w-full max-w-2xl text-center text-sm text-muted-foreground">
            {t("heroHelper")}
          </p>
        </div>
      </div>
    </AdFrame>
  );
}

export function MatchHistory({
  result,
  shard,
  isSaved,
  onToggleSaved,
  onRefreshed,
  onSearchPlayer,
  topSlot,
  shareNotice,
  sharedVerdict,
  onProfileInteraction,
  openVerdictMatchId,
  locale,
  t,
}: {
  result: CachedSummonerPayload;
  shard: Shard;
  isSaved: boolean;
  onToggleSaved: () => void;
  onRefreshed: (fresh: CachedSummonerPayload) => void;
  onBack: () => void;
  /** Called when a roster row is clicked — searches that player same-tab. */
  onSearchPlayer: (rawRiotId: string) => void;
  topSlot?: ReactNode;
  shareNotice?: string;
  sharedVerdict?: SharedVerdictPayload | null;
  onProfileInteraction?: (matchId: string) => void;
  openVerdictMatchId?: string | null;
  locale: Locale;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  const {
    account,
    matches,
    ranked,
    rankedEntries: rawRankedEntries,
    cachedAt,
    refreshAvailableAt,
    profileIconId,
  } = result;
  const rankedEntries = rawRankedEntries ?? { solo: ranked, flex: null };
  const [rankedQueue, setRankedQueue] = useState<"solo" | "flex">("solo");
  const displayedRanked: RankedEntry | null =
    SHOW_DEV_CONTEXT && rankedQueue === "flex"
      ? rankedEntries.flex
      : (rankedEntries.solo ?? ranked);
  // ─── Stats vs. visible split ─────────────────────────────────────────
  // We cache up to 30 matches server-side (see `MATCH_COUNT`) so the
  // Performance Block selector (10 / 20 / 30) can slice locally with no
  // extra Riot round-trip. The rendered match list defaults to the first
  // 10 cards so the page stays scannable, and grows to 20 on demand via
  // the "Show more matches" button (hard cap at 20 per product spec).
  const INITIAL_VISIBLE = 10;
  const EXPANDED_VISIBLE = 20;
  const [expanded, setExpanded] = useState(false);

  // Collapse back to 10 whenever the viewed account changes — otherwise a
  // user who expanded Player A would land on Player B's page already
  // expanded, which is surprising. Keying off `puuid` (stable per account)
  // is cheaper and more correct than keying off `matches` identity.
  useEffect(() => {
    setExpanded(false);
    setRankedQueue("solo");
  }, [account.puuid]);

  const sharedMatchIndex = sharedVerdict?.matchId
    ? matches.findIndex(
        (match) =>
          match.riotMatchId === sharedVerdict.matchId || match.id === sharedVerdict.matchId,
      )
    : -1;
  const sharedMatchVisibleCount =
    sharedMatchIndex >= 0 && sharedMatchIndex < EXPANDED_VISIBLE ? sharedMatchIndex + 1 : 0;
  const directMatchIndex = openVerdictMatchId
    ? matches.findIndex(
        (match) => match.riotMatchId === openVerdictMatchId || match.id === openVerdictMatchId,
      )
    : -1;
  const directMatchVisibleCount =
    directMatchIndex >= 0 && directMatchIndex < EXPANDED_VISIBLE ? directMatchIndex + 1 : 0;

  // Cap defensively — if the cache somehow holds <10, slice() handles it;
  // if it ever holds >20, we still respect the 20-match product cap.
  const visibleCount = Math.min(
    Math.max(
      expanded ? EXPANDED_VISIBLE : INITIAL_VISIBLE,
      sharedMatchVisibleCount,
      directMatchVisibleCount,
    ),
    matches.length,
  );
  const visibleMatches = matches.slice(0, visibleCount);

  // How many more matches the user could reveal by clicking the button.
  // 0 means "hide the button entirely" (already at cap or not enough cached).
  const remainingCount = Math.max(0, Math.min(EXPANDED_VISIBLE, matches.length) - visibleCount);

  // Ref pointed at the FIRST newly-revealed card (index === INITIAL_VISIBLE).
  // Scroll it into view after expansion so the user immediately sees the
  // new content rather than having to hunt for it down-page.
  const firstNewMatchRef = useRef<HTMLDivElement | null>(null);
  const sharedMatchRef = useRef<HTMLDivElement | null>(null);
  const directMatchRef = useRef<HTMLDivElement | null>(null);
  const justExpandedRef = useRef(false);
  const didScrollToSharedRef = useRef(false);
  const didScrollToDirectRef = useRef(false);
  const [directJudgeRequest, setDirectJudgeRequest] = useState(0);
  const lastOpenVerdictMatchRef = useRef<string | null>(null);

  useEffect(() => {
    didScrollToSharedRef.current = false;
  }, [sharedVerdict?.id, sharedVerdict?.matchId]);

  useEffect(() => {
    didScrollToDirectRef.current = false;
  }, [openVerdictMatchId]);
  useEffect(() => {
    if (expanded && justExpandedRef.current && firstNewMatchRef.current) {
      firstNewMatchRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      justExpandedRef.current = false;
    }
  }, [expanded]);

  useEffect(() => {
    if (!sharedVerdict || didScrollToSharedRef.current || !sharedMatchRef.current) return;
    sharedMatchRef.current.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    didScrollToSharedRef.current = true;
  }, [sharedVerdict, visibleMatches]);

  useEffect(() => {
    if (!openVerdictMatchId || openVerdictMatchId === lastOpenVerdictMatchRef.current) return;
    if (directMatchIndex < 0 || directMatchIndex >= EXPANDED_VISIBLE) return;
    if (directMatchIndex >= INITIAL_VISIBLE) setExpanded(true);
    lastOpenVerdictMatchRef.current = openVerdictMatchId;
    setDirectJudgeRequest((request) => request + 1);
  }, [directMatchIndex, openVerdictMatchId]);

  useEffect(() => {
    if (!openVerdictMatchId || didScrollToDirectRef.current || !directMatchRef.current) return;
    directMatchRef.current.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    didScrollToDirectRef.current = true;
  }, [openVerdictMatchId, visibleMatches]);

  // ─── Performance Block sample size ───────────────────────────────────
  // The user picks 10 / 20 / 30 via `SampleSizeSelector`. Their choice
  // persists in localStorage (see `useSampleSize`) so it sticks across
  // searches and reloads.
  const { sampleSize, setSampleSize } = useSampleSize();
  const sampleSizeOptions = useMemo(
    () => (matches.length > 25 ? ([10, 20, 30] as const) : ([10, 20] as const)),
    [matches.length],
  );
  const showSampleSizeSelector = matches.length >= 10;

  useEffect(() => {
    if (!showSampleSizeSelector || sampleSizeOptions.includes(sampleSize)) return;
    setSampleSize(sampleSizeOptions[sampleSizeOptions.length - 1]);
  }, [sampleSize, sampleSizeOptions, setSampleSize, showSampleSizeSelector]);

  // Memoize so unrelated re-renders (e.g. RefreshButton ticking its
  // "updated Xm ago" label) don't recompute the full reduce.
  const { wins, losses, wr, avgKda, sampleUsed } = useMemo(
    () => computeMatchStats(matches, sampleSize),
    [matches, sampleSize],
  );
  const seed = (account.puuid.charCodeAt(0) + account.puuid.charCodeAt(1)) % 100;

  // Defensive: short PUUIDs (shouldn't happen in production, but keeps tests
  // and dev-time fixtures from crashing on `charCodeAt` reads off the end).
  // Already guarded by `% 100` above — kept as-is.

  return (
    <div style={{ background: "var(--gradient-hero)" }}>
      <div className="mx-auto max-w-5xl px-4 pb-8 pt-16 sm:pt-20">
        {topSlot && <div className="relative z-30 mb-6 flex justify-center">{topSlot}</div>}

        {shareNotice && (
          <div className="mb-4 rounded-xl border border-gold/60 bg-gold/10 p-4 text-sm text-gold">
            {shareNotice}
          </div>
        )}

        <div
          className="rounded-2xl border border-border bg-card px-6 py-3"
          style={{ boxShadow: "var(--shadow-elegant)" }}
        >
          {/*
           * Header layout — three columns on wide viewports:
           *   LEFT   : profile icon + Riot ID + refresh button
           *   CENTER : official tier emblem image with tier name + LP underneath
           *   RIGHT  : "Last N matches" trophy line, then Win Rate / W-L / Avg KDA
           *
           * Wraps gracefully on narrow viewports — the columns stack and the
           * tier emblem becomes a centered block above the stats.
           */}
          <div className="flex flex-col items-center justify-center gap-6 text-center md:flex-row md:flex-wrap md:justify-between md:text-left">
            {/* ── LEFT: identity ───────────────────────────────────────── */}
            <div className="flex flex-col items-center gap-4 md:flex-row md:items-center">
              {/* Real Data Dragon profile icon when we have one; falls back
                  automatically to the colored letter avatar otherwise. */}
              <ProfileIcon
                iconId={profileIconId}
                seed={seed}
                size={88}
                alt={`${account.gameName}#${account.tagLine} profile icon`}
              />
              <div className="flex flex-col items-center md:items-start">
                <div className="flex flex-wrap items-center justify-center gap-3 md:justify-start">
                  <h1 className="text-3xl font-bold text-foreground">
                    {account.gameName}
                    <span className="text-muted-foreground">#{account.tagLine}</span>
                  </h1>
                  <button
                    type="button"
                    onClick={onToggleSaved}
                    aria-pressed={isSaved}
                    aria-label={`${t(isSaved ? "unsavePlayer" : "savePlayer")} ${account.gameName}#${account.tagLine}`}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
                      isSaved
                        ? "border-gold bg-gold/15 text-gold hover:bg-gold/25"
                        : "border-border bg-background/40 text-muted-foreground hover:border-gold hover:text-gold"
                    }`}
                  >
                    <Star className={`h-5 w-5 ${isSaved ? "fill-current" : ""}`} />
                  </button>
                </div>
                {/* Refresh control + "Updated Xm ago" — sits directly under
                    the Riot ID per the new layout. */}
                <div className="mt-2 flex justify-center md:justify-start">
                  <RefreshButton
                    shard={shard}
                    gameName={account.gameName}
                    tagLine={account.tagLine}
                    cachedAt={cachedAt}
                    refreshAvailableAt={refreshAvailableAt}
                    onRefreshed={onRefreshed}
                    t={t}
                  />
                </div>
              </div>
            </div>

            {/* ── CENTER: tier emblem + label + LP ─────────────────────── */}
            {/* Rendered for both ranked and unranked players — TierEmblem
                gracefully renders the inline SVG fallback when `tier` is
                null so the column doesn't collapse on unranked accounts. */}
            <div className="flex flex-col items-center gap-1">
              <TierEmblem tier={displayedRanked?.tier ?? null} size={88} />
              <div className="text-sm font-semibold text-foreground">
                {tierLabel(displayedRanked)}
              </div>
              {/* LP only when the selected queue is actually ranked —
                  otherwise a blank line would make the unranked state look broken. */}
              {displayedRanked?.tier ? (
                <div className="text-xs uppercase tracking-wider text-gold">
                  {displayedRanked.lp ?? 0} LP
                </div>
              ) : null}
              {SHOW_DEV_CONTEXT ? (
                <div className="mt-1 inline-flex rounded-full border border-border bg-background/50 p-0.5 text-[10px] font-semibold text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => setRankedQueue("solo")}
                    className={`rounded-full px-2 py-0.5 transition-colors ${
                      rankedQueue === "solo" ? "bg-gold/20 text-gold" : "hover:text-foreground"
                    }`}
                  >
                    {t("queueRankedSolo")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRankedQueue("flex")}
                    className={`rounded-full px-2 py-0.5 transition-colors ${
                      rankedQueue === "flex" ? "bg-gold/20 text-gold" : "hover:text-foreground"
                    }`}
                  >
                    {t("queueRankedFlex")}
                  </button>
                </div>
              ) : null}
            </div>

            {/* ── RIGHT: Performance Block ─────────────────────────────── */}
            {/* Center the title + stat row as one group so the performance
                numbers remain vertically balanced against the neighboring
                profile/tier columns. */}
            <div className="flex min-h-[150px] flex-col items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                {/* Trophy line — when the selector is hidden for tiny
                    histories, use `sampleUsed` so the count stays truthful. */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Trophy className="h-4 w-4 text-gold" />
                  {showSampleSizeSelector ? (
                    <>
                      <span>{t("lastMatchesPrefix")}</span>
                      <SampleSizeSelector
                        value={sampleSize}
                        onChange={setSampleSize}
                        options={sampleSizeOptions}
                        t={t}
                      />
                      <span>{t("lastMatchesSuffix")}</span>
                    </>
                  ) : (
                    <span>{t("lastMatches", { count: sampleUsed })}</span>
                  )}
                </div>
                <div className="flex gap-6 text-center">
                  <Stat label={t("winRate")} value={`${wr}%`} accent />
                  <Stat label={t("winLoss")} value={`${wins}W ${losses}L`} />
                  <Stat label={t("avgKda")} value={avgKda} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("recentMatches")}
        </h2>
        {visibleMatches.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {t("noRecentMatches")}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {visibleMatches.map((m, idx) => {
              // Build the "you" Participant per match — the viewing player as
              // they appear in this specific game. We use the canonical Riot
              // ID (gameName#tagLine from the Account) plus this match's
              // champion + KDA so the row visually matches the rest of the
              // roster. Built inline (not memoized) — match list is tiny
              // (≤10) so the allocation cost is negligible vs. the
              // complexity of a memo + dependency list.
              //
              // Defensive: if Riot ever returns a partial Account (missing
              // gameName/tagLine), we fall back to whatever's available so
              // the Allies column still renders 5 rows instead of silently
              // dropping back to 4. The PUUID is always present on a valid
              // lookup — RosterColumns uses it for de-dup.
              const safeName = account.gameName?.trim() || "You";
              const safeTag = account.tagLine?.trim() || "";
              const youSummoner = safeTag ? `${safeName}#${safeTag}` : safeName;
              const you: Participant = {
                champion: m.champion,
                summoner: youSummoner,
                kills: m.kills,
                deaths: m.deaths,
                assists: m.assists,
                puuid: account.puuid,
                // Forward the viewer's own side + lane so RosterColumns can
                // sort "you" into the correct slot in the Allies column.
                // Without these fields the participant sorts as "unknown"
                // and is always pushed to the bottom of the column.
                teamId: m.userTeamId,
                teamPosition: m.userTeamPosition,
              };
              // Tag the first newly-revealed row so we can scroll to it
              // after the user clicks "Show more". Only the card at index
              // === INITIAL_VISIBLE qualifies; everything else gets no ref.
              const isFirstNewMatch = idx === INITIAL_VISIBLE;
              const isSharedMatch = Boolean(
                sharedVerdict?.matchId &&
                (m.riotMatchId === sharedVerdict.matchId || m.id === sharedVerdict.matchId),
              );
              const shouldOpenDirectVerdict = Boolean(
                openVerdictMatchId &&
                (m.riotMatchId === openVerdictMatchId || m.id === openVerdictMatchId),
              );
              return (
                <div
                  key={m.id}
                  ref={
                    isSharedMatch
                      ? sharedMatchRef
                      : shouldOpenDirectVerdict
                        ? directMatchRef
                        : isFirstNewMatch
                          ? firstNewMatchRef
                          : undefined
                  }
                >
                  <MatchCard
                    match={m}
                    you={you}
                    onPlayerClick={onSearchPlayer}
                    locale={locale}
                    t={t}
                    profileShard={shard}
                    profileGameName={account.gameName}
                    profileTagLine={account.tagLine}
                    openJudgeRequest={shouldOpenDirectVerdict ? directJudgeRequest : 0}
                    onProfileInteraction={onProfileInteraction}
                    sharedVerdict={isSharedMatch ? sharedVerdict : null}
                    onSharedNewVerdict={
                      isSharedMatch && sharedVerdict
                        ? () => {
                            onProfileInteraction?.(sharedVerdict.matchId ?? "");
                          }
                        : undefined
                    }
                  />
                </div>
              );
            })}
            {/* "Show more" CTA — rendered only while there are still more
                matches available within the 20-match cap. Disappears
                entirely once expanded (per product spec). */}
            {remainingCount > 0 ? (
              <ShowMoreMatchesButton
                remainingCount={remainingCount}
                t={t}
                onClick={() => {
                  // Mark intent BEFORE flipping state so the post-render
                  // effect knows this transition was user-driven (vs.
                  // e.g. a parent re-render that happened to set expanded).
                  justExpandedRef.current = true;
                  setExpanded(true);
                }}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className={`text-2xl font-bold ${accent ? "text-gold" : "text-foreground"}`}>
        {value}
      </div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
