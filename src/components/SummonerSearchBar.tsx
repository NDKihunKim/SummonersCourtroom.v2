import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { RegionPicker } from "@/components/RegionPicker";
import { SearchSuggestions } from "@/components/SearchSuggestions";
import { TurnstileWidget, type TurnstileHandle } from "@/components/TurnstileWidget";
import { getOrFetchMatchHistory } from "@/functions/summoner-cache.functions";
import { useRecentSearches } from "@/hooks/useRecentSearches";
import { useSavedPlayers } from "@/hooks/useSavedPlayers";
import { useShard } from "@/hooks/useShard";
import { useSuggestions, type Suggestion } from "@/hooks/useSuggestions";
import type { TranslationKey } from "@/i18n";
import type { Shard } from "@/lib/regions";

function parseRiotId(input: string): { gameName: string; tagLine: string } | null {
  const trimmed = input.trim();
  const hash = trimmed.lastIndexOf("#");
  if (hash < 1 || hash === trimmed.length - 1) return null;
  return {
    gameName: trimmed.slice(0, hash).trim(),
    tagLine: trimmed.slice(hash + 1).trim(),
  };
}

export function SummonerSearchBar({
  t,
  preferredShard,
  reserveSuggestionSpace = false,
  className = "",
}: {
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  preferredShard?: Shard;
  reserveSuggestionSpace?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();
  const [riotId, setRiotId] = useState("");
  const { shard, setShard } = useShard();
  const { recents, addRecent, removeRecent, clearAll } = useRecentSearches();
  const { savedPlayers, removeSavedPlayer } = useSavedPlayers();
  const [isSuggestOpen, setIsSuggestOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isSearchVerifying, setIsSearchVerifying] = useState(false);
  const [suggestionsHeight, setSuggestionsHeight] = useState(0);
  const listboxId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || undefined;
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  useEffect(() => {
    if (preferredShard) setShard(preferredShard);
  }, [preferredShard, setShard]);

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

  const suggestions = useSuggestions({ savedPlayers, recents, query: riotId, shard, limit: 20 });

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [suggestions]);

  useEffect(() => {
    setIsSuggestOpen(false);
  }, [shard]);

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
    }) => getOrFetchMatchHistory({ data: vars }),
    onSuccess: (result, vars) => {
      setShard(vars.shard);
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
  const hasVisibleSuggestions = isSuggestOpen && suggestions.length > 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseRiotId(riotId);
    if (!parsed) {
      toast.error(t("invalidRiotId"));
      return;
    }
    setIsSuggestOpen(false);
    try {
      setIsSearchVerifying(true);
      const turnstileToken = await executeTurnstile();
      mutation.mutate({ ...parsed, shard, turnstileToken });
    } catch (error) {
      setIsSearchVerifying(false);
      toast.error(
        error instanceof Error ? error.message : "Human verification failed. Please try again.",
      );
    }
  }

  async function selectSuggestion(item: Suggestion) {
    setRiotId(`${item.gameName}#${item.tagLine}`);
    setShard(item.shard);
    setIsSuggestOpen(false);
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
      toast.error(
        error instanceof Error ? error.message : "Human verification failed. Please try again.",
      );
    }
  }

  function handleClearAll() {
    const cleared = clearAll();
    if (cleared > 0) {
      toast.success(
        t("clearedRecentSearches", { count: cleared, plural: cleared === 1 ? "" : "es" }),
      );
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

  function onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (
      (e.key === "ArrowDown" || e.key === "ArrowUp") &&
      !isSuggestOpen &&
      suggestions.length > 0
    ) {
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
      if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
        e.preventDefault();
        void selectSuggestion(suggestions[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      setIsSuggestOpen(false);
    }
  }

  useEffect(() => {
    if (!reserveSuggestionSpace || !hasVisibleSuggestions) {
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
  }, [hasVisibleSuggestions, recents.length, reserveSuggestionSpace, suggestions.length]);

  return (
    <form onSubmit={onSubmit} className={className}>
      <div ref={wrapperRef} className="relative">
        <div
          className="flex flex-col gap-2 rounded-xl border border-border bg-card/80 p-2 backdrop-blur transition-all focus-within:border-gold sm:flex-row"
          style={{ boxShadow: "var(--shadow-elegant)" }}
        >
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
      {reserveSuggestionSpace && (
        <div
          className="overflow-hidden transition-[height] duration-300 ease-out"
          style={{ height: suggestionsHeight }}
          aria-hidden
        />
      )}
    </form>
  );
}
