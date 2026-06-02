import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Match, Participant } from "@/lib/match-types";
import {
  REGIONAL_ROUTINGS,
  fetchMatch,
  formatDuration,
  isCustomGameQueue,
  listMatchIds,
  platformToRegional,
  queueName,
  relativeTime,
  resolveRiotId,
  spellName,
  type RegionalRouting,
  type RiotMatch,
  type RiotMatchParticipant,
} from "@/server/riot";

const InputSchema = z.object({
  gameName: z.string().min(1).max(32),
  tagLine: z.string().min(2).max(8),
  region: z.enum(["americas", "europe", "asia", "sea"]),
  count: z.number().int().min(1).max(20).optional(),
});

export type GetMatchHistoryResult = {
  account: { gameName: string; tagLine: string; puuid: string };
  matches: Match[];
};

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 1000;
}

function displayName(p: RiotMatchParticipant): string {
  if (p.riotIdGameName && p.riotIdTagline) return `${p.riotIdGameName}#${p.riotIdTagline}`;
  if (p.riotIdGameName) return p.riotIdGameName;
  return p.summonerName || "Unknown";
}

function toParticipant(p: RiotMatchParticipant): Participant {
  return {
    champion: p.championName,
    summoner: displayName(p),
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    cs: p.totalMinionsKilled + p.neutralMinionsKilled,
    items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5],
    trinket: p.item6 ?? 0,
    spells: [spellName(p.summoner1Id), spellName(p.summoner2Id)],
    runes: extractRunes(p),
    puuid: p.puuid,
    // Carry side + lane through to the client so RosterColumns can sort
    // each column by canonical role order (TOP → JUNGLE → MIDDLE → BOTTOM
    // → UTILITY). teamId is narrowed to Riot's two valid sides; anything
    // unexpected falls through as undefined and the row sorts as "unknown".
    teamId: p.teamId === 100 || p.teamId === 200 ? p.teamId : undefined,
    teamPosition: p.teamPosition,
  };
}

/**
 * Extract the keystone perk + secondary tree id from a participant's perks
 * payload. Returns undefined when the match doesn't carry runes (some non-SR
 * queues, remakes) so the UI can render empty placeholders.
 */
function extractRunes(
  p: RiotMatchParticipant,
): { keystoneId: number; secondaryStyleId: number } | undefined {
  const styles = p.perks?.styles;
  if (!styles || styles.length === 0) return undefined;
  const primary = styles.find((s) => s.description === "primaryStyle") ?? styles[0];
  const sub = styles.find((s) => s.description === "subStyle") ?? styles[1];
  const keystoneId = primary?.selections?.[0]?.perk;
  const secondaryStyleId = sub?.style;
  if (!keystoneId || !secondaryStyleId) return undefined;
  return { keystoneId, secondaryStyleId };
}

function normaliseMatch(
  raw: RiotMatch,
  userPuuid: string,
  fallbackRouting: RegionalRouting,
): Match | null {
  if (isCustomGameQueue(raw.info.queueId)) return null;

  const me = raw.info.participants.find((p) => p.puuid === userPuuid);
  if (!me) return null;

  const allies = raw.info.participants.filter(
    (p) => p.teamId === me.teamId && p.puuid !== userPuuid,
  );
  const enemies = raw.info.participants.filter((p) => p.teamId !== me.teamId);
  const playedAtMs = raw.info.gameEndTimestamp ?? raw.info.gameCreation;
  const routing = platformToRegional(raw.info.platformId) ?? fallbackRouting;

  return {
    id: raw.metadata.matchId,
    queue: queueName(raw.info.queueId),
    result: me.win ? "Victory" : "Defeat",
    duration: formatDuration(raw.info.gameDuration),
    playedAtMs,
    playedAt: relativeTime(playedAtMs),
    champion: me.championName,
    championIconSeed: hashSeed(me.championName + me.puuid),
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    cs: me.totalMinionsKilled + me.neutralMinionsKilled,
    gold: me.goldEarned,
    damage: me.totalDamageDealtToChampions,
    vision: me.visionScore,
    // Keep positional empties (0) so the inventory grid stays aligned.
    items: [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5],
    trinket: me.item6 ?? 0,
    spells: [spellName(me.summoner1Id), spellName(me.summoner2Id)],
    runes: extractRunes(me),
    team: allies.map(toParticipant),
    enemies: enemies.map(toParticipant),
    riotMatchId: raw.metadata.matchId,
    userPuuid,
    routingRegion: routing,
    // Surface the viewer's own side + role at the top level. The viewer is
    // not in `team` / `enemies`, so without these the client has no way to
    // role-sort "you" into the Allies column (they'd always sort as
    // unknown and land at the bottom).
    userTeamId: me.teamId === 100 || me.teamId === 200 ? me.teamId : undefined,
    userTeamPosition: me.teamPosition,
  };
}

export const getMatchHistory = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<GetMatchHistoryResult> => {
    const routing: RegionalRouting = data.region;
    if (!REGIONAL_ROUTINGS.includes(routing)) {
      throw new Error(`Invalid region ${data.region}`);
    }

    const account = await resolveRiotId(data.gameName, data.tagLine, routing);
    const matchIds = await listMatchIds(account.puuid, routing, data.count ?? 10);

    // Fetch all matches in parallel; tolerate individual failures so one bad
    // match doesn't blank the whole history.
    const settled = await Promise.allSettled(matchIds.map((id) => fetchMatch(id, routing)));

    const matches: Match[] = [];
    for (const s of settled) {
      if (s.status !== "fulfilled") {
        console.error("match fetch failed:", s.reason);
        continue;
      }
      const m = normaliseMatch(s.value, account.puuid, routing);
      if (m) matches.push(m);
    }

    return {
      account: { gameName: account.gameName, tagLine: account.tagLine, puuid: account.puuid },
      matches,
    };
  });
