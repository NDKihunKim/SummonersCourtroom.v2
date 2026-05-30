const AUTH_RETURN_TO_KEY = "summoners-courtroom:auth-return-to";
const AUTH_RETURN_TTL_MS = 30 * 60 * 1000;

type StoredAuthReturn = {
  path: string;
  createdAt: number;
};

function hasUnsafePathPrefix(value: string) {
  if (value.startsWith("//") || value.startsWith("\\")) return true;
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export function sanitizeAuthReturnPath(value: string | null | undefined): string {
  if (!value || hasUnsafePathPrefix(value)) return "/";
  if (!value.startsWith("/")) return "/";

  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://summcourt.com";
    const url = new URL(value, base);
    if (typeof window !== "undefined" && url.origin !== window.location.origin) return "/";
    if (url.pathname.startsWith("//") || hasUnsafePathPrefix(url.pathname)) return "/";
    return `${url.pathname}${url.search}${url.hash}` || "/";
  } catch {
    return "/";
  }
}

export function currentAuthReturnPath(): string {
  if (typeof window === "undefined") return "/";
  return sanitizeAuthReturnPath(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
}

export function authRedirectUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URL(currentAuthReturnPath(), window.location.origin).toString();
}

export function rememberAuthReturnPath(path = currentAuthReturnPath()) {
  if (typeof window === "undefined") return;
  const safePath = sanitizeAuthReturnPath(path);
  const payload: StoredAuthReturn = {
    path: safePath,
    createdAt: Date.now(),
  };

  try {
    window.sessionStorage.setItem(AUTH_RETURN_TO_KEY, JSON.stringify(payload));
  } catch {
    // Auth still works if browser storage is unavailable.
  }
}

export function consumeAuthReturnPath(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(AUTH_RETURN_TO_KEY);
    window.sessionStorage.removeItem(AUTH_RETURN_TO_KEY);
    if (!raw) return null;

    const payload = JSON.parse(raw) as Partial<StoredAuthReturn>;
    if (
      typeof payload.createdAt !== "number" ||
      Date.now() - payload.createdAt > AUTH_RETURN_TTL_MS
    ) {
      return null;
    }

    return sanitizeAuthReturnPath(payload.path);
  } catch {
    return null;
  }
}
