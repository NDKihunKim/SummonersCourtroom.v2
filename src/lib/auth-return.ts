const AUTH_RETURN_TO_KEY = "summoners-courtroom:auth-return-to";
const AUTH_EMAIL_HANDOFF_KEY = "summoners-courtroom:email-auth-handoff";
const AUTH_EMAIL_HANDOFF_COMPLETE_KEY = "summoners-courtroom:email-auth-handoff-complete";
const AUTH_TAB_ID_KEY = "summoners-courtroom:auth-tab-id";
const AUTH_RETURN_TTL_MS = 30 * 60 * 1000;

type StoredAuthReturn = {
  path: string;
  createdAt: number;
};

type StoredEmailAuthHandoff = StoredAuthReturn & {
  requestId: string;
  sourceTabId: string;
};

type CompletedEmailAuthHandoff = StoredEmailAuthHandoff & {
  completedAt: number;
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

function readJson<T>(key: string, storage: Storage): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function validStoredReturn(payload: Partial<StoredAuthReturn> | null): payload is StoredAuthReturn {
  return (
    !!payload &&
    typeof payload.path === "string" &&
    typeof payload.createdAt === "number" &&
    Date.now() - payload.createdAt <= AUTH_RETURN_TTL_MS
  );
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getAuthTabId(): string {
  if (typeof window === "undefined") return "server";

  try {
    const existing = window.sessionStorage.getItem(AUTH_TAB_ID_KEY);
    if (existing) return existing;

    const next = createId();
    window.sessionStorage.setItem(AUTH_TAB_ID_KEY, next);
    return next;
  } catch {
    return createId();
  }
}

export function rememberAuthReturnPath(path = currentAuthReturnPath()) {
  if (typeof window === "undefined") return;
  const safePath = sanitizeAuthReturnPath(path);
  const payload: StoredAuthReturn = {
    path: safePath,
    createdAt: Date.now(),
  };
  const serialized = JSON.stringify(payload);

  try {
    window.sessionStorage.setItem(AUTH_RETURN_TO_KEY, serialized);
  } catch {
    // Auth still works if browser storage is unavailable.
  }

  try {
    window.localStorage.setItem(AUTH_RETURN_TO_KEY, serialized);
  } catch {
    // Auth still works if browser storage is unavailable.
  }
}

export function rememberEmailAuthHandoff(path = currentAuthReturnPath()) {
  if (typeof window === "undefined") return null;

  const payload: StoredEmailAuthHandoff = {
    path: sanitizeAuthReturnPath(path),
    createdAt: Date.now(),
    requestId: createId(),
    sourceTabId: getAuthTabId(),
  };

  try {
    window.localStorage.setItem(AUTH_EMAIL_HANDOFF_KEY, JSON.stringify(payload));
  } catch {
    return null;
  }

  return payload;
}

function readEmailAuthHandoff(): StoredEmailAuthHandoff | null {
  if (typeof window === "undefined") return null;
  const payload = readJson<Partial<StoredEmailAuthHandoff>>(
    AUTH_EMAIL_HANDOFF_KEY,
    window.localStorage,
  );
  if (
    !validStoredReturn(payload) ||
    typeof payload.requestId !== "string" ||
    typeof payload.sourceTabId !== "string"
  ) {
    return null;
  }

  return {
    path: sanitizeAuthReturnPath(payload.path),
    createdAt: payload.createdAt,
    requestId: payload.requestId,
    sourceTabId: payload.sourceTabId,
  };
}

export function completeEmailAuthHandoff(): { shouldPark: boolean; path: string } | null {
  if (typeof window === "undefined") return null;

  const handoff = readEmailAuthHandoff();
  if (!handoff) return null;
  const currentTabId = getAuthTabId();
  if (handoff.sourceTabId === currentTabId) {
    return {
      shouldPark: false,
      path: handoff.path,
    };
  }

  const completed: CompletedEmailAuthHandoff = {
    ...handoff,
    completedAt: Date.now(),
  };

  try {
    window.localStorage.setItem(AUTH_EMAIL_HANDOFF_COMPLETE_KEY, JSON.stringify(completed));
    window.localStorage.removeItem(AUTH_EMAIL_HANDOFF_KEY);
  } catch {
    // The signed-in callback tab can still continue normally if the broadcast fails.
  }

  return {
    shouldPark: true,
    path: handoff.path,
  };
}

export function listenForEmailAuthHandoff(onComplete: (path: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const tabId = getAuthTabId();

  function onStorage(event: StorageEvent) {
    if (event.key !== AUTH_EMAIL_HANDOFF_COMPLETE_KEY || !event.newValue) return;

    try {
      const payload = JSON.parse(event.newValue) as Partial<CompletedEmailAuthHandoff>;
      if (
        !validStoredReturn(payload) ||
        typeof payload.requestId !== "string" ||
        typeof payload.sourceTabId !== "string" ||
        typeof payload.completedAt !== "number" ||
        payload.sourceTabId !== tabId
      ) {
        return;
      }

      onComplete(sanitizeAuthReturnPath(payload.path));
    } catch {
      // Ignore malformed cross-tab notifications.
    }
  }

  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export function consumeAuthReturnPath(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const raw =
      window.sessionStorage.getItem(AUTH_RETURN_TO_KEY) ??
      window.localStorage.getItem(AUTH_RETURN_TO_KEY);
    window.sessionStorage.removeItem(AUTH_RETURN_TO_KEY);
    window.localStorage.removeItem(AUTH_RETURN_TO_KEY);
    if (!raw) return null;

    const payload = JSON.parse(raw) as Partial<StoredAuthReturn>;
    if (!validStoredReturn(payload)) return null;

    return sanitizeAuthReturnPath(payload.path);
  } catch {
    return null;
  }
}
