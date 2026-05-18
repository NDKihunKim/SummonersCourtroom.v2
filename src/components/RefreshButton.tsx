/**
 * RefreshButton — manual cache refresh for a player's match-history page.
 *
 * Pure presentational + a single mutation hook. The parent owns the cache
 * data and decides what to do with the refreshed payload (this component
 * just calls the mutation, surfaces errors as toasts, and exposes a
 * cooldown-aware disabled state).
 *
 * Cooldown is enforced server-side; we mirror the timestamp here so the
 * button greys out and shows "Available in Ns" without a round-trip.
 */

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Shard } from "@/lib/regions";
import {
  refreshSummoner,
  type CachedSummonerPayload,
} from "@/functions/summoner-cache.functions";
import type { TranslationKey } from "@/i18n";
import { TurnstileWidget, type TurnstileHandle } from "@/components/TurnstileWidget";

interface Props {
  shard: Shard;
  gameName: string;
  tagLine: string;
  /** Epoch ms — when `matches` was last fetched from Riot. */
  cachedAt: number;
  /** Epoch ms — earliest time the next refresh is allowed. */
  refreshAvailableAt: number;
  /** Called with the fresh payload on success. */
  onRefreshed: (payload: CachedSummonerPayload) => void;
  t?: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

/**
 * Format an "Xm ago" / "just now" string. Matches the look of the
 * server-side `relativeTime` helper but works on numbers we already have
 * client-side without an extra import dance.
 */
function formatAgo(
  epochMs: number,
  now: number,
  t?: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  const diff = Math.max(0, now - epochMs);
  if (diff < 30_000) return t?.("justNow") ?? "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return `${Math.floor(diff / 1000)}${t?.("secondsAgo") ?? "s ago"}`;
  if (mins < 60) return `${mins}${t?.("minutesAgo") ?? "m ago"}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}${t?.("hoursAgo") ?? "h ago"}`;
  const days = Math.floor(hours / 24);
  return `${days}${t?.("daysAgo") ?? "d ago"}`;
}

export function RefreshButton({
  shard,
  gameName,
  tagLine,
  cachedAt,
  refreshAvailableAt,
  onRefreshed,
  t,
}: Props) {
  // Re-render every second while the cooldown is active OR the timestamp is
  // fresh enough that "Xm ago" might roll over visibly. Cleared otherwise.
  const [now, setNow] = useState(() => Date.now());
  const turnstileRef = useRef<TurnstileHandle>(null);
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
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const mutation = useMutation({
    mutationFn: (turnstileToken?: string) =>
      refreshSummoner({ data: { shard, gameName, tagLine, turnstileToken } }),
    onSuccess: (payload) => {
      onRefreshed(payload);
      toast.success(t?.("matchHistoryRefreshed") ?? "Match history refreshed.");
    },
    onError: (err) => {
      // Cooldown errors come through as plain Error messages from the
      // server function — surface them directly.
      toast.error(err instanceof Error ? err.message : (t?.("refreshFailed") ?? "Refresh failed."));
    },
    onSettled: resetTurnstile,
  });

  const cooldownRemainingMs = Math.max(0, refreshAvailableAt - now);
  const onCooldown = cooldownRemainingMs > 0;
  const disabled = mutation.isPending || onCooldown;

  // Soft hint: turn timestamp gold once the cache is older than 10 minutes.
  // Acts as a nudge to refresh without auto-refetching.
  const ageMs = now - cachedAt;
  const stale = ageMs > 10 * 60_000;

  async function handleRefresh() {
    try {
      const turnstileToken = await executeTurnstile();
      mutation.mutate(turnstileToken);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Human verification failed. Please try again.");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void handleRefresh()}
        disabled={disabled}
        aria-label={t?.("refreshMatchHistory") ?? "Refresh match history"}
        title={
          onCooldown
            ? `${t?.("availableIn") ?? "Available in"} ${Math.ceil(cooldownRemainingMs / 1000)}s`
            : t?.("refreshMatchHistory") ?? "Refresh match history"
        }
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card transition-colors hover:border-gold hover:text-gold disabled:cursor-not-allowed disabled:opacity-50"
      >
        {mutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
      </button>
      <span
        className={`text-xs ${stale ? "text-gold" : "text-muted-foreground"}`}
      >
        {onCooldown
          ? `${t?.("availableIn") ?? "Available in"} ${Math.ceil(cooldownRemainingMs / 1000)}s`
          : `${t?.("updated") ?? "Updated"} ${formatAgo(cachedAt, now, t)}`}
      </span>
      <TurnstileWidget
        ref={turnstileRef}
        siteKey={turnstileSiteKey}
        resetKey={turnstileResetKey}
      />
    </div>
  );
}
