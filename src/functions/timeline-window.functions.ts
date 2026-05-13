import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import type { RegionalRouting } from "@/server/riot";
import { assertRateLimit } from "@/server/request-rate-limit";

type WindowItem = Record<string, unknown> & {
  kind: "frame" | "event";
  timestamp: string;
};

type OutputWindowItem = Record<string, unknown>;

type InternalWindowItem = WindowItem & {
  timestampMs: number;
  participantRawId?: number;
  involvedRawIds?: number[];
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
      puuid?: string;
      teamId?: number;
      teamPosition?: string;
      riotIdGameName?: string;
      riotIdTagline?: string;
      summonerName?: string;
    }>;
  };
};

type ParticipantInfo = {
  participantId: number;
  championName: string;
  label: string;
  puuid?: string;
  teamId?: number;
  teamPosition?: string;
};

type SubjectInfo = {
  key: "Subject A" | "Subject B";
  participant?: ParticipantInfo;
  fallbackChampion?: string;
};

type SubjectInput = {
  champion?: string;
  puuid?: string;
};

const TimelineWindowInputSchema = z.object({
  matchId: z.string().min(3),
  userPuuid: z.string().min(1),
  routingRegion: z.enum(["americas", "europe", "asia", "sea"]).optional(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  subjects: z
    .object({
      a: z.object({ champion: z.string().optional(), puuid: z.string().optional() }).optional(),
      b: z.object({ champion: z.string().optional(), puuid: z.string().optional() }).optional(),
    })
    .optional(),
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
const ONE_MINUTE_MS = 60_000;

function assertContextInspectionAllowed() {
  if (import.meta.env.DEV) return;

  const expectedToken = process.env.ADMIN_CONTEXT_TOKEN;
  const request = getRequest();
  const providedToken = request.headers.get("x-admin-context-token");

  if (expectedToken && providedToken === expectedToken) return;
  throw new Error("Context inspection is not available in production.");
}

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
      throw new Error("Riot API access is currently unavailable. Please try again later.");
    }
    if (res.status === 429) {
      throw new Error("Riot rate limit reached. Please wait a minute and try again.");
    }
    throw new Error("Riot service error. Please try again later.");
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

function normalizeChampion(value?: string): string {
  return (value ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function roleLabel(value?: string): string {
  const normalized = (value ?? "").toUpperCase();
  if (normalized === "TOP") return "Top";
  if (normalized === "JUNGLE") return "Jungle";
  if (normalized === "MIDDLE") return "Mid";
  if (normalized === "BOTTOM") return "Bot";
  if (normalized === "UTILITY") return "Support";
  return "Unknown role";
}

function teamName(teamId?: number): string {
  if (teamId === 100) return "Blue";
  if (teamId === 200) return "Red";
  return "Unknown side";
}

function buildParticipants(match: MatchPayload): ParticipantInfo[] {
  return (match.info?.participants ?? [])
    .filter(
      (participant) =>
        typeof participant.participantId === "number" &&
        typeof participant.championName === "string",
    )
    .map((participant) => {
      const role = roleLabel(participant.teamPosition);
      return {
        participantId: participant.participantId as number,
        championName: participant.championName as string,
        label: `${participant.championName} ${role}`,
        puuid: participant.puuid,
        teamId: participant.teamId,
        teamPosition: participant.teamPosition,
      };
    });
}

function findSubject(
  participants: ParticipantInfo[],
  input?: SubjectInput,
): ParticipantInfo | undefined {
  if (!input) return undefined;
  if (input.puuid) {
    const byPuuid = participants.find((participant) => participant.puuid === input.puuid);
    if (byPuuid) return byPuuid;
  }

  const champion = normalizeChampion(input.champion);
  if (!champion) return undefined;
  return participants.find(
    (participant) => normalizeChampion(participant.championName) === champion,
  );
}

function subjectLabel(subject: SubjectInfo): string {
  if (subject.participant) {
    return `${subject.participant.label} (${teamName(subject.participant.teamId)})`;
  }
  return subject.fallbackChampion
    ? `${subject.fallbackChampion} (unmatched participant)`
    : "Unknown subject";
}

function rawParticipantId(value: unknown): number | undefined {
  const id = typeof value === "number" ? value : Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function eventInvolvedIds(event: Record<string, unknown>): number[] {
  const ids = new Set<number>();
  for (const key of ["participantId", "killerId", "victimId", "creatorId"]) {
    const id = rawParticipantId(event[key]);
    if (id) ids.add(id);
  }
  const assisting = event.assistingParticipantIds;
  if (Array.isArray(assisting)) {
    for (const id of assisting) {
      const rawId = rawParticipantId(id);
      if (rawId) ids.add(rawId);
    }
  }
  return [...ids];
}

function eventType(item: WindowItem): string {
  return typeof item.type === "string" ? item.type : "EVENT";
}

function isRelevantEvent(item: InternalWindowItem, subjectIds: Set<number>): boolean {
  if (item.kind !== "event") return false;
  if ((item.involvedRawIds ?? []).some((id) => subjectIds.has(id))) return true;

  const relevantTypes = new Set([
    "CHAMPION_KILL",
    "CHAMPION_SPECIAL_KILL",
    "ELITE_MONSTER_KILL",
    "BUILDING_KILL",
    "TURRET_PLATE_DESTROYED",
    "WARD_PLACED",
    "WARD_KILL",
    "RECALL",
    "DRAGON_SOUL_GIVEN",
    "GAME_END",
  ]);
  return relevantTypes.has(eventType(item));
}

function summarizeEvent(item: InternalWindowItem): string {
  const type = eventType(item);
  if (type === "CHAMPION_KILL") {
    const victim = String(item.victimId ?? "unknown victim");
    const killer = String(item.killerId ?? "unknown killer");
    const assists = Array.isArray(item.assistingParticipantIds)
      ? `; assists: ${item.assistingParticipantIds.join(", ")}`
      : "";
    return `${item.timestamp} death: ${victim} killed by ${killer}${assists}.`;
  }
  if (type === "ELITE_MONSTER_KILL") {
    return `${item.timestamp} objective: ${String(item.monsterType ?? "elite monster")} taken by ${String(
      item.killerId ?? item.killerTeamId ?? "unknown",
    )}.`;
  }
  if (type === "BUILDING_KILL" || type === "TURRET_PLATE_DESTROYED") {
    return `${item.timestamp} structure: ${String(item.buildingType ?? type)} for ${String(
      item.teamId ?? item.killerTeamId ?? "unknown team",
    )}.`;
  }
  if (type === "WARD_PLACED" || type === "WARD_KILL") {
    return `${item.timestamp} vision: ${type.replace("_", " ").toLowerCase()} by ${String(
      item.creatorId ?? item.killerId ?? "unknown",
    )}.`;
  }
  if (type === "RECALL") {
    return `${item.timestamp} recall: ${String(item.participantId ?? "unknown participant")}.`;
  }
  return `${item.timestamp} ${type}.`;
}

function framePosition(item: InternalWindowItem): string | null {
  const position = frameCoords(item);
  if (!position) return null;
  return `position (${position.x}, ${position.y})`;
}

function frameCoords(item: InternalWindowItem): { x: number; y: number } | null {
  const frame = item.frame;
  if (!frame || typeof frame !== "object") return null;
  const position = (frame as Record<string, unknown>).position;
  if (!position || typeof position !== "object") return null;
  const x = (position as Record<string, unknown>).x;
  const y = (position as Record<string, unknown>).y;
  if (typeof x !== "number" || typeof y !== "number") return null;
  return { x, y };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nearbySummary(
  subject: ParticipantInfo,
  subjectFrame: InternalWindowItem,
  items: InternalWindowItem[],
  participants: ParticipantInfo[],
): string | null {
  const subjectPosition = frameCoords(subjectFrame);
  if (!subjectPosition) return null;

  const participantById = new Map(
    participants.map((participant) => [participant.participantId, participant]),
  );
  const nearby = items
    .filter(
      (item) =>
        item.kind === "frame" &&
        item.timestampMs === subjectFrame.timestampMs &&
        item.participantRawId &&
        item.participantRawId !== subject.participantId,
    )
    .map((item) => {
      const participant = participantById.get(item.participantRawId as number);
      const position = frameCoords(item);
      if (!participant || !position) return null;
      return {
        participant,
        distance: Math.round(distance(subjectPosition, position)),
      };
    })
    .filter((entry): entry is { participant: ParticipantInfo; distance: number } => !!entry)
    .filter((entry) => entry.distance <= 2500)
    .sort((a, b) => a.distance - b.distance);

  if (!nearby.length) return null;

  const allies = nearby
    .filter((entry) => entry.participant.teamId === subject.teamId)
    .slice(0, 3)
    .map((entry) => `${entry.participant.championName} (${entry.distance})`);
  const enemies = nearby
    .filter((entry) => entry.participant.teamId !== subject.teamId)
    .slice(0, 3)
    .map((entry) => `${entry.participant.championName} (${entry.distance})`);

  return [
    allies.length ? `nearby allies: ${allies.join(", ")}` : "nearby allies: none",
    enemies.length ? `nearby enemies: ${enemies.join(", ")}` : "nearby enemies: none",
  ].join("; ");
}

function subjectEvidence(
  subject: SubjectInfo,
  items: InternalWindowItem[],
  participants: ParticipantInfo[],
): string[] {
  if (!subject.participant) {
    return [`${subject.key}: Participant not matched in Riot metadata.`];
  }

  const id = subject.participant.participantId;
  const directEvents = items.filter(
    (item) => item.kind === "event" && (item.involvedRawIds ?? []).includes(id),
  );
  const frames = items.filter((item) => item.kind === "frame" && item.participantRawId === id);
  const bullets: string[] = [];

  const firstFrame = frames[0];
  const lastFrame = frames[frames.length - 1];
  if (firstFrame) {
    const nearby = nearbySummary(subject.participant, firstFrame, items, participants);
    bullets.push(
      `${subject.key}: first observed at ${firstFrame.timestamp}${
        framePosition(firstFrame) ? `, ${framePosition(firstFrame)}` : ""
      }${nearby ? `; ${nearby}` : ""}.`,
    );
  }
  if (lastFrame && lastFrame !== firstFrame) {
    const nearby = nearbySummary(subject.participant, lastFrame, items, participants);
    bullets.push(
      `${subject.key}: last observed at ${lastFrame.timestamp}${
        framePosition(lastFrame) ? `, ${framePosition(lastFrame)}` : ""
      }${nearby ? `; ${nearby}` : ""}.`,
    );
  }

  const deaths = directEvents.filter(
    (item) =>
      eventType(item) === "CHAMPION_KILL" && item.victimId === subject.participant?.championName,
  );
  const assists = directEvents.filter(
    (item) =>
      eventType(item) === "CHAMPION_KILL" &&
      Array.isArray(item.assistingParticipantIds) &&
      item.assistingParticipantIds.includes(subject.participant?.championName),
  );
  const kills = directEvents.filter(
    (item) =>
      eventType(item) === "CHAMPION_KILL" && item.killerId === subject.participant?.championName,
  );
  const objectiveEvents = directEvents.filter((item) =>
    ["ELITE_MONSTER_KILL", "BUILDING_KILL", "TURRET_PLATE_DESTROYED"].includes(eventType(item)),
  );

  if (deaths.length)
    bullets.push(`${subject.key}: death evidence: ${deaths.map(summarizeEvent).join(" ")}`);
  if (kills.length || assists.length) {
    bullets.push(
      `${subject.key}: fight participation: ${[...kills, ...assists].map(summarizeEvent).join(" ")}`,
    );
  }
  if (objectiveEvents.length) {
    bullets.push(
      `${subject.key}: objective/structure involvement: ${objectiveEvents.map(summarizeEvent).join(" ")}`,
    );
  }
  if (directEvents.length === 0) {
    bullets.push(
      `${subject.key}: No direct kill, assist, ward, recall, or objective event involvement in this window.`,
    );
  }

  return bullets;
}

function teamRoster(participants: ParticipantInfo[], teamId: number): string {
  const members = participants.filter((participant) => participant.teamId === teamId);
  if (!members.length) return "Unavailable";
  return members
    .map((participant) => `${roleLabel(participant.teamPosition)} ${participant.championName}`)
    .join(", ");
}

function nearbyParticipantIds(
  items: InternalWindowItem[],
  participants: ParticipantInfo[],
  subjectIds: Set<number>,
): Set<number> {
  const ids = new Set<number>();
  const participantIds = new Set(participants.map((participant) => participant.participantId));

  for (const subjectFrame of items) {
    if (
      subjectFrame.kind !== "frame" ||
      !subjectFrame.participantRawId ||
      !subjectIds.has(subjectFrame.participantRawId)
    ) {
      continue;
    }
    const subjectPosition = frameCoords(subjectFrame);
    if (!subjectPosition) continue;

    for (const candidate of items) {
      if (
        candidate.kind !== "frame" ||
        candidate.timestampMs !== subjectFrame.timestampMs ||
        !candidate.participantRawId ||
        candidate.participantRawId === subjectFrame.participantRawId ||
        !participantIds.has(candidate.participantRawId)
      ) {
        continue;
      }
      const candidatePosition = frameCoords(candidate);
      if (candidatePosition && distance(subjectPosition, candidatePosition) <= 2500) {
        ids.add(candidate.participantRawId);
      }
    }
  }

  return ids;
}

function trimEvidence(
  items: InternalWindowItem[],
  participants: ParticipantInfo[],
  subjectIds: Set<number>,
): InternalWindowItem[] {
  if (items.length <= 40 && subjectIds.size === 0) return items;

  const evidence: InternalWindowItem[] = [];
  const add = (item: InternalWindowItem) => {
    if (!evidence.includes(item)) evidence.push(item);
  };

  for (const item of items) {
    if (item.kind === "event" && isRelevantEvent(item, subjectIds)) add(item);
  }

  const involved = new Set<number>(subjectIds);
  for (const item of evidence) {
    for (const id of item.involvedRawIds ?? []) involved.add(id);
  }
  for (const id of nearbyParticipantIds(items, participants, subjectIds)) involved.add(id);

  for (const item of items) {
    if (item.kind === "frame" && item.participantRawId && involved.has(item.participantRawId)) {
      add(item);
    }
  }

  if (evidence.length === 0) {
    for (const item of items.slice(0, 20)) add(item);
  }

  evidence.sort((a, b) => a.timestampMs - b.timestampMs);
  return evidence.slice(0, 80);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positionValue(record: Record<string, unknown>): { x: number; y: number } | null {
  const position = asRecord(record.position);
  const x = numberValue(position, "x");
  const y = numberValue(position, "y");
  return x == null || y == null ? null : { x, y };
}

function participantSnapshot(
  item: InternalWindowItem,
  participantById: Map<number, ParticipantInfo>,
) {
  const participant =
    item.participantRawId != null ? participantById.get(item.participantRawId) : undefined;
  const frame = asRecord(item.frame);
  const championStats = asRecord(frame.championStats);
  const damageStats = asRecord(frame.damageStats);

  return {
    championName: participant?.championName ?? String(item.participantId ?? "Unknown"),
    role: roleLabel(participant?.teamPosition),
    position: positionValue(frame),
    currentGold: numberValue(frame, "currentGold"),
    totalGold: numberValue(frame, "totalGold"),
    minionsKilled: numberValue(frame, "minionsKilled"),
    jungleMinionsKilled: numberValue(frame, "jungleMinionsKilled"),
    level: numberValue(frame, "level"),
    xp: numberValue(frame, "xp"),
    health: numberValue(championStats, "health"),
    healthMax: numberValue(championStats, "healthMax"),
    timeEnemySpentControlled: numberValue(frame, "timeEnemySpentControlled"),
    totalDamageDoneToChampions: numberValue(damageStats, "totalDamageDoneToChampions"),
  };
}

function groupedFrameOutput(
  timestamp: string,
  frames: InternalWindowItem[],
  participantById: Map<number, ParticipantInfo>,
): OutputWindowItem {
  const grouped = {
    blue: [] as ReturnType<typeof participantSnapshot>[],
    red: [] as ReturnType<typeof participantSnapshot>[],
  };

  for (const item of frames) {
    if (item.kind !== "frame") continue;
    const participant =
      item.participantRawId != null ? participantById.get(item.participantRawId) : undefined;
    const snapshot = participantSnapshot(item, participantById);
    if (participant?.teamId === 200) grouped.red.push(snapshot);
    else grouped.blue.push(snapshot);
  }

  return {
    type: "frame",
    timestamp,
    participants: grouped,
  };
}

function stringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function assistsValue(record: Record<string, unknown>): string[] {
  const value = record.assistingParticipantIds;
  return Array.isArray(value) ? value.map(String) : [];
}

function eventPositionValue(record: Record<string, unknown>): { x: number; y: number } | null {
  const position = asRecord(record.position);
  const x = numberValue(position, "x");
  const y = numberValue(position, "y");
  return x == null || y == null ? null : { x, y };
}

function compactEventOutput(event: Record<string, unknown>): OutputWindowItem {
  const type = stringValue(event, "type") ?? "EVENT";
  const timestamp = stringValue(event, "timestamp") ?? "";

  if (type === "CHAMPION_KILL") {
    return {
      type,
      timestamp,
      killer: stringValue(event, "killerId"),
      victim: stringValue(event, "victimId"),
      assistingParticipantIds: assistsValue(event),
      bounty: numberValue(event, "bounty"),
    };
  }

  if (type === "ELITE_MONSTER_KILL") {
    return {
      type,
      timestamp,
      killer: stringValue(event, "killerId"),
      assistingParticipantIds: assistsValue(event),
      monsterType: stringValue(event, "monsterType"),
    };
  }

  if (type === "BUILDING_KILL") {
    return {
      type,
      timestamp,
      team: stringValue(event, "teamId"),
      assistingParticipantIds: assistsValue(event),
      buildingType: stringValue(event, "buildingType"),
      towerType: stringValue(event, "towerType"),
      laneType: stringValue(event, "laneType"),
    };
  }

  if (type === "TURRET_PLATE_DESTROYED") {
    return {
      type,
      timestamp,
      position: eventPositionValue(event),
      team: stringValue(event, "teamId"),
      killer: stringValue(event, "killerId"),
    };
  }

  return event;
}

function shouldOmitOutputEvent(event: Record<string, unknown>): boolean {
  return [
    "WARD_PLACED",
    "WARD_KILL",
    "SKILL_LEVEL_UP",
    "ITEM_DESTROYED",
    "ITEM_PURCHASED",
  ].includes(stringValue(event, "type") ?? "");
}

function stripInternal(
  items: InternalWindowItem[],
  participants: ParticipantInfo[],
  allItems: InternalWindowItem[] = items,
): OutputWindowItem[] {
  const participantById = new Map(
    participants.map((participant) => [participant.participantId, participant]),
  );
  const framesByTimestamp = new Map<number, InternalWindowItem[]>();
  for (const item of allItems) {
    if (item.kind !== "frame") continue;
    const frames = framesByTimestamp.get(item.timestampMs) ?? [];
    frames.push(item);
    framesByTimestamp.set(item.timestampMs, frames);
  }

  const emittedFrameTimestamps = new Set<number>();
  const out: OutputWindowItem[] = [];

  for (const item of items) {
    if (item.kind === "frame") {
      if (emittedFrameTimestamps.has(item.timestampMs)) continue;
      emittedFrameTimestamps.add(item.timestampMs);
      out.push(
        groupedFrameOutput(
          item.timestamp,
          framesByTimestamp.get(item.timestampMs) ?? [item],
          participantById,
        ),
      );
      continue;
    }

    const {
      timestampMs: _timestampMs,
      participantRawId: _participantRawId,
      involvedRawIds: _involvedRawIds,
      ...event
    } = item;
    if (shouldOmitOutputEvent(event)) continue;
    out.push(compactEventOutput(event));
  }

  return out;
}

function buildBrief({
  participants,
  subjects,
  evidence,
}: {
  participants: ParticipantInfo[];
  subjects: SubjectInfo[];
  evidence: InternalWindowItem[];
}): string {
  const relevantEvents = evidence.filter((item) => item.kind === "event");

  return [
    "Teams:",
    `- Blue: ${teamRoster(participants, 100)}`,
    `- Red: ${teamRoster(participants, 200)}`,
    "",
    "Subjects:",
    `- Subject A: ${subjectLabel(subjects[0])}`,
    `- Subject B: ${subjectLabel(subjects[1])}`,
    "",
    "Relevant Events:",
    ...(relevantEvents.length
      ? relevantEvents.map((item) => `- ${summarizeEvent(item)}`)
      : ["- No relevant event rows retained."]),
  ].join("\n");
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
): InternalWindowItem[] {
  const pframes = frame.participantFrames;
  if (!pframes) return [];

  return Object.entries(pframes)
    .map(([participantId, data]) => {
      const participantRawId = rawParticipantId(participantId);
      return {
        kind: "frame" as const,
        timestampMs: timestamp,
        timestamp: formatGameTime(timestamp),
        participantRawId,
        participantId: labelParticipant(participantId, champions),
        frame: humanizeIds(data, champions),
      };
    })
    .sort((a, b) => (a.participantRawId ?? 0) - (b.participantRawId ?? 0));
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
): InternalWindowItem[] {
  const frames = timeline.info?.frames;
  if (!Array.isArray(frames)) throw new Error("Riot timeline response is missing frames.");

  const items: InternalWindowItem[] = [];

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
        involvedRawIds: eventInvolvedIds(event),
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

  return items;
}

export const getTimelineWindow = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => TimelineWindowInputSchema.parse(input))
  .handler(async ({ data }) => {
    assertContextInspectionAllowed();
    assertRateLimit({
      scope: "timeline-window",
      limit: 10,
      windowMs: ONE_MINUTE_MS,
      message: "Too many context requests. Please wait a minute and try again.",
    });

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
    const participants = buildParticipants(match);
    const subjects: SubjectInfo[] = [
      {
        key: "Subject A",
        participant: findSubject(participants, data.subjects?.a ?? { puuid: data.userPuuid }),
        fallbackChampion: data.subjects?.a?.champion,
      },
      {
        key: "Subject B",
        participant: findSubject(participants, data.subjects?.b),
        fallbackChampion: data.subjects?.b?.champion,
      },
    ];
    const subjectIds = new Set(
      subjects
        .map((subject) => subject.participant?.participantId)
        .filter((id): id is number => typeof id === "number"),
    );
    const items = extractWindow(timeline, data.startMs, data.endMs, champions);
    const evidence = trimEvidence(items, participants, subjectIds);
    const brief = buildBrief({
      participants,
      subjects,
      evidence,
    });

    return {
      window: {
        start: formatGameTime(data.startMs),
        end: formatGameTime(data.endMs),
      },
      count: evidence.length,
      totalItems: items.length,
      brief,
      evidence: stripInternal(evidence, participants, items),
      items: stripInternal(items, participants),
    };
  });
