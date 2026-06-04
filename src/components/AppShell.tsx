import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  Gauge,
  Home,
  Languages,
  LogOut,
  Mail,
  Settings,
  ShieldCheck,
  Trash2,
  User,
  X,
} from "lucide-react";
import type { Provider, Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { LOCALES, type Locale, type TranslationKey } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { getAnonymousId } from "@/lib/anonymous-id";
import {
  authRedirectUrl,
  completeEmailAuthHandoff,
  consumeAuthReturnPath,
  currentAuthReturnPath,
  listenForEmailAuthHandoff,
  rememberEmailAuthHandoff,
  rememberAuthReturnPath,
} from "@/lib/auth-return";
import {
  getVerdictQuotaStatus,
  type VerdictQuotaStatus,
} from "@/functions/verdict-quota.functions";
import { deleteCurrentAccount } from "@/functions/account.functions";

const RIOT_DISCLAIMER =
  "Summoner's Courtroom isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";
const LAST_AUTH_PROVIDER_KEY = "summoners-courtroom:last-auth-provider";

const FOOTER_LINKS = [
  { href: "/about", label: "About", key: "footerAbout" },
  { href: "/privacy", label: "Privacy", key: "footerPrivacy" },
  { href: "/terms", label: "Terms", key: "footerTerms" },
  { href: "/contact", label: "Contact", key: "footerContact" },
  { href: "/legal", label: "Legal", key: "footerLegal" },
] as const;

function restoreAuthReturnPath(path?: string | null) {
  const nextPath = path ?? consumeAuthReturnPath();
  if (!nextPath || typeof window === "undefined") return;
  if (currentAuthReturnPath() === nextPath) return;
  window.location.replace(nextPath);
}

function isAuthCallbackUrl() {
  if (typeof window === "undefined") return false;
  const search = new URLSearchParams(window.location.search);
  if (search.has("code") || search.has("error") || search.has("error_description")) return true;

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return hash.has("access_token") || hash.has("refresh_token") || hash.has("error");
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.78-.07-1.53-.2-2.23H12v4.22h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.23c1.89-1.74 2.98-4.3 2.98-7.52Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.97-.9 6.62-2.44l-3.23-2.51c-.9.6-2.04.95-3.39.95-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.41 13.88A6.01 6.01 0 0 1 6.1 12c0-.65.11-1.28.31-1.88V7.53H3.07A10 10 0 0 0 2 12c0 1.61.39 3.13 1.07 4.47l3.34-2.59Z"
      />
      <path
        fill="#EA4335"
        d="M12 6c1.47 0 2.79.51 3.82 1.5l2.87-2.87C16.96 3.01 14.7 2 12 2a10 10 0 0 0-8.93 5.53l3.34 2.59C7.2 7.76 9.4 6 12 6Z"
      />
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M20.32 4.37A19.8 19.8 0 0 0 15.36 3a13.8 13.8 0 0 0-.64 1.32 18.2 18.2 0 0 0-5.44 0A13.8 13.8 0 0 0 8.64 3c-1.73.3-3.4.76-4.96 1.37C.54 9.06-.31 13.63.11 18.13A20 20 0 0 0 6.2 21.2c.49-.66.92-1.36 1.3-2.1-.72-.27-1.4-.6-2.04-.98.17-.13.34-.26.5-.4a14.2 14.2 0 0 0 12.08 0c.16.14.33.27.5.4-.64.38-1.32.71-2.04.98.38.74.81 1.44 1.3 2.1a20 20 0 0 0 6.09-3.07c.5-5.22-.86-9.75-3.57-13.76ZM8.02 15.36c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.09 2.15 2.42 0 1.33-.95 2.41-2.15 2.41Zm7.96 0c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.09 2.15 2.42 0 1.33-.95 2.41-2.15 2.41Z"
      />
    </svg>
  );
}

/**
 * AppShell provides the page-level layout wrapper shared by public pages,
 * including dashboard controls, language selection, and footer links.
 */
