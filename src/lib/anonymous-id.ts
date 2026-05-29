const STORAGE_KEY = "summoners-courtroom:anonymous-id";

function fallbackId(): string {
  return `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function getAnonymousId(): string {
  if (typeof window === "undefined") return fallbackId();

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;

    const next =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : fallbackId();
    window.localStorage.setItem(STORAGE_KEY, next);
    return next;
  } catch {
    return fallbackId();
  }
}
