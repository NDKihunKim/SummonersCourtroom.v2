import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useCallback,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ArrowLeft, Loader2, Search, Star, Swords, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { MatchCard } from "@/components/MatchCard";
import { AdFrame } from "@/components/AdFrame";
import { RegionPicker } from "@/components/RegionPicker";
import { ShowMoreMatchesButton } from "@/components/ShowMoreMatchesButton";
import { SHARDS, type Shard } from "@/lib/regions";
import { useShard } from "@/hooks/useShard";
import {
  getOrFetchMatchHistory,
  type CachedSummonerPayload,
} from "@/functions/summoner-cache.functions";
import { SearchSuggestions } from "@/components/SearchSuggestions";
import { useRecentSearches } from "@/hooks/useRecentSearches";
import { useSavedPlayers } from "@/hooks/useSavedPlayers";
import { useSuggestions, type Suggestion } from "@/hooks/useSuggestions";
import { RefreshButton } from "@/components/RefreshButton";
import { TierEmblem } from "@/components/TierEmblem";
import { tierLabel, type RankedEntry } from "@/lib/tier";
import { ProfileIcon } from "@/components/ProfileIcon";
import type { Participant } from "@/lib/match-types";
import { SampleSizeSelector } from "@/components/SampleSizeSelector";
import { useSampleSize } from "@/hooks/useSampleSize";
import { computeMatchStats } from "@/lib/match-stats";
import { useLocale, type Locale, type TranslationKey } from "@/i18n";
import { TurnstileWidget, type TurnstileHandle } from "@/components/TurnstileWidget";

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

function parseRiotId(input: string): { gameName: string; tagLine: string } | null {
  const trimmed = input.trim();
  const hash = trimmed.lastIndexOf("#");
  if (hash < 1 || hash === trimmed.length - 1) return null;
  return {
    gameName: trimmed.slice(0, hash).trim(),
    tagLine: trimmed.slice(hash + 1).trim(),
  };
}

/**
 * Type-guard for shard codes received from URL query params. We never trust
 * `?shard=` blindly — an attacker (or a stale bookmark) could pass any
 * string, and the cache function will reject unknown shards with a 500.
 * Using the canonical SHARDS list keeps this in sync automatically when
 * new shards are added in `src/lib/regions.ts`.
 */
function isKnownShard(value: string): value is Shard {
  return SHARDS.some((s) => s.code === value);
}

/**
 * Build the same-origin dedicated profile URL used for shareable player links.
 */