export function AppShell({
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
  const contentCol = fitViewport ? "min-w-0 min-h-0 flex-1 px-0 py-0" : "min-w-0 flex-1 px-0 py-0";
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [dashboardView, setDashboardView] = useState<"main" | "options">("main");
  const [expandedOptionSections, setExpandedOptionSections] = useState<Set<string>>(
    () => new Set(),
  );
  const [languageOpen, setLanguageOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [emailLoginOpen, setEmailLoginOpen] = useState(false);
  const [lastAuthProvider, setLastAuthProvider] = useState<"discord" | "email" | "google" | null>(
    null,
  );
  const [authLoading, setAuthLoading] = useState(false);
  const [authHandoffParkedPath, setAuthHandoffParkedPath] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [quota, setQuota] = useState<VerdictQuotaStatus | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [quotaNow, setQuotaNow] = useState(() => Date.now());
  const dashboardTriggerRef = useRef<HTMLButtonElement>(null);
  const dashboardPanelRef = useRef<HTMLDivElement>(null);
  const activeLocaleLabel = LOCALES.find((option) => option.code === locale)?.label ?? "English";

  useEffect(() => {
    if (!dashboardOpen) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (dashboardPanelRef.current?.contains(target)) return;
      if (dashboardTriggerRef.current?.contains(target)) return;
      setDashboardOpen(false);
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
    if (!dashboardOpen) setEmailLoginOpen(false);
    if (!dashboardOpen) {
      setDashboardView("main");
      setExpandedOptionSections(new Set());
      setDeleteConfirmOpen(false);
    }
  }, [dashboardOpen]);

  useEffect(() => {
    let active = true;

    function handleSignedIn() {
      const handoff = completeEmailAuthHandoff();
      if (handoff?.shouldPark) {
        setAuthHandoffParkedPath(handoff.path);
        return;
      }
      restoreAuthReturnPath(handoff?.path);
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      if (data.session && isAuthCallbackUrl()) handleSignedIn();
    });

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "SIGNED_IN" && nextSession) handleSignedIn();
    });
    const stopEmailHandoffListener = listenForEmailAuthHandoff((path) => {
      if (!active) return;
      restoreAuthReturnPath(path);
    });

    return () => {
      active = false;
      stopEmailHandoffListener();
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    try {
      const provider = window.localStorage.getItem(LAST_AUTH_PROVIDER_KEY);
      if (provider === "discord" || provider === "email" || provider === "google") {
        setLastAuthProvider(provider);
      }
    } catch {
      setLastAuthProvider(null);
    }
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
        console.error("[dashboard] failed to load verdict quota:", error);
        if (!cancelled) {
          setQuota(null);
          setQuotaError(null);
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

  useEffect(() => {
    if (!dashboardOpen) return;
    setQuotaNow(Date.now());
    const id = window.setInterval(() => setQuotaNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [dashboardOpen]);

  async function sendMagicLink() {
    setAuthLoading(true);
    try {
      rememberAuthProvider("email");
      rememberAuthReturnPath();
      rememberEmailAuthHandoff();
      const redirectTo = authRedirectUrl();
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

  async function signInWithProvider(provider: Extract<Provider, "discord" | "google">) {
    setAuthLoading(true);
    try {
      rememberAuthProvider(provider);
      rememberAuthReturnPath();
      const redirectTo = authRedirectUrl();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
        },
      });
      if (error) throw error;
    } catch (error) {
      setAuthLoading(false);
      toast.error(error instanceof Error ? error.message : "Sign in failed.");
    }
  }

  function rememberAuthProvider(provider: "discord" | "email" | "google") {
    setLastAuthProvider(provider);
    try {
      window.localStorage.setItem(LAST_AUTH_PROVIDER_KEY, provider);
    } catch {
      // Ignore storage failures; auth still works without the local hint.
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

  async function deleteAccount() {
    if (!session?.access_token) {
      toast.error(
        t?.("dashboardDeleteAccountFailed") ?? "Failed to delete account. Please try again.",
      );
      return;
    }

    setDeleteLoading(true);
    try {
      await deleteCurrentAccount({ data: { accessToken: session.access_token } });
      const { error } = await supabase.auth.signOut();
      if (error) console.warn("[dashboard] local sign out after account deletion failed:", error);
      setSession(null);
      setQuota(null);
      setDeleteConfirmOpen(false);
      setDashboardView("main");
      setDashboardOpen(false);
      toast.success(t?.("dashboardAccountDeleted") ?? "Account deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : (t?.("dashboardDeleteAccountFailed") ?? "Failed to delete account. Please try again."),
      );
    } finally {
      setDeleteLoading(false);
    }
  }

  function quotaValueText(status: VerdictQuotaStatus): string {
    return `${status.remaining}/${status.limit}`;
  }

  function quotaPercent(status: VerdictQuotaStatus): number {
    if (!status.limit) return 0;
    return Math.max(0, Math.min(100, (status.remaining / status.limit) * 100));
  }

  function quotaFillClass(status: VerdictQuotaStatus): string {
    const percent = quotaPercent(status);
    if (percent <= 0) return "bg-destructive";
    if (percent <= 34) return "bg-destructive";
    if (percent <= 67) return "bg-amber-400";
    return "bg-gold";
  }

  function quotaResetText(status: VerdictQuotaStatus): string | null {
    if (status.remaining !== 0 || !status.limit || !status.resetAt) {
      return null;
    }

    const resetAt = Date.parse(status.resetAt);
    if (!Number.isFinite(resetAt)) return null;
    const remainingMs = Math.max(0, resetAt - quotaNow);
    const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const time =
      hours > 0
        ? (t?.("dashboardQuotaResetHoursMinutes", { hours, minutes }) ?? `${hours}h ${minutes}m`)
        : (t?.("dashboardQuotaResetMinutes", { minutes }) ?? `${minutes}m`);

    return t?.("dashboardQuotaResetsIn", { time }) ?? `Resets in ${time}`;
  }

  function quotaResetTimerText(status: VerdictQuotaStatus): string {
    if (!status.resetAt) {
      return t?.("dashboardQuotaResetStartsAfterFirstVerdict") ?? "Starts after your first verdict";
    }

    const resetAt = Date.parse(status.resetAt);
    if (!Number.isFinite(resetAt)) {
      return t?.("dashboardQuotaResetStartsAfterFirstVerdict") ?? "Starts after your first verdict";
    }
    const remainingMs = Math.max(0, resetAt - quotaNow);
    const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const time =
      hours > 0
        ? (t?.("dashboardQuotaResetHoursMinutes", { hours, minutes }) ?? `${hours}h ${minutes}m`)
        : (t?.("dashboardQuotaResetMinutes", { minutes }) ?? `${minutes}m`);

    return t?.("dashboardQuotaResetsIn", { time }) ?? `Resets in ${time}`;
  }

  function authProviderLabel(): string {
    const provider = session?.user.app_metadata?.provider;
    if (provider === "google") return t?.("dashboardProviderGoogle") ?? "Google";
    if (provider === "discord") return t?.("dashboardProviderDiscord") ?? "Discord";
    return t?.("dashboardProviderEmail") ?? "Email";
  }

  function providerLabel(provider: "discord" | "email" | "google"): string {
    if (provider === "google") return t?.("dashboardProviderGoogle") ?? "Google";
    if (provider === "discord") return t?.("dashboardProviderDiscord") ?? "Discord";
    return t?.("dashboardProviderEmail") ?? "Email";
  }

  function toggleOptionSection(section: string) {
    setExpandedOptionSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  const authButtonClass =
    "group inline-flex h-9 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-border bg-background/50 px-2 text-xs font-semibold text-foreground transition-all duration-300 ease-out hover:flex-[2] hover:border-gold hover:text-gold focus-visible:flex-[2] focus-visible:border-gold focus-visible:text-gold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold/50 disabled:cursor-not-allowed disabled:opacity-60";
  const authButtonLabelClass =
    "ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 group-hover:ml-2 group-hover:max-w-24 group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-24 group-focus-visible:opacity-100";
  const headerActionClass =
    "group inline-flex h-8 min-w-8 items-center justify-center overflow-hidden rounded-md border border-border bg-background/40 px-2 text-xs font-semibold text-muted-foreground transition-colors duration-300 ease-out hover:border-gold hover:text-gold focus-visible:border-gold focus-visible:text-gold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold/50 disabled:cursor-not-allowed disabled:opacity-60";
  const headerActionLabelClass =
    "ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 group-hover:ml-1.5 group-hover:max-w-20 group-hover:opacity-100 group-focus-visible:ml-1.5 group-focus-visible:max-w-20 group-focus-visible:opacity-100";
  const quotaResetHint = quota ? quotaResetText(quota) : null;
  const optionSections = [
    {
      id: "profile",
      icon: User,
      title: t?.("dashboardOptionProfileTitle") ?? "Profile",
      details:
        t?.("dashboardOptionProfileDetails", {
          status: session
            ? (t?.("dashboardSignedInWith", { provider: authProviderLabel() }) ??
              `Signed in with ${authProviderLabel()}`)
            : (t?.("dashboardAnonymousQuotaHelp") ?? "Sign in to submit objections and feedback."),
        }) ??
        (session
          ? `Account status: signed in with ${authProviderLabel()}.`
          : "Account status: not signed in."),
    },
    {
      id: "usage",
      icon: Gauge,
      title: t?.("dashboardOptionUsageTitle") ?? "Verdict usage",
      details:
        t?.("dashboardOptionUsageDetails", {
          quota: quota
            ? `${quota.remaining}/${quota.limit}`
            : (t?.("dashboardQuotaUnavailable") ?? "Verdict quota unavailable."),
        }) ?? (quota ? `${quota.remaining}/${quota.limit}` : "Verdict quota unavailable."),
    },
    {
      id: "privacy",
      icon: ShieldCheck,
      title: t?.("dashboardOptionPrivacyTitle") ?? "Privacy & data",
      details:
        t?.("dashboardOptionPrivacyDetails") ??
        "Recent searches and saved players are stored in this browser. Shared verdict links expire after 72 hours.",
    },
  ];

  if (authHandoffParkedPath) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4 text-foreground">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card/95 p-5 text-center shadow-xl">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-gold/50 bg-gold/10 text-gold">
            <Check className="h-5 w-5" />
          </div>
          <h1 className="text-base font-semibold text-foreground">
            {t?.("dashboardMagicLinkCompleteTitle") ?? "Signed in"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t?.("dashboardMagicLinkCompleteHelp") ??
              "Continue in your original tab. You can close this duplicate sign-in tab."}
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                const path = authHandoffParkedPath;
                setAuthHandoffParkedPath(null);
                restoreAuthReturnPath(path);
              }}
              className="inline-flex flex-1 items-center justify-center rounded-md border border-gold/50 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold transition-colors hover:bg-gold/20"
            >
              {t?.("dashboardMagicLinkContinueHere") ?? "Continue here"}
            </button>
            <a
              href={homeHref}
              className="inline-flex flex-1 items-center justify-center rounded-md border border-border bg-background/50 px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              {t?.("dashboardHome") ?? "Home"}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={outer}>
      <div className="fixed left-2 top-2 z-50 sm:left-3 sm:top-3">
        <button
          ref={dashboardTriggerRef}
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
            ref={dashboardPanelRef}
            role="dialog"
            aria-label={t?.("dashboardTitle") ?? "Dashboard"}
            className="mt-2 w-[min(calc(100vw-1rem),20rem)] animate-fade-in rounded-xl border border-border bg-card/95 p-3 text-left shadow-xl backdrop-blur"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              {dashboardView === "options" ? (
                <button
                  type="button"
                  onClick={() => setDashboardView("main")}
                  className={headerActionClass}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span className={headerActionLabelClass}>{t?.("dashboardBack") ?? "Back"}</span>
                </button>
              ) : (
                <a
                  href={homeHref}
                  aria-label={t?.("home") ?? "Go to Summoner's Courtroom home"}
                  className={headerActionClass}
                >
                  <Home className="h-3.5 w-3.5" />
                  <span className={headerActionLabelClass}>{t?.("dashboardHome") ?? "Home"}</span>
                </a>
              )}
              <div className="flex items-center gap-1.5">
                {session && dashboardView === "main" && (
                  <button
                    type="button"
                    className={headerActionClass}
                    aria-label={t?.("dashboardOptions") ?? "Options"}
                    onClick={() => {
                      setDashboardView("options");
                      setLanguageOpen(false);
                      setEmailLoginOpen(false);
                    }}
                  >
                    <Settings className="h-3.5 w-3.5" />
                    <span className={headerActionLabelClass}>
                      {t?.("dashboardOptions") ?? "Options"}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  aria-label={t?.("dashboardClose") ?? "Close dashboard"}
                  onClick={() => setDashboardOpen(false)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {dashboardView === "options" ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  {optionSections.map((section) => {
                    const Icon = section.icon;
                    const expanded = expandedOptionSections.has(section.id);
                    return (
                      <section
                        key={section.id}
                        className="rounded-lg border border-border bg-background/40"
                      >
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => toggleOptionSection(section.id)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                        >
                          <span className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gold">
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{section.title}</span>
                          </span>
                          <ChevronDown
                            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                              expanded ? "rotate-180" : ""
                            }`}
                          />
                        </button>
                        {expanded && (
                          <div className="border-t border-border px-3 pb-3 pt-2 animate-fade-in">
                            {section.id === "usage" ? (
                              <div className="space-y-2 text-xs">
                                {quotaLoading ? (
                                  <p className="text-muted-foreground">
                                    {t?.("dashboardQuotaLoading") ?? "Loading verdict quota..."}
                                  </p>
                                ) : quota ? (
                                  <>
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-muted-foreground">
                                        {t?.("dashboardUsageCurrentQuota") ?? "Current quota"}
                                      </span>
                                      <span className="text-right font-semibold text-gold">
                                        {quotaValueText(quota)}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-muted-foreground">
                                        {t?.("dashboardUsageResetTimer") ?? "Reset timer"}
                                      </span>
                                      <span className="text-right font-semibold text-foreground">
                                        {quotaResetTimerText(quota)}
                                      </span>
                                    </div>
                                  </>
                                ) : (
                                  <p className="text-muted-foreground">
                                    {quotaError
                                      ? `${t?.("dashboardQuotaUnavailable") ?? "Verdict quota unavailable."} ${quotaError}`
                                      : (t?.("dashboardQuotaUnavailable") ??
                                        "Verdict quota unavailable.")}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs leading-relaxed text-muted-foreground">
                                {section.details}
                              </p>
                            )}
                            {section.id === "profile" && session && (
                              <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                                {deleteConfirmOpen ? (
                                  <div className="space-y-2">
                                    <div className="flex flex-col items-center gap-2 text-center text-xs leading-relaxed text-muted-foreground">
                                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                                      <span>
                                        {t?.("dashboardDeleteAccountWarning") ??
                                          "This permanently deletes your account. Your past verdict snapshots may remain for moderation and shared-link integrity, but they will be marked as Deleted User."}
                                      </span>
                                    </div>
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        disabled={deleteLoading}
                                        onClick={deleteAccount}
                                        className="inline-flex flex-1 items-center justify-center rounded-md border border-destructive bg-destructive/15 px-2 py-1.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/25 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {t?.("dashboardConfirmDeleteAccount") ?? "Confirm delete"}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={deleteLoading}
                                        onClick={() => setDeleteConfirmOpen(false)}
                                        className="inline-flex flex-1 items-center justify-center rounded-md border border-border bg-background/50 px-2 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {t?.("dashboardCancelDeleteAccount") ?? "Cancel"}
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={deleteLoading}
                                    onClick={() => setDeleteConfirmOpen(true)}
                                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-destructive/60 bg-destructive/10 px-2 py-1.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    {t?.("dashboardDeleteAccount") ?? "Delete account"}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <section className="rounded-lg border border-border bg-background/40 p-3">
                  {session ? (
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex shrink-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gold">
                          <User className="h-3.5 w-3.5" />
                          {t?.("dashboardProfile") ?? "Profile"}
                        </div>
                        <p className="min-w-0 truncate text-xs font-semibold text-muted-foreground">
                          {t?.("dashboardSignedInWith", { provider: authProviderLabel() }) ??
                            `Signed in with ${authProviderLabel()}`}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={authLoading}
                        onClick={signOut}
                        className={`${headerActionClass} shrink-0`}
                        aria-label={t?.("dashboardSignOut") ?? "Sign out"}
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        <span className={headerActionLabelClass}>
                          {t?.("dashboardSignOut") ?? "Sign out"}
                        </span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gold">
                        <User className="h-3.5 w-3.5" />
                        {t?.("dashboardProfile") ?? "Profile"}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={authLoading}
                          onClick={() => signInWithProvider("google")}
                          className={authButtonClass}
                          aria-label={t?.("dashboardContinueGoogle") ?? "Google"}
                        >
                          <GoogleIcon className="h-4 w-4 shrink-0" />
                          <span className={authButtonLabelClass}>
                            {t?.("dashboardContinueGoogle") ?? "Google"}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={authLoading}
                          onClick={() => signInWithProvider("discord")}
                          className={authButtonClass}
                          aria-label={t?.("dashboardContinueDiscord") ?? "Discord"}
                        >
                          <DiscordIcon className="h-4 w-4 shrink-0 text-[#5865F2]" />
                          <span className={authButtonLabelClass}>
                            {t?.("dashboardContinueDiscord") ?? "Discord"}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={authLoading}
                          onClick={() => setEmailLoginOpen((open) => !open)}
                          className={authButtonClass}
                          aria-expanded={emailLoginOpen}
                          aria-label={t?.("dashboardProviderEmail") ?? "Email"}
                        >
                          <Mail className="h-4 w-4 shrink-0" />
                          <span className={authButtonLabelClass}>
                            {t?.("dashboardProviderEmail") ?? "Email"}
                          </span>
                        </button>
                      </div>
                      {lastAuthProvider && (
                        <p className="text-center text-[10px] font-medium text-muted-foreground">
                          {t?.("dashboardLastLoginMethod", {
                            provider: providerLabel(lastAuthProvider),
                          }) ?? `Most recent login: ${providerLabel(lastAuthProvider)}`}
                        </p>
                      )}
                      {emailLoginOpen && (
                        <div className="grid gap-2 animate-fade-in">
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
                            {t?.("dashboardSendMagicLink") ?? "Register"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                <section className="rounded-lg border border-border bg-background/40 p-3">
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wider text-gold">
                    <div className="flex min-w-0 items-center gap-2">
                      <Gauge className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {t?.("dashboardQuotaTitle") ?? "Verdict quota"}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-center text-xs text-muted-foreground">
                      {quotaLoading
                        ? (t?.("dashboardQuotaLoading") ?? "Loading verdict quota...")
                        : quota
                          ? (t?.("dashboardQuota", {
                              remaining: quota.remaining,
                              limit: quota.limit,
                            }) ?? `${quota.remaining}/${quota.limit} verdicts available`)
                          : quotaError
                            ? `${t?.("dashboardQuotaUnavailable") ?? "Verdict quota unavailable."} ${quotaError}`
                            : (t?.("dashboardQuotaUnavailable") ?? "Verdict quota unavailable.")}
                    </p>
                    <div
                      role="meter"
                      aria-valuemin={0}
                      aria-valuemax={quota?.limit ?? 100}
                      aria-valuenow={quota?.remaining ?? 0}
                      aria-valuetext={
                        quota
                          ? (t?.("dashboardQuota", {
                              remaining: quota.remaining,
                              limit: quota.limit,
                            }) ?? `${quota.remaining}/${quota.limit} verdicts available`)
                          : undefined
                      }
                      className="h-2.5 overflow-hidden rounded-full border border-border bg-background/70"
                    >
                      <div
                        className={`h-full rounded-full transition-all duration-500 ease-out ${
                          quotaLoading
                            ? "w-1/2 animate-pulse bg-muted-foreground/30"
                            : quota
                              ? quotaFillClass(quota)
                              : "bg-muted-foreground/20"
                        }`}
                        style={{
                          width: quotaLoading ? "45%" : quota ? `${quotaPercent(quota)}%` : "0%",
                        }}
                      />
                    </div>
                    {quotaResetHint && (
                      <p className="text-[10px] font-medium text-muted-foreground">
                        {quotaResetHint}
                      </p>
                    )}
                  </div>
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
            )}
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
        <p className="mx-auto max-w-5xl text-[10px] sm:text-xs">{RIOT_DISCLAIMER}</p>
      </footer>
    </div>
  );
}
