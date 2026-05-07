import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { RegionalRouting } from "@/server/riot";

type WindowItem = Record<string, unknown> & {
  kind: "frame" | "event";
  timestamp: string;
};

type TimelineFrame = {
  timestamp?: unknown;
  participantFrames?: Record<string, Record<string, unknown>>;
  events?: Array<Record<string, unknown>>;
};

type TimelinePayload = {
  info?: {
    frames?: TimelineFrame[];
  };
};

type MatchPayload = {
  info?: {
    participants?: Array<{
      participantId?: number;
      championName?: string;
    }>;
  };
};

const TimelineWindowInputSchema = z.object({
  matchId: z.string().min(3),
  userPuuid: z.string().min(1),
  routingRegion: z.enum(["americas", "europe", "asia", "sea"]).optional(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
});

const PLATFORM_TO_REGIONAL: Record<string, RegionalRouting> = {
  br1: "americas",
  la1: "americas",
  la2: "americas",
  na1: "americas",
  euw1: "europe",
  eun1: "europe",
  tr1: "europe",
  ru: "europe",
  me1: "europe",
  jp1: "asia",
  kr: "asia",
  tw2: "asia",
  vn2: "asia",
  th2: "asia",
  ph2: "asia",
  sg2: "asia",
  oc1: "sea",
};

const MIN_WINDOW_MS = 60_000;
const MAX_WINDOW_MS = 5 * 60_000;

function apiKey(): string {
  const key = process.env.RIOT_API_KEY;
  if (!key) throw new Error("RIOT_API_KEY is not configured on the server.");
  return key;
}

function inferRouting(matchId: string, override?: RegionalRouting): RegionalRouting {
  if (override) return override;
  const platform = matchId.split("_", 1)[0]?.toLowerCase();
  const routing = PLATFORM_TO_REGIONAL[platform];
  if (!routing) {
    throw new Error("Unknown matchId platform. Pass routingRegion explicitly.");
  }
  return routing;
}

async function riotGet<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "X-Riot-Token": apiKey() },
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("Riot match not found. Check match id and region.");
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("Riot API key rejected. Check RIOT_API_KEY.");
    }
    if (res.status === 429) {
      throw new Error("Riot rate limit hit. Try again later.");
    }
    throw new Error(`Riot HTTP ${res.status}`);
  }

  return (await res.json()) as T;
}

function toTimestamp(value: unknown): number | null {
  if (typeof value === "boolean") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function formatGameTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}]`;
}

function buildChampionLookup(match: MatchPayload): Record<number, string> {
  const lookup: Record<number, string> = {};
  for (const participant of match.info?.participants ?? []) {
    if (
      typeof participant.participantId === "number" &&
      typeof participant.championName === "string"
    ) {
      lookup[participant.participantId] = participant.championName;
    }
  }
  return lookup;
}

function labelParticipant(value: unknown, champions: Record<number, string>): unknown {
  const id = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(id)) return value;
  return champions[id] ?? value;
}

function labelTeam(value: unknown): unknown {
  const id = typeof value === "number" ? value : Number(value);
  if (id === 100) return "Blue";
  if (id === 200) return "Red";
  return value;
}

function humanizeIds(node: unknown, champions: Record<number, string>): unknown {
  if (Array.isArray(node)) return node.map((item) => humanizeIds(item, champions));
  if (!node || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "participantId" ||
      key === "killerId" ||
      key === "victimId" ||
      key === "creatorId"
    ) {
      out[key] = labelParticipant(value, champions);
    } else if (key === "assistingParticipantIds" && Array.isArray(value)) {
      out[key] = value.map((id) => labelParticipant(id, champions));
    } else if (key === "teamId" || key === "killerTeamId" || key === "victimTeamId") {
      out[key] = labelTeam(value);
    } else if (key === "timestamp") {
      const ts = toTimestamp(value);
      out[key] = ts == null ? value : formatGameTime(ts);
    } else {
      out[key] = humanizeIds(value, champions);
    }
  }
  return out;
}

function frameItems(
  frame: TimelineFrame,
  timestamp: number,
  champions: Record<number, string>,
): WindowItem[] {
  const pframes = frame.participantFrames;
  if (!pframes) return [];

  return Object.entries(pframes)
    .map(([participantId, data]) => ({
      kind: "frame" as const,
      timestampMs: timestamp,
      timestamp: formatGameTime(timestamp),
      participantId: labelParticipant(participantId, champions),
      frame: humanizeIds(data, champions),
    }))
    .sort((a, b) => Number(a.participantId) - Number(b.participantId));
}

function closestPriorFrame(frames: TimelineFrame[], startMs: number): TimelineFrame | null {
  let best: TimelineFrame | null = null;
  let bestTs = -1;
  for (const frame of frames) {
    const ts = toTimestamp(frame.timestamp);
    if (ts == null || ts >= startMs || ts <= bestTs) continue;
    best = frame;
    bestTs = ts;
  }
  return best;
}

function extractWindow(
  timeline: TimelinePayload,
  startMs: number,
  endMs: number,
  champions: Record<number, string>,
): WindowItem[] {
  const frames = timeline.info?.frames;
  if (!Array.isArray(frames)) throw new Error("Riot timeline response is missing frames.");

  const items: Array<WindowItem & { timestampMs: number }> = [];

  for (const frame of frames) {
    const frameTs = toTimestamp(frame.timestamp);
    if (frameTs != null && frameTs >= startMs && frameTs <= endMs) {
      items.push(...frameItems(frame, frameTs, champions));
    }

    for (const event of frame.events ?? []) {
      const eventTs = toTimestamp(event.timestamp);
      if (eventTs == null || eventTs < startMs || eventTs > endMs) continue;
      items.push({
        kind: "event",
        timestampMs: eventTs,
        ...(humanizeIds(event, champions) as Record<string, unknown>),
        timestamp: formatGameTime(eventTs),
      });
    }
  }

  items.sort((a, b) => a.timestampMs - b.timestampMs);

  if (items.length > 0 && items[0].kind !== "frame") {
    const prior = closestPriorFrame(frames, startMs);
    const priorTs = prior ? toTimestamp(prior.timestamp) : null;
    if (prior && priorTs != null) {
      items.unshift(...frameItems(prior, priorTs, champions));
      items.sort((a, b) => a.timestampMs - b.timestampMs);
    }
  }

  return items.map(({ timestampMs: _timestampMs, ...item }) => item);
}

export const getTimelineWindow = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => TimelineWindowInputSchema.parse(input))
  .handler(async ({ data }) => {
    const span = data.endMs - data.startMs;
    if (span < MIN_WINDOW_MS) throw new Error("Window must be at least 60 seconds.");
    if (span > MAX_WINDOW_MS) throw new Error("Window must be at most 5 minutes.");

    const routing = inferRouting(data.matchId, data.routingRegion);
    const base = `https://${routing}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(
      data.matchId,
    )}`;

    const [match, timeline] = await Promise.all([
      riotGet<MatchPayload>(base),
      riotGet<TimelinePayload>(`${base}/timeline`),
    ]);
    const champions = buildChampionLookup(match);
    const items = extractWindow(timeline, data.startMs, data.endMs, champions);

    return {
      window: {
        start: formatGameTime(data.startMs),
        end: formatGameTime(data.endMs),
      },
      count: items.length,
      items,
    };
  });
