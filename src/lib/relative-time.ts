import type { Locale, TranslationKey } from "@/i18n";

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

export function formatRelativePlayedAt(
  playedAtMs: number,
  nowMs: number,
  locale: Locale,
  t?: Translate,
): string {
  const diff = Math.max(0, nowMs - playedAtMs);
  if (diff < 60_000) return locale === "ko" && t ? t("justNow") : "Just now";

  const mins = Math.floor(diff / 60_000);
  if (mins < 60) {
    return locale === "ko" && t ? t("relativeMinutesAgo", { count: mins }) : `${mins}m ago`;
  }

  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return locale === "ko" && t ? t("relativeHoursAgo", { count: hours }) : `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return locale === "ko" && t ? t("relativeDaysAgo", { count: days }) : `${days}d ago`;
}
