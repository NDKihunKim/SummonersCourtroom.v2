import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Home, Languages, Settings, User, X } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { LOCALES, type Locale, type TranslationKey } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { getAnonymousId } from "@/lib/anonymous-id";
import {
  getVerdictQuotaStatus,
  type VerdictQuotaStatus,
} from "@/functions/verdict-quota.functions";

const RIOT_DISCLAIMER =
  "Summoner's Courtroom isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";

const FOOTER_LINKS = [
  { href: "/about", label: "About", key: "footerAbout" },
  { href: "/privacy", label: "Privacy", key: "footerPrivacy" },
  { href: "/terms", label: "Terms", key: "footerTerms" },
  { href: "/contact", label: "Contact", key: "footerContact" },
  { href: "/legal", label: "Legal", key: "footerLegal" },
] as const;

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
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [quota, setQuota] = useState<VerdictQuotaStatus | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const activeLocaleLabel = LOCALES.find((option) => option.code === locale)?.label ?? "English";

  useEffect(() => {
    if (!dashboardOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!dashboardRef.current) return;
      if (!dashboardRef.current.contains(event.target as Node)) setDashboardOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDashboardOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dashboardOpen]);

  useEffect(() => {
    if (!dashboardOpen) setLanguageOpen(false);
  }, [dashboardOpen]);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session ?? null);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!dashboardOpen) return;
    let cancelled = false;

    async function loadQuota() {
      setQuotaLoading(true);
      try {
        setQuotaError(null);
        const accessToken = session?.access_token;
        const status = await getVerdictQuotaStatus({
          data: accessToken ? { accessToken } : { anonymousId: getAnonymousId() },
        });
        if (!cancelled) setQuota(status);
      } catch (error) {
        if (!cancelled) {
          setQuota(null);
          setQuotaError(error instanceof Error ? error.message : null);
        }
      } finally {
        if (!cancelled) setQuotaLoading(false);
      }
    }

    void loadQuota();
    return () => {
      cancelled = true;
    };
  }, [dashboardOpen, session?.access_token]);

  async function sendMagicLink() {
    setAuthLoading(true);
    try {
      const redirectTo = typeof window !== "undefined" ? window.location.href : undefined;
      const { error } = await supabase.auth.signInWithOtp({
        email: authEmail.trim(),
        options: {
          emailRedirectTo: redirectTo,
        },
      });
      if (error) throw error;
      toast.success(t?.("dashboardMagicLinkSent") ?? "Check your email for the sign-in link.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send magic link.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOut() {
    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setQuota(null);
      toast.success(t?.("dashboardSignedOut") ?? "Signed out.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign out failed.");
    } finally {
      setAuthLoading(false);
    }
  }

  function quotaText(status: VerdictQuotaStatus): string {
    if (status.plan === "unli") {
      return t?.("dashboardQuotaUnlimited") ?? "Unlimited verdicts today (unli)";
    }
    return (
      t?.("dashboardQuota", {
        used: status.used,
        limit: status.limit ?? 0,
        plan: status.plan,
      }) ?? `${status.used}/${status.limit ?? 0} verdicts used today`
    );
  }

  return (
    <div className={outer}>
      <div ref={dashboardRef} className="fixed left-2 top-2 z-50 sm:left-3 sm:top-3">
        <button
          type="button"
          aria-label={t?.("dashboardOpen") ?? "Open dashboard"}
          aria-expanded={dashboardOpen}
          onClick={() => setDashboardOpen((open) => !open)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-gold/30 bg-background/70 p-1.5 shadow-lg backdrop-blur transition hover:border-gold hover:bg-card sm:h-12 sm:w-12"
        >
          <img
            src="/summoners-courtroom-logo.png"
            alt=""
            className="h-full w-full object-contain"
            aria-hidden="true"
          />
        </button>

        {dashboardOpen && (
          <div
            role="dialog"
            aria-label={t?.("dashboardTitle") ?? "Dashboard"}
            className="mt-2 w-[min(calc(100vw-1rem),20rem)] animate-fade-in rounded-xl border border-border bg-card/95 p-3 text-left shadow-xl backdrop-blur"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <a
                href={homeHref}
                aria-label={t?.("home") ?? "Go to Summoner's Courtroom home"}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background/40 px-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-gold hover:text-gold"
              >
                <Home className="h-3.5 w-3.5" />
                {t?.("dashboardHome") ?? "Home"}
              </a>
              <button
                type="button"
                aria-label={t?.("dashboardClose") ?? "Close dashboard"}
                onClick={() => setDashboardOpen(false)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <section className="rounded-lg border border-border bg-background/40 p-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gold">
                  <User className="h-3.5 w-3.5" />
                  {t?.("dashboardProfile") ?? "Profile"}
                </div>
                {session ? (
                  <div className="space-y-2">
                    <p className="truncate text-xs font-semibold text-foreground">
                      {session.user.email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {quotaLoading
                        ? t?.("dashboardQuotaLoading") ?? "Loading verdict quota..."
                        : quota
                          ? quotaText(quota)
                          : quotaError
                            ? `${t?.("dashboardQuotaUnavailable") ?? "Verdict quota unavailable."} ${quotaError}`
                            : t?.("dashboardQuotaUnavailable") ?? "Verdict quota unavailable."}
                    </p>
                    <button
                      type="button"
                      disabled={authLoading}
                      onClick={signOut}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-gold hover:text-gold disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t?.("dashboardSignOut") ?? "Sign out"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      {quotaLoading
                        ? t?.("dashboardQuotaLoading") ?? "Loading verdict quota..."
                        : quota
                          ? quotaText(quota)
                          : quotaError
                            ? `${t?.("dashboardQuotaUnavailable") ?? "Verdict quota unavailable."} ${quotaError}`
                            : t?.("dashboardAnonymousQuotaHelp") ??
                              "Sign in for a higher daily verdict limit."}
                    </p>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                      placeholder={t?.("dashboardEmail") ?? "Email"}
                      className="h-8 w-full rounded-md border border-border bg-background/60 px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gold/50"
                    />
                    <button
                      type="button"
                      disabled={authLoading || !authEmail}
                      onClick={sendMagicLink}
                      className="w-full rounded-md border border-gold/50 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold transition-colors hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t?.("dashboardSendMagicLink") ?? "Send magic link"}
                    </button>
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-border bg-background/40 p-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gold">
                  <Settings className="h-3.5 w-3.5" />
                  {t?.("dashboardOptions") ?? "Options"}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t?.("dashboardOptionsComingSoon") ?? "More settings will be added here."}
                </p>
              </section>

              <section className="rounded-lg border border-border bg-background/40 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gold">
                  <Languages className="h-3.5 w-3.5" />
                  {t?.("languageSelect") ?? "Language"}
                </div>
                <div className="grid gap-1">
                  <button
                    type="button"
                    aria-expanded={languageOpen}
                    onClick={() => setLanguageOpen((open) => !open)}
                    className="flex items-center justify-between rounded-md bg-gold/15 px-3 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold/20"
                  >
                    <span>{activeLocaleLabel}</span>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${languageOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {languageOpen &&
                    LOCALES.map((option) => {
                      const active = option.code === locale;
                      return (
                        <button
                          key={option.code}
                          type="button"
                          onClick={() => {
                            if (!active) onLocaleChange?.(option.code);
                            setLanguageOpen(false);
                          }}
                          className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                            active
                              ? "text-gold"
                              : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                          }`}
                        >
                          <span>{option.label}</span>
                          {active && <Check className="h-4 w-4" />}
                        </button>
                      );
                  })}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
      <div className={contentCol}>{children}</div>
      <footer className="shrink-0 border-t border-border/60 px-3 py-3 text-center leading-relaxed text-muted-foreground/85 sm:px-4">
        <nav className="mb-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
          {FOOTER_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="font-semibold text-muted-foreground transition-colors hover:text-gold"
            >
              {t?.(link.key) ?? link.label}
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