export function buildPlayerProfileUrl(shard: Shard, gameName: string, tagLine: string): string {
  return `/summoner/${encodeURIComponent(shard)}/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
}

function Index() {
  const { locale, setLocale, t } = useLocale();
  const navigate = useNavigate();
  const [riotId, setRiotId] = useState("");
  // Per-shard selection (e.g. "NA", "EUW", "KR"). The hook auto-detects from
  // the visitor's IANA timezone on first visit, then persists their choice
  // (or any later manual override) to localStorage. On submit we translate
  // to the routing cluster the backend expects (handled inside the cache fn).
  const { shard, setShard } = useShard();
  const [data, setData] = useState<CachedSummonerPayload | null>(null);
  const [viewedShard, setViewedShard] = useState<Shard | null>(null);

  // ─── Autocomplete (recent searches) ────────────────────────────────────
  // Owned here so the form's submit + keyboard handlers can drive it.
  const { recents, addRecent, removeRecent, clearAll } = useRecentSearches();
  const { savedPlayers, addSavedPlayer, removeSavedPlayer, isSaved } = useSavedPlayers();
  const [isSuggestOpen, setIsSuggestOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isSearchVerifying, setIsSearchVerifying] = useState(false);
  const listboxId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const [suggestionsHeight, setSuggestionsHeight] = useState(0);
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || undefined;
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
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

  // Composed suggestions: local recents first, then shared backend index
  // (sorted Challenger -> Iron). Debounces the server call internally.
  const suggestions = useSuggestions({ savedPlayers, recents, query: riotId, shard, limit: 20 });

  // Reset highlight whenever the visible list changes so we never point at
  // a stale index (which would otherwise read as "selected" via aria).
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [suggestions]);

  // Suggestions are shard-scoped; switching shard mid-type would otherwise
  // show stale results from the previous shard for a frame.
  useEffect(() => {
    setIsSuggestOpen(false);
  }, [shard]);

  // Outside-click → close. Listens at the document level but ignores clicks
  // inside our wrapper (input + dropdown).
  useEffect(() => {
    if (!isSuggestOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setIsSuggestOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [isSuggestOpen]);

  const mutation = useMutation({
    mutationFn: async (vars: {
      gameName: string;
      tagLine: string;
      shard: Shard;
      turnstileToken?: string;
    }) => {
      return getOrFetchMatchHistory({ data: vars });
    },
    onSuccess: (result, vars) => {
      setShard(vars.shard);
      // Persist this successful lookup for future autocomplete suggestions.
      // Source the canonical name/tag from the server response so casing
      // matches Riot's record (the user may have typed it differently).
      addRecent({
        gameName: result.account.gameName,
        tagLine: result.account.tagLine,
        shard: vars.shard,
      });
      void navigate({
        to: "/summoner/$shard/$gameName/$tagLine",
        params: {
          shard: vars.shard,
          gameName: result.account.gameName,
          tagLine: result.account.tagLine,
        },
      });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("failedToLoadMatches")),
    onSettled: () => {
      setIsSearchVerifying(false);
      resetTurnstile();
    },
  });
  const isSearching = isSearchVerifying || mutation.isPending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseRiotId(riotId);
    if (!parsed) {
      toast.error(t("invalidRiotId"));
      return;
    }
    // Close the dropdown on submit so it doesn't linger over the result view.
    setIsSuggestOpen(false);
    // Cache function takes the raw shard and handles routing internally.
    try {
      setIsSearchVerifying(true);
      const turnstileToken = await executeTurnstile();
      mutation.mutate({ ...parsed, shard, turnstileToken });
    } catch (error) {
      setIsSearchVerifying(false);
      toast.error(error instanceof Error ? error.message : "Human verification failed. Please try again.");
    }
  }

  /** Apply a clicked / Enter-selected suggestion: fill input + submit. */
  async function selectSuggestion(item: Suggestion) {
    const value = `${item.gameName}#${item.tagLine}`;
    setRiotId(value);
    setIsSuggestOpen(false);
    // Use the suggestion's parsed parts directly — avoids re-parsing the
    // string we just constructed and dodges any stale-state edge cases
    // around setRiotId not being applied before mutation.mutate runs.
    try {
      setIsSearchVerifying(true);
      const turnstileToken = await executeTurnstile();
      mutation.mutate({
        gameName: item.gameName,
        tagLine: item.tagLine,
        shard: item.shard,
        turnstileToken,
      });
    } catch (error) {
      setIsSearchVerifying(false);
      toast.error(error instanceof Error ? error.message : "Human verification failed. Please try again.");
    }
  }

  /** Footer "Clear all history" — wipes local recents only. */
  function handleClearAll() {
    const cleared = clearAll();
    if (cleared > 0) {
      toast.success(t("clearedRecentSearches", { count: cleared, plural: cleared === 1 ? "" : "es" }));
    }
  }

  function closeSuggestions() {
    setIsSuggestOpen(false);
    setHighlightedIndex(-1);
  }

  function handleShardChange(nextShard: Shard) {
    closeSuggestions();
    setShard(nextShard);
  }

  function handleRegionOpenChange(open: boolean) {
    if (open) closeSuggestions();
  }

  /**
   * Open a player's match history in a NEW tab.
   *
   * Used by the in-row roster click handler — clicking any ally/enemy name
   * (or your own "you" row) opens that player in a fresh browser tab so the
   * current tab stays anchored on the original lookup.
   *
   * Implementation notes:
   *   - We use `window.open(url, "_blank", "noopener,noreferrer")`. The
   *     `noopener` flag is critical for both security and performance:
   *     without it the new tab gets a `window.opener` reference back into
   *     this tab, which (a) lets the new page navigate this tab via
   *     `opener.location` (tabnabbing), and (b) prevents the browser from
   *     running the two tabs in separate processes.
   *   - SSR-safe: guards against `window` being undefined.
   *   - Uses the CURRENT shard. Cross-region lookups would require a shard
   *     hint we don't have for arbitrary roster names; sticking to the
   *     active shard matches op.gg-style tools and avoids surprising the
   *     user. The deep-link URL carries the shard so the new tab inherits
   *     it instead of falling back to the visitor's stored preference.
   *   - Validates the Riot ID up front so a malformed roster entry never
   *     opens a useless blank tab.
   */
  function searchPlayerById(rawRiotId: string) {
    const parsed = parseRiotId(rawRiotId);
    if (!parsed) {
      // Should be unreachable from the roster (every Riot ID has a tag) but
      // we surface a friendly toast instead of silently failing.
      toast.error(t("couldntParse", { riotId: rawRiotId }));
      return;
    }
    if (typeof window === "undefined") return; // SSR safety
    const url = buildPlayerProfileUrl(viewedShard ?? shard, parsed.gameName, parsed.tagLine);
    // `noopener,noreferrer` — see security note above.
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // ─── Deep-link auto-search (?riotId=...&shard=...&autosearch=1) ───────
  // When this route is opened with the deep-link query params (set by
  // `searchPlayerById` when a roster row is clicked in another tab), we
  // pre-fill the input, sync the shard, and trigger the same mutation the
  // form's submit handler uses. Then we strip the params so a manual
  // refresh later doesn't repeatedly re-trigger the search.
  //
  // Runs once on mount only (`[]` deps) — subsequent in-tab navigations
  // are driven by user input, not URL params.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const shardParam = params.get("shard");
    if (shardParam && isKnownShard(shardParam) && shardParam !== shard) {
      setShard(shardParam);
    }

    const rawRiotId = params.get("riotId");
    const auto = params.get("autosearch");
    if (!rawRiotId || auto !== "1") {
      if (shardParam && isKnownShard(shardParam)) {
        window.history.replaceState(null, "", window.location.pathname);
      }
      return;
    }

    const parsed = parseRiotId(rawRiotId);
    if (!parsed) {
      // Bad deep link — silently strip the params and let the user retype.
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }

    // Optional shard override from the URL. Falls back to the user's stored
    // shard preference (already loaded by `useShard`) when missing or unknown.
    const effectiveShard: Shard =
      shardParam && isKnownShard(shardParam) ? shardParam : shard;

    // Mirror the form's submit behavior so caching / recent searches /
    // toasts all behave identically to a manual lookup.
    setRiotId(rawRiotId);
    setIsSuggestOpen(false);
    mutation.mutate({ ...parsed, shard: effectiveShard });

    // Clean the URL so a refresh doesn't re-fire (we already have `data`
    // in state and don't need the params anymore).
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Keyboard navigation inside the input when the dropdown is open. */
  function onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    // Open the dropdown on first arrow key even if it was closed.
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !isSuggestOpen && suggestions.length > 0) {
      setIsSuggestOpen(true);
      e.preventDefault();
      return;
    }
    if (!isSuggestOpen || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      // Only intercept Enter when a suggestion is highlighted; otherwise
      // let the form submit normally with the typed text.
      if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
        e.preventDefault();
        selectSuggestion(suggestions[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      setIsSuggestOpen(false);
    }
  }

  const hasVisibleSuggestions = isSuggestOpen && suggestions.length > 0;

  useEffect(() => {
    if (!hasVisibleSuggestions) {
      setSuggestionsHeight(0);
      return;
    }

    const measure = () => {
      const element = suggestionsRef.current;
      if (!element) return;
      setSuggestionsHeight(element.offsetHeight);
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [hasVisibleSuggestions, suggestions.length, recents.length]);

  if (data) {
    const resultShard = viewedShard ?? shard;

    return (
      <AdFrame homeHref={`/?shard=${resultShard}`} locale={locale} t={t}>
        <MatchHistory
          result={data}
          shard={resultShard}
          isSaved={isSaved({
            gameName: data.account.gameName,
            tagLine: data.account.tagLine,
            shard: resultShard,
          })}
          onToggleSaved={() => {
            const player = {
              gameName: data.account.gameName,
              tagLine: data.account.tagLine,
              shard: resultShard,
            };
            if (isSaved(player)) {
              removeSavedPlayer(`${resultShard}|${data.account.gameName.toLowerCase()}#${data.account.tagLine.toLowerCase()}`);
              toast.success(t("unsavedPlayer", { riotId: `${data.account.gameName}#${data.account.tagLine}` }));
            } else {
              addSavedPlayer({
                ...player,
                profileIconId: data.profileIconId ?? null,
                tier: data.ranked?.tier ?? null,
                division: data.ranked?.division ?? null,
                lp: data.ranked?.lp ?? null,
              });
              toast.success(t("savedPlayer", { riotId: `${data.account.gameName}#${data.account.tagLine}` }));
            }
          }}
          onRefreshed={(fresh) => setData(fresh)}
          onBack={() => {
            setData(null);
            setViewedShard(null);
            mutation.reset();
          }}
          onSearchPlayer={searchPlayerById}
          locale={locale}
          t={t}
        />
      </AdFrame>
    );
  }

  return (
    <AdFrame fitViewport locale={locale} onLocaleChange={setLocale} t={t}>
      {/* h-full lets the hero fill the leftover space between the
          north & south ads (AdFrame's middle row is flex-1 in fit
          mode). Padding is reduced so the form stays visible on
          shorter viewports without scrolling. */}
      <div className="min-h-[calc(100dvh-4rem)] sm:min-h-[calc(100dvh-5rem)]" style={{ background: "var(--gradient-hero)" }}>
        <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-3xl flex-col items-center justify-center px-3 py-16 sm:min-h-[calc(100dvh-5rem)] sm:px-4 sm:py-8 md:py-10">
          <div className="mb-3 flex items-center gap-2 text-center text-[10px] font-semibold uppercase tracking-[0.22em] text-gold sm:text-xs sm:tracking-[0.3em]">
            <Swords className="h-3.5 w-3.5" /> {t("heroLabel")}
          </div>
          <img
            src="/summoners-courtroom-title.png"
            alt="Summoner's Courtroom"
            className="mt-1 h-auto max-h-24 w-full max-w-xl object-contain sm:max-h-28 md:max-h-36"
          />
          <form onSubmit={onSubmit} className="mt-8 w-full max-w-xl sm:mt-10">
            {/* Wrapper is `relative` so the suggestions dropdown can stack
                directly under the input row without affecting layout. */}
            <div ref={wrapperRef} className="relative">
            <div
              className="flex flex-col gap-2 rounded-xl border border-border bg-card/80 p-2 backdrop-blur transition-all focus-within:border-gold sm:flex-row"
              style={{ boxShadow: "var(--shadow-elegant)" }}
            >
              {/* Shard picker sits on the LEFT, separated by a subtle divider */}
              <div className="flex items-center border-b border-border pb-1 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-1">
                <RegionPicker
                  value={shard}
                  onChange={handleShardChange}
                  onOpenChange={handleRegionOpenChange}
                  t={t}
                />
              </div>
              <div className="flex min-w-0 flex-1 items-center">
                <Search className="ml-3 h-5 w-5 shrink-0 text-muted-foreground" />
                <input
                  type="text"
                  value={riotId}
                  onChange={(e) => {
                    setRiotId(e.target.value);
                    // Re-open as the user types so suggestions re-appear
                    // even if they previously dismissed via Esc.
                    setIsSuggestOpen(true);
                  }}
                  onFocus={() => setIsSuggestOpen(true)}
                  onKeyDown={onInputKeyDown}
                  role="combobox"
                  aria-expanded={hasVisibleSuggestions}
                  aria-controls={listboxId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    highlightedIndex >= 0 ? `recent-option-${highlightedIndex}` : undefined
                  }
                  placeholder={t("riotIdPlaceholder")}
                  autoComplete="off"
                  className="min-w-0 w-full bg-transparent px-3 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                {riotId && (
                  <button
                    type="button"
                    onClick={() => {
                      setRiotId("");
                      setIsSuggestOpen(false);
                    }}
                    aria-label={t("clearRiotId")}
                    className="mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={isSearching}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-gold bg-gold/10 px-5 py-2.5 text-sm font-semibold text-gold transition-colors hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:py-2"
              >
                {isSearching ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
                  </>
                ) : (
                  t("search")
                )}
              </button>
            </div>

            {/* Dropdown — only mounted when there's something to show, so
                the listbox isn't announced empty by screen readers.
                We require `suggestions.length > 0` (not just `recents.length`)
                so that immediately after "Clear all history" the dropdown
                disappears instead of lingering with backend index entries
                that look identical to local history. */}
            {hasVisibleSuggestions && (
              <SearchSuggestions
                items={suggestions}
                highlightedIndex={highlightedIndex}
                query={riotId}
                listboxId={listboxId}
                onHover={setHighlightedIndex}
                onSelect={selectSuggestion}
                onRemove={removeRecent}
                onUnsave={removeSavedPlayer}
                recentsCount={recents.length}
                onClearAll={handleClearAll}
                contentRef={suggestionsRef}
                t={t}
              />
            )}
            </div>
            <div className="mt-3">
              <TurnstileWidget
                ref={turnstileRef}
                siteKey={turnstileSiteKey}
                resetKey={turnstileResetKey}
              />
            </div>
            <div
              className="overflow-hidden transition-[height] duration-300 ease-out"
              style={{ height: suggestionsHeight }}
              aria-hidden
            />
          </form>

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
  onBack,
  onSearchPlayer,
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
    SHOW_DEV_CONTEXT && rankedQueue === "flex" ? rankedEntries.flex : rankedEntries.solo ?? ranked;
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

  // Cap defensively — if the cache somehow holds <10, slice() handles it;
  // if it ever holds >20, we still respect the 20-match product cap.
  const visibleCount = Math.min(
    expanded ? EXPANDED_VISIBLE : INITIAL_VISIBLE,
    matches.length,
  );
  const visibleMatches = matches.slice(0, visibleCount);

  // How many more matches the user could reveal by clicking the button.
  // 0 means "hide the button entirely" (already at cap or not enough cached).
  const remainingCount = Math.max(
    0,
    Math.min(EXPANDED_VISIBLE, matches.length) - visibleCount,
  );

  // Ref pointed at the FIRST newly-revealed card (index === INITIAL_VISIBLE).
  // Scroll it into view after expansion so the user immediately sees the
  // new content rather than having to hunt for it down-page.
  const firstNewMatchRef = useRef<HTMLDivElement | null>(null);
  const justExpandedRef = useRef(false);
  useEffect(() => {
    if (expanded && justExpandedRef.current && firstNewMatchRef.current) {
      firstNewMatchRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      justExpandedRef.current = false;
    }
  }, [expanded]);

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
        <button
          onClick={onBack}
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-gold"
        >
          <ArrowLeft className="h-4 w-4" /> {t("newSearch")}
        </button>

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
          <div className="flex flex-wrap items-center justify-between gap-6">
            {/* ── LEFT: identity ───────────────────────────────────────── */}
            <div className="flex items-center gap-4">
              {/* Real Data Dragon profile icon when we have one; falls back
                  automatically to the colored letter avatar otherwise. */}
              <ProfileIcon
                iconId={profileIconId}
                seed={seed}
                size={88}
                alt={`${account.gameName}#${account.tagLine} profile icon`}
              />
              <div>
                <div className="flex flex-wrap items-center gap-3">
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
                <div className="mt-2">
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
              const youSummoner = safeTag
                ? `${safeName}#${safeTag}`
                : safeName;
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
              return (
                <div
                  key={m.id}
                  ref={isFirstNewMatch ? firstNewMatchRef : undefined}
                >
                  <MatchCard
                    match={m}
                    you={you}
                    onPlayerClick={onSearchPlayer}
                    locale={locale}
                    t={t}
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
      <div className={`text-2xl font-bold ${accent ? "text-gold" : "text-foreground"}`}>{value}</div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
