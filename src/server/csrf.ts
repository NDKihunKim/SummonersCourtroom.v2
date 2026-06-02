import { getRequest } from "@tanstack/react-start/server";

/**
 * Validate that the request Origin header matches the expected origin.
 * This prevents cross-site request forgery (CSRF) on state-changing endpoints.
 *
 * Read-only endpoints (GET, search, display) are low-risk and do not call this.
 *
 * Allowed origins:
 *   - The production origin (SUMMONERS_COURTROOM_ORIGIN env var)
 *   - localhost / 127.0.0.1 during local development
 */
export function assertSameOrigin() {
  // In non-request contexts (build time, tests), skip validation.
  let requestHost: string | null = null;
  try {
    const request = getRequest();
    requestHost = request.headers.get("host") ?? null;
  } catch {
    return;
  }

  const host = requestHost;
  if (!host) return; // no host header — skip (e.g. cron triggers)

  const originHeader = getOriginHeader();
  if (!originHeader) {
    // Missing Origin is suspicious but not always an attack.
    // Server-to-server calls, curl, and some mobile apps omit Origin.
    // We allow the request but log it so we can monitor.
    console.warn("[csrf] missing Origin header on state-changing request", { host });
    return;
  }

  const origin = normalizeOrigin(originHeader);
  if (!origin) {
    throw new Error("Invalid request origin.");
  }

  // Local development
  if (
    origin.hostname === "localhost" ||
    origin.hostname === "127.0.0.1" ||
    origin.hostname.endsWith(".localhost")
  ) {
    return;
  }

  // Production: accept the canonical origin or any workers.dev preview URL
  const allowedHostnames = [host, `${host.split(":")[0]}`];
  if (origin.hostname === host || allowedHostnames.includes(origin.hostname)) {
    return;
  }

  // Accept workers.dev preview URLs
  if (
    host.endsWith(".workers.dev") &&
    (origin.hostname === host || origin.hostname.endsWith(".workers.dev"))
  ) {
    return;
  }

  // Accept the configured production origin if set
  const configuredOrigin = typeof process !== "undefined" ? process.env.SUMMONERS_COURTROOM_ORIGIN : undefined;
  if (configuredOrigin) {
    try {
      const configured = normalizeOrigin(configuredOrigin);
      if (configured && origin.hostname === configured.hostname) {
        return;
      }
    } catch {
      // configured origin is malformed — ignore
    }
  }

  throw new Error("Invalid request origin.");
}

function getOriginHeader(): string | null {
  try {
    const request = getRequest();
    return (
      request.headers.get("origin") ?? null
    );
  } catch {
    return null;
  }
}

function normalizeOrigin(raw: string): URL | null {
  try {
    const url = new URL(raw);
    // Origin must have a protocol (http or https)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}
