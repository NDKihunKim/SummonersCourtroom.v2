import type { Shard } from "@/lib/regions";

/**
 * Build the same-origin dedicated profile URL used for shareable player links.
 */
export function buildPlayerProfileUrl(shard: Shard, gameName: string, tagLine: string): string {
  return `/summoner/${encodeURIComponent(shard)}/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
}
