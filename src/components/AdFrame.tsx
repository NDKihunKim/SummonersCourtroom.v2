import type { ReactNode } from "react";
import { LOCALES, type Locale, type TranslationKey } from "@/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const RIOT_DISCLAIMER =
  "Summoner's Courtroom isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";

const FOOTER_LINKS = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/contact", label: "Contact" },
  { href: "/legal", label: "Legal" },
];

/**
 * Mock ad slots (north/south leaderboards + east/west skyscrapers) have
 * been removed per product decision. AdFrame now just provides the
 * page-level wrapper so existing call sites keep working without any
 * layout shift around the content column.
 */

export function AdFrame({
  children,
  fitViewport = false,
  homeHref = "/",
  locale = "en",
  onLocaleChange,
  t,
}: {
  children: ReactNode;
  /**
   * When true, the frame is locked to viewport height (no page scroll)
   * and the content column absorbs all available space. Leave false for
   * pages that legitimately need to scroll (e.g. match history list).
   */
  fitViewport?: boolean;
  homeHref?: string;
  locale?: Locale;
  onLocaleChange?: (locale: Locale) => void;
  t?: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  const outer = fitViewport ? "flex min-h-dvh flex-col" : "min-h-dvh";
  const contentCol = fitViewport
    ? "min-w-0 min-h-0 flex-1 px-0 py-0"
    : "min-w-0 flex-1 px-0 py-0";

  return (
    <div className={outer}>
      <a
        href={homeHref}
        aria-label={t?.("home") ?? "Go to Summoner's Courtroom home"}
        className="fixed left-2 top-2 z-50 inline-flex h-10 w-10 items-center justify-center rounded-md border border-gold/30 bg-background/70 p-1.5 shadow-lg backdrop-blur transition hover:border-gold hover:bg-card sm:left-3 sm:top-3 sm:h-12 sm:w-12"
      >
        <img
          src="/summoners-courtroom-logo.png"
          alt=""
          className="h-full w-full object-contain"
          aria-hidden="true"
        />
      </a>
      {onLocaleChange && t && (
        <div className="fixed right-2 top-2 z-50 sm:right-3 sm:top-3">
          <Select
            value={locale}
            onValueChange={(value) => onLocaleChange(value as Locale)}
          >
            <SelectTrigger
              aria-label={t("languageSelect")}
              className="h-10 min-w-[118px] gap-1.5 border-gold/30 bg-background/70 px-3 text-xs font-semibold text-gold shadow-lg backdrop-blur transition hover:border-gold hover:bg-card focus:ring-gold/30 sm:h-12"
            >
              <SelectValue>
                {LOCALES.find((option) => option.code === locale)?.label ?? "English"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent
              align="end"
              className="min-w-[150px] border-gold/30 bg-popover/95 backdrop-blur"
            >
              {LOCALES.map((option) => (
                <SelectItem key={option.code} value={option.code} className="text-sm">
                  <span className="font-semibold">{option.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className={contentCol}>{children}</div>
      <footer className="shrink-0 border-t border-border/60 px-3 py-3 text-center leading-relaxed text-muted-foreground/85 sm:px-4">
        <nav className="mb-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
          {FOOTER_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="font-semibold text-muted-foreground transition-colors hover:text-gold"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
          {t?.("disclaimerLabel") ?? "Riot Games Disclaimer"}
        </div>
        <p className="mx-auto max-w-5xl text-[10px] sm:text-xs">
          {RIOT_DISCLAIMER}
        </p>
      </footer>
    </div>
  );
}
