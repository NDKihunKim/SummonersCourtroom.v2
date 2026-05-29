export const MIN_WINDOW_MS = 5 * 60_000; // 5 minutes
export const MAX_WINDOW_MS = 10 * 60_000; // 10 minutes

export type TimeRange = [number, number];

/** Format ms as "m:ss" (LoL-style; hours unrealistic for a single match). */
export function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
