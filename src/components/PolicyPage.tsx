import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AdFrame } from "@/components/AdFrame";
import type { Locale, TranslationKey } from "@/i18n";

export const CONTACT_EMAIL = "peanuttabasco852@gmail.com";

export const RIOT_DISCLAIMER =
  "Summoner's Courtroom isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";

export function PolicyPage({
  title,
  eyebrow,
  children,
  locale = "en",
  onLocaleChange,
  t,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  locale?: Locale;
  onLocaleChange?: (locale: Locale) => void;
  t?: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  return (
    <AdFrame locale={locale} onLocaleChange={onLocaleChange} t={t}>
      <main className="rounded-2xl" style={{ background: "var(--gradient-hero)" }}>
        <div className="mx-auto max-w-3xl px-4 pb-12 pt-20 sm:pt-24">
          {eyebrow && (
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-gold">
              {eyebrow}
            </p>
          )}
          <h1 className="text-3xl font-bold text-foreground sm:text-4xl">{title}</h1>
          <div className="mt-8 space-y-7 text-sm leading-7 text-muted-foreground sm:text-base">
            {children}
          </div>
        </div>
      </main>
    </AdFrame>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card/50 p-5">
      <h2 className="mb-3 text-lg font-semibold text-foreground">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function PolicyLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-semibold text-gold underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}
