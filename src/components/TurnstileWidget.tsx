import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          theme?: "auto" | "light" | "dark";
          size?: "normal" | "compact" | "flexible" | "invisible";
          execution?: "render" | "execute";
          appearance?: "always" | "execute" | "interaction-only";
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      execute: (widgetId?: string) => void;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

export type TurnstileHandle = {
  execute: () => Promise<string | undefined>;
  reset: () => void;
};

let turnstileScriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Turnstile.")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Turnstile."));
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

export const TurnstileWidget = forwardRef<TurnstileHandle, { siteKey?: string; resetKey?: number }>(
  function TurnstileWidget({ siteKey, resetKey = 0 }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const pendingRef = useRef<{
      resolve: (token: string | undefined) => void;
      reject: (error: Error) => void;
    } | null>(null);

    function settleToken(token: string | undefined) {
      pendingRef.current?.resolve(token);
      pendingRef.current = null;
    }

    function rejectToken(message: string) {
      pendingRef.current?.reject(new Error(message));
      pendingRef.current = null;
    }

    function renderWidget() {
      if (!siteKey || !containerRef.current || !window.turnstile || widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: "dark",
        size: "invisible",
        execution: "execute",
        appearance: "execute",
        callback: settleToken,
        "expired-callback": () => rejectToken("Human verification expired. Please try again."),
        "error-callback": () => rejectToken("Human verification failed. Please try again."),
      });
    }

    useEffect(() => {
      if (!siteKey || !containerRef.current) return;
      let cancelled = false;

      loadTurnstileScript()
        .then(() => {
          if (!cancelled) renderWidget();
        })
        .catch(() => rejectToken("Human verification failed to load. Please try again."));

      return () => {
        cancelled = true;
        pendingRef.current = null;
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
      };
    }, [siteKey]);

    useEffect(() => {
      if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
    }, [resetKey]);

    useImperativeHandle(
      ref,
      () => ({
        execute: async () => {
          if (!siteKey) return undefined;
          await loadTurnstileScript();
          renderWidget();
          if (!window.turnstile || !widgetIdRef.current) {
            throw new Error("Human verification is not ready. Please try again.");
          }

          if (pendingRef.current) {
            throw new Error("Human verification is already running. Please wait.");
          }

          return new Promise<string | undefined>((resolve, reject) => {
            pendingRef.current = { resolve, reject };
            window.turnstile?.execute(widgetIdRef.current ?? undefined);
          });
        },
        reset: () => {
          pendingRef.current = null;
          if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
        },
      }),
      [siteKey],
    );

    if (!siteKey) return null;

    return <div ref={containerRef} className="sr-only" aria-hidden="true" />;
  },
);
