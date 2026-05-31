import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import type { RegionalRouting } from "@/server/riot";
import { assertRateLimit } from "@/server/request-rate-limit";
import { assertTurnstile, TurnstileTokenSchema } from "@/server/turnstile";
import {
  UPPER_PROMPT,
  buildFreeForAllLowerPrompt,
  buildFreeForAllUpperPrompt,
  buildLowerPrompt,
  buildV2LowerPrompt,
  buildV2UpperPrompt,
} from "@/components/judge-prompts/promptText";
import { substituteSubjects } from "@/components/judge-prompts/substituteSubjects";
import type { Locale } from "@/i18n";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
      win?: boolean;
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
  win?: boolean;
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

type FreeForAllPlayerInput = {
  champion: string;
  puuid?: string;
  role?: string;
  summoner?: string;
};

type StoredVerdictPlayer = {
  champion: string;
  championLabel?: string;
  summoner?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
};

type StoredVerdictDisplay = {
  championName: string;
  championKey?: string;
  summonerName?: string;
};

const DDRAGON_CDN_ROOT = "https://ddragon.leagueoflegends.com/cdn";
const DDRAGON_FALLBACK_VERSION = "14.24.1";

const CHAMPION_FILENAME_OVERRIDES: Record<string, string> = {
  FiddleSticks: "Fiddlesticks",
  Wukong: "MonkeyKing",
  "Cho'Gath": "Chogath",
  "Kai'Sa": "Kaisa",
  "Kha'Zix": "Khazix",
  "Kog'Maw": "KogMaw",
  LeBlanc: "Leblanc",
  "Vel'Koz": "Velkoz",
  "Rek'Sai": "RekSai",
  "K'Sante": "KSante",
  "Bel'Veth": "Belveth",
  "Nunu & Willump": "Nunu",
  "Renata Glasc": "Renata",
  "Tahm Kench": "TahmKench",
  "Twisted Fate": "TwistedFate",
  "Master Yi": "MasterYi",
  "Miss Fortune": "MissFortune",
  "Aurelion Sol": "AurelionSol",
  "Dr. Mundo": "DrMundo",
  "Jarvan IV": "JarvanIV",
  "Lee Sin": "LeeSin",
  "Xin Zhao": "XinZhao",
};

const KOREAN_CHAMPION_NAME_OVERRIDES: Record<string, string> = {
  Yunara: "유나라",
};

type DDragonChampionData = {
  id: string;
  name: string;
};

type DDragonChampionResponse = {
  data?: Record<string, DDragonChampionData>;
};

let ddragonVersionPromise: Promise<string> | null = null;
const championNameMapPromises = new Map<string, Promise<Record<string, string>>>();

function championFilename(championName: string): string {
  if (!championName) return "";
  return CHAMPION_FILENAME_OVERRIDES[championName] ?? championName.replace(/[^A-Za-z0-9]/g, "");
}

async function ddragonVersion(): Promise<string> {
  ddragonVersionPromise ??= fetch("https://ddragon.leagueoflegends.com/api/versions.json")
    .then(async (response) => {
      if (!response.ok) return DDRAGON_FALLBACK_VERSION;
      const versions = (await response.json()) as unknown;
      return Array.isArray(versions) && typeof versions[0] === "string"
        ? versions[0]
        : DDRAGON_FALLBACK_VERSION;
    })
    .catch(() => DDRAGON_FALLBACK_VERSION);
  return ddragonVersionPromise;
}

async function koreanChampionNameMap(): Promise<Record<string, string>> {
  const version = await ddragonVersion();
  const key = `ko_KR:${version}`;
  if (!championNameMapPromises.has(key)) {
    championNameMapPromises.set(
      key,
      fetch(`${DDRAGON_CDN_ROOT}/${version}/data/ko_KR/champion.json`)
        .then(async (response) => {
          if (!response.ok) return {};
          const json = (await response.json()) as DDragonChampionResponse;
          return Object.fromEntries(
            Object.values(json.data ?? {}).map((champion) => [champion.id, champion.name]),
          );
        })
        .catch(() => ({})),
    );
  }
  return championNameMapPromises.get(key) ?? {};
}

async function buildServerChampionLocalization({
  locale,
  match,
}: {
  locale: Locale;
  match: MatchPayload;
}): Promise<string> {
  if (locale !== "ko") return "";

  const champions = new Set<string>();
  for (const participant of match.info?.participants ?? []) {
    if (participant.championName) champions.add(participant.championName);
  }

  if (champions.size === 0) return "";

  const names = await koreanChampionNameMap();
  const rows = [...champions]
    .map((champion) => {
      const localized =
        names[championFilename(champion)] ?? KOREAN_CHAMPION_NAME_OVERRIDES[champion];
      return localized && localized !== champion ? `- ${champion} → ${localized}` : null;
    })
    .filter((row): row is string => row !== null);

  if (rows.length === 0) return "";

  return `**NAME LOCALIZATION:**

Use these Korean champion names exactly. Do not transliterate, guess, abbreviate, or alter spelling:
${rows.join("\n")}`;
}

const FreeForAllTeamInputSchema = z
  .array(
    z.object({
      champion: z.string().min(1),
      puuid: z.string().optional(),
      role: z.string().optional(),
      summoner: z.string().optional(),
    }),
  )
  .max(5)
  .optional();

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
  focusPuuids: z.array(z.string().min(1)).max(10).optional(),
  locale: z.enum(["en", "ko"]).optional(),
  verdictMode: z.enum(["duel", "free-for-all"]).optional(),
  freeForAllTeam: FreeForAllTeamInputSchema,
});

const TimelineFullGameInputSchema = TimelineWindowInputSchema.omit({
  startMs: true,
  endMs: true,
});

const TimelineGoldSwingFullGameInputSchema = TimelineFullGameInputSchema;

const JudgeVerdictInputSchema = z.object({
  matchId: z.string().min(3),
  userPuuid: z.string().min(1),
  routingRegion: z.enum(["americas", "europe", "asia", "sea"]).optional(),
  scope: z.enum(["window", "full", "v2-full"]),
  startMs: z.number().int().min(0).optional(),
  endMs: z.number().int().min(0).optional(),
  locale: z.enum(["en", "ko"]).optional(),
  includeRaw: z.boolean().optional(),
  turnstileToken: TurnstileTokenSchema,
  accessToken: z.string().min(1).optional(),
  anonymousId: z.string().min(8).max(128).optional(),
  subjects: TimelineWindowInputSchema.shape.subjects,
  verdictMode: z.enum(["duel", "free-for-all"]).optional(),
  freeForAllTeam: FreeForAllTeamInputSchema,
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

const MIN_WINDOW_MS = 5 * 60_000;
const MAX_WINDOW_MS = 10 * 60_000;
const MAX_FULL_GAME_CONTEXT_MS = 60 * 60_000;
const ONE_MINUTE_MS = 60_000;
const GOLD_SWING_CONTEXT_PADDING_MS = 90_000;
const FINAL_SEQUENCE_CONTEXT_MS = 180_000;
const ABSOLUTE_GOLD_SWING_CONTEXT_LIMIT = 3;
const LOSING_TEAM_COLLAPSE_CONTEXT_LIMIT = 3;
const END_OF_GAME_TOLERANCE_MS = 15_000;

function contextStartMinuteMs(startMs: number): number {
  return Math.floor(startMs / ONE_MINUTE_MS) * ONE_MINUTE_MS;
}

function contextEndMs(endMs: number, timelineEnd: number): number {
  return timelineEnd - endMs <= END_OF_GAME_TOLERANCE_MS ? timelineEnd : endMs;
}

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

function aiGatewayUrl(): string {
  const url = process.env.AI_GATEWAY_URL;
  if (!url) {
    console.error("[ai-service] AI_GATEWAY_URL is not configured.");
    throw new Error("AI service is unavailable. Please try again later.");
  }
  return url;
}

function aiGatewayToken(): string {
  const token = process.env.AI_GATEWAY_TOKEN;
  if (!token) {
    console.error("[ai-service] AI_GATEWAY_TOKEN is not configured.");
    throw new Error("AI service is unavailable. Please try again later.");
  }
  return token;
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
        win: participant.win,
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

function trimEvidence(items: InternalWindowItem[], subjectIds: Set<number>): InternalWindowItem[] {
  if (items.length <= 40 && subjectIds.size === 0) return items;

  const evidence: InternalWindowItem[] = [];
  const add = (item: InternalWindowItem) => {
    if (!evidence.includes(item)) evidence.push(item);
  };

  const frameByTimestamp = new Map<number, InternalWindowItem>();
  for (const item of items) {
    if (item.kind === "frame" && !frameByTimestamp.has(item.timestampMs)) {
      frameByTimestamp.set(item.timestampMs, item);
    }
  }

  for (const item of items) {
    if (item.kind === "event" && isRelevantEvent(item, subjectIds)) add(item);
  }

  for (const frame of frameByTimestamp.values()) {
    add(frame);
  }

  if (evidence.length === 0) {
    for (const item of items.slice(0, 20)) add(item);
  }

  evidence.sort((a, b) => {
    if (a.timestampMs !== b.timestampMs) return a.timestampMs - b.timestampMs;
    if (a.kind === b.kind) return 0;
    return a.kind === "frame" ? -1 : 1;
  });
  return evidence;
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
      position: eventPositionValue(event),
      bounty: numberValue(event, "bounty"),
    };
  }

  if (type === "ELITE_MONSTER_KILL") {
    return {
      type,
      timestamp,
      team: stringValue(event, "killerTeamId"),
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
      killer: stringValue(event, "killerId"),
      assistingParticipantIds: assistsValue(event),
      position: eventPositionValue(event),
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

function shouldOmitOutputEvent(
  event: Record<string, unknown>,
  extraOmittedEventTypes: readonly string[] = [],
): boolean {
  return [
    "WARD_PLACED",
    "WARD_KILL",
    "SKILL_LEVEL_UP",
    "ITEM_DESTROYED",
    "ITEM_PURCHASED",
    "ITEM_UNDO",
    "ITEM_SOLD",
    "CHAMPION_SPECIAL_KILL",
    "OBJECTIVE_BOUNTY_PRESTART",
    "DRAGON_SOUL_GIVEN",
    ...extraOmittedEventTypes,
  ].includes(stringValue(event, "type") ?? "");
}

function stripInternal(
  items: InternalWindowItem[],
  participants: ParticipantInfo[],
  allItems: InternalWindowItem[] = items,
  extraOmittedEventTypes: readonly string[] = [],
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
    if (shouldOmitOutputEvent(event, extraOmittedEventTypes)) continue;
    out.push(compactEventOutput(event));
  }

  return out;
}

function outputItemType(item: OutputWindowItem): string {
  return typeof item.type === "string" ? item.type : "EVENT";
}

function outputTimestamp(item: OutputWindowItem): string {
  return typeof item.timestamp === "string" ? item.timestamp : "[unknown time]";
}

function timestampSortValue(item: OutputWindowItem): number {
  const match = outputTimestamp(item).match(/^\[(\d+):(\d{2})\]$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * 60 + Number(match[2]);
}

function outputParticipants(item: OutputWindowItem): {
  blue?: unknown[];
  red?: unknown[];
} {
  const participants = asRecord(item.participants);
  return {
    blue: Array.isArray(participants.blue) ? participants.blue : undefined,
    red: Array.isArray(participants.red) ? participants.red : undefined,
  };
}

function firstOutputFrame(items: OutputWindowItem[]): OutputWindowItem | undefined {
  return items.find((item) => outputItemType(item) === "frame");
}

function championRoleLabel(value: unknown): string {
  const participant = asRecord(value);
  const championName = stringValue(participant, "championName") ?? "Unknown champion";
  const role = stringValue(participant, "role");
  return role ? `${role} ${championName}` : championName;
}

function teamLineFromOutput(frame: OutputWindowItem | undefined, team: "blue" | "red"): string {
  if (!frame) return "Unavailable";
  const participants = outputParticipants(frame)[team] ?? [];
  if (!participants.length) return "Unavailable";
  return participants.map(championRoleLabel).join(", ");
}

type ChampionTeamLookup = Map<string, "Blue" | "Red">;

function normalizedChampionName(value: unknown): string {
  return String(value ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function buildChampionTeamLookup(items: OutputWindowItem[]): ChampionTeamLookup {
  const lookup: ChampionTeamLookup = new Map();
  for (const item of items) {
    if (outputItemType(item) !== "frame") continue;
    const participants = outputParticipants(item);
    for (const participant of participants.blue ?? []) {
      const championName = stringValue(asRecord(participant), "championName");
      if (championName) lookup.set(normalizedChampionName(championName), "Blue");
    }
    for (const participant of participants.red ?? []) {
      const championName = stringValue(asRecord(participant), "championName");
      if (championName) lookup.set(normalizedChampionName(championName), "Red");
    }
  }
  return lookup;
}

function teamForChampion(
  championName: unknown,
  championTeams: ChampionTeamLookup,
): "Blue" | "Red" | null {
  return championTeams.get(normalizedChampionName(championName)) ?? null;
}

function numericOutput(record: Record<string, unknown>, key: string, label: string): string | null {
  const value = numberValue(record, key);
  return value == null ? null : `${label} ${value}`;
}

function positionOutput(record: Record<string, unknown>): string | null {
  const position = positionValue(record);
  return position ? `pos (${position.x}, ${position.y})` : null;
}

function participantFrameSummary(value: unknown): string {
  const participant = asRecord(value);
  const details = [
    stringValue(participant, "role"),
    numericOutput(participant, "level", "level"),
    numericOutput(participant, "currentGold", "current gold"),
    numericOutput(participant, "totalGold", "total gold"),
    numericOutput(participant, "minionsKilled", "CS"),
    numericOutput(participant, "jungleMinionsKilled", "jungle CS"),
    numericOutput(participant, "xp", "XP"),
    numericOutput(participant, "health", "health"),
    numericOutput(participant, "healthMax", "max health"),
    numericOutput(participant, "timeEnemySpentControlled", "enemy CC time"),
    numericOutput(participant, "totalDamageDoneToChampions", "champion damage"),
    positionOutput(participant),
  ].filter((part): part is string => !!part);
  const championName = stringValue(participant, "championName") ?? "Unknown champion";
  return details.length ? `${championName} (${details.join(", ")})` : championName;
}

function frameSummary(item: OutputWindowItem): string {
  const participants = outputParticipants(item);
  const blue = (participants.blue ?? []).map(participantFrameSummary);
  const red = (participants.red ?? []).map(participantFrameSummary);
  return `${outputTimestamp(item)} Blue: ${blue.length ? blue.join("; ") : "none"} | Red: ${
    red.length ? red.join("; ") : "none"
  }`;
}

type StructurePoint = {
  ownerTeam: "Blue" | "Red";
  lane: "Top" | "Mid" | "Bot" | "Nexus";
  name: string;
  x: number;
  y: number;
};

const STRUCTURE_COORDINATE_TOLERANCE = 10;

const STRUCTURE_POINTS: StructurePoint[] = [
  { ownerTeam: "Blue", lane: "Top", name: "Top Outer Turret", x: 981, y: 10441 },
  { ownerTeam: "Blue", lane: "Top", name: "Top Inner Turret", x: 1512, y: 6699 },
  { ownerTeam: "Blue", lane: "Top", name: "Top Inhibitor Turret", x: 1169, y: 4287 },
  { ownerTeam: "Blue", lane: "Top", name: "Top Inhibitor", x: 1172, y: 3583 },
  { ownerTeam: "Blue", lane: "Mid", name: "Mid Outer Turret", x: 5846, y: 6396 },
  { ownerTeam: "Blue", lane: "Mid", name: "Mid Inner Turret", x: 5048, y: 4812 },
  { ownerTeam: "Blue", lane: "Mid", name: "Mid Inhibitor Turret", x: 3651, y: 3696 },
  { ownerTeam: "Blue", lane: "Mid", name: "Mid Inhibitor", x: 3210, y: 3217 },
  { ownerTeam: "Blue", lane: "Bot", name: "Bot Outer Turret", x: 10504, y: 1029 },
  { ownerTeam: "Blue", lane: "Bot", name: "Bot Inner Turret", x: 6919, y: 1483 },
  { ownerTeam: "Blue", lane: "Bot", name: "Bot Inhibitor Turret", x: 4281, y: 1253 },
  { ownerTeam: "Blue", lane: "Bot", name: "Bot Inhibitor", x: 3468, y: 1230 },
  { ownerTeam: "Blue", lane: "Nexus", name: "Nexus Turret 1", x: 2177, y: 1807 },
  { ownerTeam: "Blue", lane: "Nexus", name: "Nexus Turret 2", x: 1748, y: 2270 },
  { ownerTeam: "Red", lane: "Top", name: "Top Outer Turret", x: 4318, y: 13875 },
  { ownerTeam: "Red", lane: "Top", name: "Top Inner Turret", x: 7943, y: 13411 },
  { ownerTeam: "Red", lane: "Top", name: "Top Inhibitor Turret", x: 10481, y: 13650 },
  { ownerTeam: "Red", lane: "Top", name: "Top Inhibitor", x: 11275, y: 13657 },
  { ownerTeam: "Red", lane: "Mid", name: "Mid Outer Turret", x: 8955, y: 8510 },
  { ownerTeam: "Red", lane: "Mid", name: "Mid Inner Turret", x: 9767, y: 10113 },
  { ownerTeam: "Red", lane: "Mid", name: "Mid Inhibitor Turret", x: 11134, y: 11207 },
  { ownerTeam: "Red", lane: "Mid", name: "Mid Inhibitor", x: 11593, y: 11669 },
  { ownerTeam: "Red", lane: "Bot", name: "Bot Outer Turret", x: 13866, y: 4505 },
  { ownerTeam: "Red", lane: "Bot", name: "Bot Inner Turret", x: 13327, y: 8226 },
  { ownerTeam: "Red", lane: "Bot", name: "Bot Inhibitor Turret", x: 13624, y: 10572 },
  { ownerTeam: "Red", lane: "Bot", name: "Bot Inhibitor", x: 13599, y: 11319 },
  { ownerTeam: "Red", lane: "Nexus", name: "Nexus Turret 1", x: 13052, y: 12612 },
  { ownerTeam: "Red", lane: "Nexus", name: "Nexus Turret 2", x: 12611, y: 13084 },
];

function structureAtPosition(position: { x: number; y: number } | null): StructurePoint | null {
  if (!position) return null;
  let best: { structure: StructurePoint; distance: number } | null = null;
  for (const structure of STRUCTURE_POINTS) {
    const dx = Math.abs(position.x - structure.x);
    const dy = Math.abs(position.y - structure.y);
    if (dx > STRUCTURE_COORDINATE_TOLERANCE || dy > STRUCTURE_COORDINATE_TOLERANCE) continue;
    const distance = Math.hypot(dx, dy);
    if (!best || distance < best.distance) best = { structure, distance };
  }
  return best?.structure ?? null;
}

function formatPosition(position: { x: number; y: number } | null): string {
  return position ? `(${position.x}, ${position.y})` : "(unknown position)";
}

function normalizedTeam(value: unknown): "Blue" | "Red" | "Unknown" {
  if (value === "Blue" || value === "Red") return value;
  return "Unknown";
}

function oppositeTeam(team: "Blue" | "Red" | "Unknown"): "Blue" | "Red" | "Unknown" {
  if (team === "Blue") return "Red";
  if (team === "Red") return "Blue";
  return "Unknown";
}

function fallbackLane(value: unknown): "Top" | "Mid" | "Bot" | "Nexus" {
  const lane = String(value ?? "").toUpperCase();
  if (lane.includes("TOP")) return "Top";
  if (lane.includes("MID")) return "Mid";
  if (lane.includes("BOT")) return "Bot";
  return "Nexus";
}

function fallbackStructureName(item: OutputWindowItem): string {
  const lane = fallbackLane(item.laneType);
  const towerType = String(item.towerType ?? "");
  const buildingType = String(item.buildingType ?? "");
  if (towerType === "OUTER_TURRET") return `${lane} Outer Turret`;
  if (towerType === "INNER_TURRET") return `${lane} Inner Turret`;
  if (towerType === "BASE_TURRET") return `${lane} Inhibitor Turret`;
  if (towerType === "NEXUS_TURRET") return "Nexus Turret";
  if (buildingType === "INHIBITOR_BUILDING") return `${lane} Inhibitor`;
  return buildingType || towerType || "Unknown Structure";
}

function isUnknownKiller(value: unknown): boolean {
  if (value == null) return true;
  const normalized = String(value).trim().toLowerCase();
  return !normalized || normalized === "unknown" || normalized === "0";
}

function assistNames(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function readableMonsterName(value: unknown): string {
  const normalized = String(value ?? "objective").toLowerCase();
  if (normalized === "riftherald") return "Riftherald";
  if (normalized === "dragon") return "Dragon";
  if (normalized === "baron_nashor") return "Baron Nashor";
  if (normalized === "horde") return "Voidgrub";
  return normalized
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function outputEventSummary(item: OutputWindowItem, championTeams: ChampionTeamLookup): string {
  const type = outputItemType(item);
  const timestamp = outputTimestamp(item);

  if (type === "LEVEL_UP") {
    return `${timestamp}: ${String(item.participantId ?? "Unknown champion")} level up to ${String(
      item.level ?? "unknown",
    )}`;
  }

  if (type === "CHAMPION_KILL") {
    const killer = String(item.killer ?? "unknown");
    const victim = String(item.victim ?? "unknown");
    const assists = assistNames(item.assistingParticipantIds);
    const position = positionValue(item);
    if (assists.length) {
      return `${timestamp}: ${killer} has killed ${victim} with assists from ${assists.join(
        ", ",
      )} ${formatPosition(position)}`;
    }
    return `${timestamp}: ${killer} has killed ${victim} ${formatPosition(position)}`;
  }

  if (type === "ELITE_MONSTER_KILL") {
    const killer = String(item.killer ?? "unknown");
    const actorTeam = teamForChampion(killer, championTeams) ?? normalizedTeam(item.team);
    const monster = readableMonsterName(item.monsterType);
    const assists = assistNames(item.assistingParticipantIds);
    if (assists.length) {
      return `${timestamp}: ${actorTeam} team's ${killer} has taken the ${monster} with assist of ${assists.join(
        ", ",
      )}`;
    }
    return `${timestamp}: ${actorTeam} team's ${killer} has taken the ${monster}`;
  }

  if (type === "BUILDING_KILL") {
    const position = positionValue(item);
    const structure = structureAtPosition(position);
    const killer = item.killer;
    const actorTeam = isUnknownKiller(killer)
      ? normalizedTeam(item.team)
      : (teamForChampion(killer, championTeams) ?? normalizedTeam(item.team));
    const destroyedTeam = structure?.ownerTeam ?? oppositeTeam(actorTeam);
    const lane = structure?.lane ?? fallbackLane(item.laneType);
    const structureName = structure?.name ?? fallbackStructureName(item);
    const assists = assistNames(item.assistingParticipantIds);

    if (isUnknownKiller(killer)) {
      const wave = `${actorTeam} team's ${lane} wave`;
      const contributors = assists.length ? `${wave} and ${assists.join(", ")}` : wave;
      return `${timestamp}: ${contributors} has destroyed ${destroyedTeam} team's ${structureName} ${formatPosition(
        position,
      )}`;
    }

    const killerName = String(killer);
    const contributors = assists.length ? [killerName, ...assists].join(", ") : killerName;
    return `${timestamp}: ${actorTeam} team's ${contributors} has destroyed ${destroyedTeam} team's ${structureName} ${formatPosition(
      position,
    )}`;
  }

  if (type === "TURRET_PLATE_DESTROYED") {
    const position = positionValue(item);
    const structure = structureAtPosition(position);
    const destroyedTeam = normalizedTeam(item.team);
    const actorTeam = isUnknownKiller(item.killer)
      ? oppositeTeam(destroyedTeam)
      : (teamForChampion(item.killer, championTeams) ?? oppositeTeam(destroyedTeam));
    const lane = structure?.lane ?? "Unknown";
    const structureName = structure?.name ?? "Unknown Turret";

    if (isUnknownKiller(item.killer)) {
      return `${timestamp}: ${actorTeam} team's ${lane} wave has taken turret plate of ${structureName} ${formatPosition(
        position,
      )}`;
    }

    return `${timestamp}: ${actorTeam} team's ${String(
      item.killer,
    )} has taken turret plate of ${structureName} ${formatPosition(position)}`;
  }

  if (type === "GAME_END") {
    const winner = normalizedTeam(item.winningTeam);
    return `${timestamp}: GAME END- Winner ${winner} Team!`;
  }

  return `${timestamp} ${type}: ${JSON.stringify(item)}.`;
}

function chronologicalContextLine(
  item: OutputWindowItem,
  championTeams: ChampionTeamLookup,
): string {
  return outputItemType(item) === "frame"
    ? frameSummary(item)
    : outputEventSummary(item, championTeams);
}

function buildBriefFromOutput(evidence: OutputWindowItem[]): string {
  const firstFrame = firstOutputFrame(evidence);
  const championTeams = buildChampionTeamLookup(evidence);
  const chronologicalItems = [...evidence].sort(
    (a, b) => timestampSortValue(a) - timestampSortValue(b),
  );

  return [
    "Teams:",
    `- Blue: ${teamLineFromOutput(firstFrame, "blue")}`,
    `- Red: ${teamLineFromOutput(firstFrame, "red")}`,
    "",
    "Chronological Context:",
    ...(chronologicalItems.length
      ? chronologicalItems.map((item) => `- ${chronologicalContextLine(item, championTeams)}`)
      : ["- No context rows retained."]),
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
    } else if (
      key === "teamId" ||
      key === "killerTeamId" ||
      key === "victimTeamId" ||
      key === "winningTeam"
    ) {
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

  return items;
}

function timelineEndMs(timeline: TimelinePayload): number {
  const frames = timeline.info?.frames;
  if (!Array.isArray(frames)) throw new Error("Riot timeline response is missing frames.");

  let endMs = 0;
  for (const frame of frames) {
    const frameTs = toTimestamp(frame.timestamp);
    if (frameTs != null) endMs = Math.max(endMs, frameTs);
    for (const event of frame.events ?? []) {
      const eventTs = toTimestamp(event.timestamp);
      if (eventTs != null) endMs = Math.max(endMs, eventTs);
    }
  }
  return endMs;
}

function teamGoldForFrame(
  frame: TimelineFrame,
  participantsById: Map<number, ParticipantInfo>,
): { blue: number; red: number } | null {
  const participantFrames = frame.participantFrames;
  if (!participantFrames) return null;

  let blue = 0;
  let red = 0;
  let seen = false;

  for (const [participantId, rawFrame] of Object.entries(participantFrames)) {
    const id = rawParticipantId(participantId);
    const participant = id != null ? participantsById.get(id) : undefined;
    const totalGold = numberValue(rawFrame, "totalGold");
    if (!participant || totalGold == null) continue;
    seen = true;
    if (participant.teamId === 200) red += totalGold;
    else blue += totalGold;
  }

  return seen ? { blue, red } : null;
}

type GoldSnapshot = {
  timestampMs: number;
  blueGold: number;
  redGold: number;
  goldDiff: number;
};

type GoldContextWindow = {
  startMs: number;
  endMs: number;
  centerMs: number;
  shift: number;
  reason: "absolute-shift" | "losing-team-collapse" | "max-lead-collapse" | "final-sequence";
};

function losingTeamId(participants: ParticipantInfo[]): number | undefined {
  const loser = participants.find((participant) => participant.win === false);
  return loser?.teamId;
}

function losingTeamAdvantage(snapshot: GoldSnapshot, losingTeam?: number): number {
  if (losingTeam === 100) return snapshot.blueGold - snapshot.redGold;
  if (losingTeam === 200) return snapshot.redGold - snapshot.blueGold;
  return 0;
}

function goldSnapshots(timeline: TimelinePayload, participants: ParticipantInfo[]): GoldSnapshot[] {
  const frames = timeline.info?.frames;
  if (!Array.isArray(frames)) throw new Error("Riot timeline response is missing frames.");

  const participantsById = new Map(
    participants.map((participant) => [participant.participantId, participant]),
  );
  const snapshots: GoldSnapshot[] = [];

  for (const frame of frames) {
    const timestampMs = toTimestamp(frame.timestamp);
    if (timestampMs == null) continue;
    const gold = teamGoldForFrame(frame, participantsById);
    if (!gold) continue;
    snapshots.push({
      timestampMs,
      blueGold: gold.blue,
      redGold: gold.red,
      goldDiff: gold.blue - gold.red,
    });
  }

  return snapshots;
}

function goldWindow(
  centerMs: number,
  timelineEnd: number,
  shift: number,
  reason: GoldContextWindow["reason"],
): GoldContextWindow {
  return {
    startMs: Math.max(0, centerMs - GOLD_SWING_CONTEXT_PADDING_MS),
    endMs: Math.min(timelineEnd, centerMs + GOLD_SWING_CONTEXT_PADDING_MS),
    centerMs,
    shift,
    reason,
  };
}

function mergeGoldWindows(windows: GoldContextWindow[]): GoldContextWindow[] {
  const sorted = [...windows].sort((a, b) => a.startMs - b.startMs);
  const merged: GoldContextWindow[] = [];

  for (const window of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && window.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, window.endMs);
      previous.shift = Math.max(previous.shift, window.shift);
      if (previous.reason !== window.reason) previous.reason = "absolute-shift";
      continue;
    }
    merged.push({ ...window });
  }

  return merged;
}

function goldSwingWindows(
  timeline: TimelinePayload,
  participants: ParticipantInfo[],
  timelineEnd: number,
): GoldContextWindow[] {
  const snapshots = goldSnapshots(timeline, participants);
  if (snapshots.length < 2) return [];

  const absoluteSwingWindows = snapshots
    .slice(1)
    .map((snapshot, index) => ({
      centerMs: snapshot.timestampMs,
      shift: Math.abs(snapshot.goldDiff - snapshots[index].goldDiff),
    }))
    .filter((swing) => swing.shift > 0)
    .sort((a, b) => b.shift - a.shift)
    .slice(0, ABSOLUTE_GOLD_SWING_CONTEXT_LIMIT)
    .map((swing) => goldWindow(swing.centerMs, timelineEnd, swing.shift, "absolute-shift"));

  const losingTeam = losingTeamId(participants);
  const losingCollapseWindows =
    losingTeam == null
      ? []
      : snapshots
          .slice(1)
          .map((snapshot, index) => {
            const previousAdvantage = losingTeamAdvantage(snapshots[index], losingTeam);
            const currentAdvantage = losingTeamAdvantage(snapshot, losingTeam);
            return {
              centerMs: snapshot.timestampMs,
              shift: previousAdvantage - currentAdvantage,
            };
          })
          .filter((swing) => swing.shift > 0)
          .sort((a, b) => b.shift - a.shift)
          .slice(0, LOSING_TEAM_COLLAPSE_CONTEXT_LIMIT)
          .map((swing) =>
            goldWindow(swing.centerMs, timelineEnd, swing.shift, "losing-team-collapse"),
          );

  const maxLeadCollapseWindow =
    losingTeam == null
      ? []
      : (() => {
          let maxLeadIndex = -1;
          let maxLead = 0;
          for (const [index, snapshot] of snapshots.entries()) {
            const advantage = losingTeamAdvantage(snapshot, losingTeam);
            if (advantage > maxLead) {
              maxLead = advantage;
              maxLeadIndex = index;
            }
          }
          if (maxLeadIndex < 0) return [];

          let collapseTarget: { timestampMs: number; shift: number } | null = null;
          for (const snapshot of snapshots.slice(maxLeadIndex + 1)) {
            const shift = maxLead - losingTeamAdvantage(snapshot, losingTeam);
            if (shift <= 0) continue;
            if (!collapseTarget || shift > collapseTarget.shift) {
              collapseTarget = { timestampMs: snapshot.timestampMs, shift };
            }
          }

          return collapseTarget
            ? [
                goldWindow(
                  collapseTarget.timestampMs,
                  timelineEnd,
                  collapseTarget.shift,
                  "max-lead-collapse",
                ),
              ]
            : [];
        })();

  const finalWindow =
    timelineEnd > 0
      ? [
          {
            startMs: Math.max(0, timelineEnd - FINAL_SEQUENCE_CONTEXT_MS),
            endMs: timelineEnd,
            centerMs: timelineEnd,
            shift: 0,
            reason: "final-sequence" as const,
          },
        ]
      : [];

  return mergeGoldWindows([
    ...absoluteSwingWindows,
    ...losingCollapseWindows,
    ...maxLeadCollapseWindow,
    ...finalWindow,
  ]);
}

function internalItemKey(item: InternalWindowItem): string {
  return JSON.stringify({
    kind: item.kind,
    timestampMs: item.timestampMs,
    participantRawId: item.participantRawId,
    type: item.kind === "event" ? eventType(item) : undefined,
    event: item.kind === "event" ? item : undefined,
  });
}

function extractWindowRanges(
  timeline: TimelinePayload,
  windows: Array<{ startMs: number; endMs: number }>,
  champions: Record<number, string>,
): InternalWindowItem[] {
  const seen = new Set<string>();
  const items: InternalWindowItem[] = [];

  for (const window of windows) {
    for (const item of extractWindow(timeline, window.startMs, window.endMs, champions)) {
      const key = internalItemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }

  items.sort((a, b) => a.timestampMs - b.timestampMs);
  return items;
}

function buildWindowResponse({
  startMs,
  endMs,
  match,
  timeline,
  userPuuid,
  subjects: inputSubjects,
  focusPuuids = [],
  trimToRelevantEvidence = true,
  extraOmittedEventTypes = [],
}: {
  startMs: number;
  endMs: number;
  match: MatchPayload;
  timeline: TimelinePayload;
  userPuuid: string;
  subjects?: z.infer<typeof TimelineWindowInputSchema>["subjects"];
  focusPuuids?: readonly string[];
  trimToRelevantEvidence?: boolean;
  extraOmittedEventTypes?: readonly string[];
}) {
  const champions = buildChampionLookup(match);
  const participants = buildParticipants(match);
  const subjects: SubjectInfo[] = [
    {
      key: "Subject A",
      participant: findSubject(participants, inputSubjects?.a ?? { puuid: userPuuid }),
      fallbackChampion: inputSubjects?.a?.champion,
    },
    {
      key: "Subject B",
      participant: findSubject(participants, inputSubjects?.b),
      fallbackChampion: inputSubjects?.b?.champion,
    },
  ];
  const subjectIds = new Set(
    [
      ...subjects.map((subject) => subject.participant),
      ...focusPuuids
        .map((puuid) => findSubject(participants, { puuid })?.participant)
        .filter(Boolean),
    ]
      .map((participant) => participant?.participantId)
      .filter((id): id is number => typeof id === "number"),
  );
  const items = extractWindow(timeline, startMs, endMs, champions);
  return buildWindowResponseFromItems({
    startMs,
    endMs,
    timeline,
    participants,
    items,
    subjectIds,
    trimToRelevantEvidence,
    extraOmittedEventTypes,
  });
}

function buildWindowResponseFromItems({
  startMs,
  endMs,
  timeline,
  participants,
  items,
  subjectIds,
  trimToRelevantEvidence = true,
  extraOmittedEventTypes = [],
  focusWindows,
}: {
  startMs: number;
  endMs: number;
  timeline: TimelinePayload;
  participants: ParticipantInfo[];
  items: InternalWindowItem[];
  subjectIds: Set<number>;
  trimToRelevantEvidence?: boolean;
  extraOmittedEventTypes?: readonly string[];
  focusWindows?: GoldContextWindow[];
}) {
  const evidence = trimToRelevantEvidence ? trimEvidence(items, subjectIds) : items;
  const outputEvidence = stripInternal(evidence, participants, items, extraOmittedEventTypes);
  const outputItems = stripInternal(items, participants, items, extraOmittedEventTypes);
  const brief = buildBriefFromOutput(outputEvidence);

  return {
    window: {
      start: formatGameTime(startMs),
      end: formatGameTime(endMs),
    },
    gameLength: formatGameTime(timelineEndMs(timeline)),
    count: evidence.length,
    totalItems: items.length,
    brief,
    evidence: outputEvidence,
    items: outputItems,
    ...(focusWindows
      ? {
          focusWindows: focusWindows.map((window) => ({
            start: formatGameTime(window.startMs),
            end: formatGameTime(window.endMs),
            center: formatGameTime(window.centerMs),
            goldShift: window.shift,
            reason: window.reason,
          })),
        }
      : {}),
  };
}

function buildGoldSwingFullGameResponse({
  match,
  timeline,
  userPuuid,
  subjects: inputSubjects,
  focusPuuids = [],
  extraOmittedEventTypes = [],
}: {
  match: MatchPayload;
  timeline: TimelinePayload;
  userPuuid: string;
  subjects?: z.infer<typeof TimelineWindowInputSchema>["subjects"];
  focusPuuids?: readonly string[];
  extraOmittedEventTypes?: readonly string[];
}) {
  const champions = buildChampionLookup(match);
  const participants = buildParticipants(match);
  const timelineEnd = timelineEndMs(timeline);
  const windows = goldSwingWindows(timeline, participants, timelineEnd);
  const fallbackWindows = windows.length ? windows : [{ startMs: 0, endMs: timelineEnd }];
  const items = extractWindowRanges(timeline, fallbackWindows, champions);
  const subjects: SubjectInfo[] = [
    {
      key: "Subject A",
      participant: findSubject(participants, inputSubjects?.a ?? { puuid: userPuuid }),
      fallbackChampion: inputSubjects?.a?.champion,
    },
    {
      key: "Subject B",
      participant: findSubject(participants, inputSubjects?.b),
      fallbackChampion: inputSubjects?.b?.champion,
    },
  ];
  const subjectIds = new Set(
    [
      ...subjects.map((subject) => subject.participant),
      ...focusPuuids
        .map((puuid) => findSubject(participants, { puuid })?.participant)
        .filter(Boolean),
    ]
      .map((participant) => participant?.participantId)
      .filter((id): id is number => typeof id === "number"),
  );

  return buildWindowResponseFromItems({
    startMs: fallbackWindows[0]?.startMs ?? 0,
    endMs: fallbackWindows[fallbackWindows.length - 1]?.endMs ?? timelineEnd,
    timeline,
    participants,
    items,
    subjectIds,
    trimToRelevantEvidence: false,
    extraOmittedEventTypes,
    focusWindows: windows,
  });
}

function buildJudgePrompt({
  brief,
  locale,
  championLocalization = "",
  subjectAChampion,
  subjectBChampion,
  verdictMode = "duel",
  freeForAllTeam = [],
  promptVariant = "standard",
}: {
  brief: string;
  locale: Locale;
  championLocalization?: string;
  subjectAChampion?: string;
  subjectBChampion?: string;
  verdictMode?: "duel" | "free-for-all";
  freeForAllTeam?: readonly FreeForAllPlayerInput[];
  promptVariant?: "standard" | "v2";
}) {
  const subjects = {
    subjectA: subjectAChampion ?? "",
    subjectB: subjectBChampion ?? "",
  };
  const teamRoster = freeForAllTeam.length
    ? freeForAllTeam.map((player) => `- ${player.champion}`).join("\n")
    : "- Selected defeated-team roster unavailable.";
  const upperPrompt =
    promptVariant === "v2"
      ? substituteSubjects(
          buildV2UpperPrompt({
            verdictMode,
            champions: freeForAllTeam.map((player) => player.champion),
          }),
          subjects,
        )
      : verdictMode === "free-for-all"
        ? buildFreeForAllUpperPrompt(freeForAllTeam.map((player) => player.champion))
        : substituteSubjects(UPPER_PROMPT, subjects);
  const lowerPrompt =
    promptVariant === "v2"
      ? substituteSubjects(
          buildV2LowerPrompt({
            locale,
            championLocalization,
            verdictMode,
            teamRoster,
          }),
          subjects,
        )
      : verdictMode === "free-for-all"
        ? buildFreeForAllLowerPrompt(locale, championLocalization, teamRoster)
        : substituteSubjects(buildLowerPrompt(locale, championLocalization), subjects);
  const prompt = [upperPrompt, "", brief, "", lowerPrompt].join("\n");
  return { upperPrompt, brief, lowerPrompt, prompt };
}

async function buildServerPromptPayload({
  brief,
  locale = "en",
  match,
  subjects,
  verdictMode = "duel",
  freeForAllTeam,
  promptVariant = "standard",
}: {
  brief: string;
  locale?: Locale;
  match: MatchPayload;
  subjects?: z.infer<typeof TimelineWindowInputSchema>["subjects"];
  verdictMode?: "duel" | "free-for-all";
  freeForAllTeam?: readonly FreeForAllPlayerInput[];
  promptVariant?: "standard" | "v2";
}) {
  const championLocalization = await buildServerChampionLocalization({
    locale,
    match,
  });

  return buildJudgePrompt({
    brief,
    locale,
    championLocalization,
    subjectAChampion: subjects?.a?.champion,
    subjectBChampion: subjects?.b?.champion,
    verdictMode,
    freeForAllTeam,
    promptVariant,
  });
}

type AiGatewayUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};

type AiGatewayCostEstimate = {
  usd?: number;
  cacheHitInputTokens?: number;
  cacheMissInputTokens?: number;
  outputTokens?: number;
  note?: string;
};

type AiGatewayResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
  usage?: AiGatewayUsage;
  content?: string;
  reasoningContent?: string;
  thinking?: { enabled: boolean; effort: "high" | "max" };
  finishReason?: string;
  costEstimate?: AiGatewayCostEstimate;
  maxTokens?: number;
  raw?: unknown;
};

function createStoredVerdictId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeVerdictToken(value: string): string {
  return value.replace(/[^a-z0-9가-힣]/gi, "").toLowerCase();
}

function participantDisplayName(participant: Record<string, unknown>): string | undefined {
  const gameName = typeof participant.riotIdGameName === "string" ? participant.riotIdGameName : "";
  const tagLine = typeof participant.riotIdTagline === "string" ? participant.riotIdTagline : "";
  if (gameName && tagLine) return `${gameName}#${tagLine}`;
  if (gameName) return gameName;
  return typeof participant.summonerName === "string" ? participant.summonerName : undefined;
}

function storedPlayerFromParticipant(participant: Record<string, unknown>): StoredVerdictPlayer {
  return {
    champion:
      typeof participant.championName === "string" && participant.championName
        ? participant.championName
        : "Unknown",
    championLabel:
      typeof participant.championName === "string" && participant.championName
        ? participant.championName
        : undefined,
    summoner: participantDisplayName(participant),
    kills: typeof participant.kills === "number" ? participant.kills : undefined,
    deaths: typeof participant.deaths === "number" ? participant.deaths : undefined,
    assists: typeof participant.assists === "number" ? participant.assists : undefined,
  };
}

function findMatchParticipant(
  match: MatchPayload,
  selector?: { puuid?: string; champion?: string },
): Record<string, unknown> | undefined {
  const participants = (match.info?.participants ?? []) as Array<Record<string, unknown>>;
  if (!selector) return undefined;
  if (selector.puuid) {
    const byPuuid = participants.find((participant) => participant.puuid === selector.puuid);
    if (byPuuid) return byPuuid;
  }
  if (selector.champion) {
    const target = normalizeVerdictToken(selector.champion);
    return participants.find(
      (participant) =>
        typeof participant.championName === "string" &&
        normalizeVerdictToken(participant.championName) === target,
    );
  }
  return undefined;
}

function buildCanonicalFreeForAllTeam(
  match: MatchPayload,
  requestedTeam?: readonly FreeForAllPlayerInput[],
): FreeForAllPlayerInput[] {
  if (!requestedTeam || requestedTeam.length < 3 || requestedTeam.length > 5) {
    throw new Error("Free-for-all verdicts require 3 to 5 selected defeated-team players.");
  }

  const selectedParticipants: Array<Record<string, unknown>> = [];
  const selectedKeys = new Set<string>();

  for (const requestedPlayer of requestedTeam) {
    const participant = findMatchParticipant(match, requestedPlayer);
    if (!participant) {
      throw new Error("Selected Free-for-All player was not found in this match.");
    }

    const participantKey =
      typeof participant.puuid === "string"
        ? `puuid:${participant.puuid}`
        : `champion:${String(participant.championName ?? "")}`;
    if (selectedKeys.has(participantKey)) {
      throw new Error("Free-for-all verdicts require unique selected players.");
    }

    selectedKeys.add(participantKey);
    selectedParticipants.push(participant);
  }

  if (selectedParticipants.some((participant) => participant.win !== false)) {
    throw new Error(
      "Free-for-all verdicts can only judge selected players from the defeated team.",
    );
  }

  const selectedTeamIds = new Set(
    selectedParticipants
      .map((participant) => (typeof participant.teamId === "number" ? participant.teamId : null))
      .filter((teamId): teamId is number => teamId != null),
  );
  if (selectedTeamIds.size !== 1) {
    throw new Error("Free-for-all verdicts require selected players from one defeated team.");
  }

  return selectedParticipants.map((participant) => ({
    champion:
      typeof participant.championName === "string" && participant.championName
        ? participant.championName
        : "Unknown",
    puuid: typeof participant.puuid === "string" ? participant.puuid : undefined,
    role: typeof participant.teamPosition === "string" ? participant.teamPosition : undefined,
    summoner: participantDisplayName(participant),
  }));
}

function buildStoredVerdictPlayers(
  match: MatchPayload,
  data: z.infer<typeof JudgeVerdictInputSchema>,
  canonicalFreeForAllTeam?: readonly FreeForAllPlayerInput[],
): StoredVerdictPlayer[] {
  const selectors =
    data.verdictMode === "free-for-all"
      ? (canonicalFreeForAllTeam?.map((player) => ({
          puuid: player.puuid,
          champion: player.champion,
          summoner: player.summoner,
        })) ?? [])
      : [
          { puuid: data.subjects?.a?.puuid, champion: data.subjects?.a?.champion },
          { puuid: data.subjects?.b?.puuid, champion: data.subjects?.b?.champion },
        ];

  return selectors
    .map((selector) => {
      const participant = findMatchParticipant(match, selector);
      if (participant) return storedPlayerFromParticipant(participant);
      if (!selector.champion) return null;
      return {
        champion: selector.champion,
        championLabel: selector.champion,
        summoner: (selector as { summoner?: string }).summoner,
      };
    })
    .filter((player): player is StoredVerdictPlayer => player !== null)
    .slice(0, 5);
}

function parseStoredVerdict(
  output: string,
  selectedPlayers: StoredVerdictPlayer[],
): { verdictDisplay: StoredVerdictDisplay; reasoning: string } {
  const lines = output.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex === -1) {
    return { verdictDisplay: { championName: "Unknown" }, reasoning: output };
  }

  const verdictLine = lines[firstContentIndex].trim();
  const verdictToken = normalizeVerdictToken(verdictLine);
  const matched = selectedPlayers.find((player) => {
    const champion = normalizeVerdictToken(player.champion);
    const championLabel = normalizeVerdictToken(player.championLabel ?? "");
    const summoner = normalizeVerdictToken(player.summoner ?? "");
    return [champion, championLabel, summoner].some((token) => token && token === verdictToken);
  });
  const reasoning = [...lines.slice(0, firstContentIndex), ...lines.slice(firstContentIndex + 1)]
    .join("\n")
    .trim();

  return {
    verdictDisplay: matched
      ? {
          championName: matched.championLabel ?? matched.champion,
          championKey: matched.champion,
          summonerName: matched.summoner,
        }
      : { championName: verdictLine },
    reasoning: reasoning || output,
  };
}

async function storeVerdictResult({
  matchId,
  locale,
  verdictMode,
  selectedPlayers,
  verdictDisplay,
  reasoning,
  userId,
  userDisplay,
}: {
  matchId: string;
  locale: Locale;
  verdictMode: "duel" | "free-for-all";
  selectedPlayers: StoredVerdictPlayer[];
  verdictDisplay: StoredVerdictDisplay;
  reasoning: string;
  userId: string | null;
  userDisplay: string;
}): Promise<string> {
  const expiresAt = new Date(Date.now() + 72 * 60 * 60_000).toISOString();
  const id = createStoredVerdictId();
  const { error } = await supabaseAdmin.from("verdict_results").insert({
    id,
    expires_at: expiresAt,
    match_id: matchId,
    locale,
    verdict_mode: verdictMode,
    selected_players: selectedPlayers as unknown as never,
    verdict_display: verdictDisplay as unknown as never,
    reasoning,
    user_id: userId,
    user_display: userDisplay,
  });

  if (error) {
    console.error("[verdict-result] insert failed:", error);
    throw new Error("Failed to save verdict result. Please try again.");
  }

  return id;
}

async function resolveVerdictResultOwner(accessToken?: string): Promise<{
  userId: string | null;
  userDisplay: string;
}> {
  if (!accessToken) return { userId: null, userDisplay: "Visitor" };

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) return { userId: null, userDisplay: "Visitor" };

  return {
    userId: data.user.id,
    userDisplay: data.user.email ?? `User ${data.user.id}`,
  };
}

type VerdictAnalyticsEvent = {
  success: boolean;
  matchId: string;
  scope: "full" | "window" | "v2-full";
  routingRegion: RegionalRouting;
  locale: Locale;
  model?: string;
  thinking?: { enabled: boolean; effort: "high" | "max" };
  finishReason?: string;
  errorType?: string;
  gameLengthMs: number;
  requestedWindowMs?: number;
  actualContextWindowMs: number;
  usage?: AiGatewayUsage;
  costEstimate?: AiGatewayCostEstimate | null;
  maxTokens: number;
  durationMs: number;
};

function numberOrZero(value: number | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0;
}

function safeBlob(value: string | number | boolean | undefined): string {
  if (value == null) return "";
  return String(value).slice(0, 256);
}

async function writeVerdictAnalytics(event: VerdictAnalyticsEvent) {
  try {
    const { env } = await import("cloudflare:workers");
    const analytics = env.analytic_engine;
    if (!analytics) return;

    const usage = event.usage;
    analytics.writeDataPoint({
      indexes: ["verdict_request"],
      blobs: [
        "verdict_request",
        safeBlob(event.success),
        event.scope,
        event.routingRegion,
        event.locale,
        safeBlob(event.model),
        safeBlob(event.thinking?.enabled),
        safeBlob(event.thinking?.effort),
        safeBlob(event.finishReason),
        safeBlob(event.errorType),
        safeBlob(event.matchId),
      ],
      doubles: [
        event.gameLengthMs / 1000,
        (event.requestedWindowMs ?? 0) / 1000,
        event.actualContextWindowMs / 1000,
        numberOrZero(usage?.prompt_tokens),
        numberOrZero(usage?.completion_tokens),
        numberOrZero(usage?.total_tokens),
        numberOrZero(usage?.prompt_tokens_details?.cached_tokens),
        numberOrZero(usage?.completion_tokens_details?.reasoning_tokens),
        numberOrZero(usage?.prompt_cache_hit_tokens),
        numberOrZero(usage?.prompt_cache_miss_tokens),
        event.costEstimate?.usd ?? 0,
        event.durationMs,
        event.maxTokens,
      ],
    });
  } catch (error) {
    console.warn(
      "Failed to write verdict analytics.",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function combineAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };

  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }

  return controller.signal;
}

async function callAiGateway(
  prompt: string,
  requestSignal?: AbortSignal,
): Promise<{
  content: string;
  reasoningContent?: string;
  usage?: AiGatewayUsage;
  model?: string;
  thinking?: { enabled: boolean; effort: "high" | "max" };
  finishReason?: string;
  costEstimate?: AiGatewayCostEstimate | null;
  maxTokens?: number;
  raw: AiGatewayResponse;
}> {
  const timeoutController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, 120_000);
  const signal = combineAbortSignals([requestSignal, timeoutController.signal]);
  let res: Response;
  try {
    res = await fetch(aiGatewayUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiGatewayToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        requestId: crypto.randomUUID(),
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        timedOut ? "AI request timed out. Please try again." : "AI verdict request was cancelled.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    let gatewayError: string | undefined;
    try {
      const payload = (await res.clone().json()) as { error?: unknown };
      gatewayError = typeof payload.error === "string" ? payload.error : undefined;
    } catch {
      gatewayError = undefined;
    }

    if (gatewayError) {
      console.error("[ai-gateway] request failed", {
        status: res.status,
        error: gatewayError,
      });
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error("AI service is unavailable. Please try again later.");
    }
    if (res.status === 429) {
      throw new Error("AI rate limit reached. Please wait and try again.");
    }
    throw new Error("AI request failed. Please try again.");
  }

  const raw = (await res.json()) as AiGatewayResponse;
  const message = raw.choices?.[0]?.message;
  const content = (raw.content ?? message?.content)?.trim();
  if (!content) throw new Error("AI returned an empty verdict.");

  return {
    content,
    reasoningContent: raw.reasoningContent ?? message?.reasoning_content,
    usage: raw.usage,
    model: raw.model,
    thinking: raw.thinking,
    finishReason: raw.finishReason ?? raw.choices?.[0]?.finish_reason,
    costEstimate: raw.costEstimate,
    maxTokens: raw.maxTokens,
    raw,
  };
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
    if (span < MIN_WINDOW_MS) throw new Error("Window must be at least 5 minutes.");
    if (span > MAX_WINDOW_MS) throw new Error("Window must be at most 10 minutes.");

    const routing = inferRouting(data.matchId, data.routingRegion);
    const base = `https://${routing}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(
      data.matchId,
    )}`;

    const [match, timeline] = await Promise.all([
      riotGet<MatchPayload>(base),
      riotGet<TimelinePayload>(`${base}/timeline`),
    ]);
    const timelineEnd = timelineEndMs(timeline);
    const verdictMode = data.verdictMode ?? "duel";
    const canonicalFreeForAllTeam =
      verdictMode === "free-for-all"
        ? buildCanonicalFreeForAllTeam(match, data.freeForAllTeam)
        : undefined;
    const focusPuuids =
      verdictMode === "free-for-all"
        ? canonicalFreeForAllTeam
            ?.map((player) => player.puuid)
            .filter((puuid): puuid is string => typeof puuid === "string" && puuid.length > 0)
        : data.focusPuuids;

    const response = buildWindowResponse({
      startMs: contextStartMinuteMs(data.startMs),
      endMs: contextEndMs(data.endMs, timelineEnd),
      match,
      timeline,
      userPuuid: data.userPuuid,
      subjects: data.subjects,
      focusPuuids,
    });
    const prompt = await buildServerPromptPayload({
      brief: response.brief,
      locale: data.locale ?? "en",
      match,
      subjects: data.subjects,
      verdictMode,
      freeForAllTeam: canonicalFreeForAllTeam,
    });

    return { ...response, prompt };
  });

export const getTimelineFullGame = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => TimelineFullGameInputSchema.parse(input))
  .handler(async ({ data }) => {
    assertContextInspectionAllowed();
    assertRateLimit({
      scope: "timeline-full-game",
      limit: 4,
      windowMs: ONE_MINUTE_MS,
      message: "Too many full-game context requests. Please wait a minute and try again.",
    });

    const routing = inferRouting(data.matchId, data.routingRegion);
    const base = `https://${routing}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(
      data.matchId,
    )}`;

    const [match, timeline] = await Promise.all([
      riotGet<MatchPayload>(base),
      riotGet<TimelinePayload>(`${base}/timeline`),
    ]);
    const endMs = timelineEndMs(timeline);
    if (endMs > MAX_FULL_GAME_CONTEXT_MS) {
      throw new Error(
        "[FULL_GAME_TOO_LONG] Full-game context is unavailable for matches over 60 minutes. Use Specify Time instead.",
      );
    }
    const verdictMode = data.verdictMode ?? "duel";
    const canonicalFreeForAllTeam =
      verdictMode === "free-for-all"
        ? buildCanonicalFreeForAllTeam(match, data.freeForAllTeam)
        : undefined;
    const focusPuuids =
      verdictMode === "free-for-all"
        ? canonicalFreeForAllTeam
            ?.map((player) => player.puuid)
            .filter((puuid): puuid is string => typeof puuid === "string" && puuid.length > 0)
        : data.focusPuuids;

    const response = buildWindowResponse({
      startMs: 0,
      endMs,
      match,
      timeline,
      userPuuid: data.userPuuid,
      subjects: data.subjects,
      focusPuuids,
      trimToRelevantEvidence: false,
      extraOmittedEventTypes: ["PAUSE_END"],
    });
    const prompt = await buildServerPromptPayload({
      brief: response.brief,
      locale: data.locale ?? "en",
      match,
      subjects: data.subjects,
      verdictMode,
      freeForAllTeam: canonicalFreeForAllTeam,
    });

    return { ...response, prompt };
  });

export const getTimelineGoldSwingFullGame = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => TimelineGoldSwingFullGameInputSchema.parse(input))
  .handler(async ({ data }) => {
    assertContextInspectionAllowed();
    assertRateLimit({
      scope: "timeline-v2-full-game",
      limit: 4,
      windowMs: ONE_MINUTE_MS,
      message: "Too many V2 full-game context requests. Please wait a minute and try again.",
    });

    const routing = inferRouting(data.matchId, data.routingRegion);
    const base = `https://${routing}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(
      data.matchId,
    )}`;

    const [match, timeline] = await Promise.all([
      riotGet<MatchPayload>(base),
      riotGet<TimelinePayload>(`${base}/timeline`),
    ]);
    const endMs = timelineEndMs(timeline);
    if (endMs > MAX_FULL_GAME_CONTEXT_MS) {
      throw new Error(
        "[FULL_GAME_TOO_LONG] V2 full-game context is unavailable for matches over 60 minutes. Use Specify Time instead.",
      );
    }
    const verdictMode = data.verdictMode ?? "duel";
    const canonicalFreeForAllTeam =
      verdictMode === "free-for-all"
        ? buildCanonicalFreeForAllTeam(match, data.freeForAllTeam)
        : undefined;
    const focusPuuids =
      verdictMode === "free-for-all"
        ? canonicalFreeForAllTeam
            ?.map((player) => player.puuid)
            .filter((puuid): puuid is string => typeof puuid === "string" && puuid.length > 0)
        : data.focusPuuids;

    const response = buildGoldSwingFullGameResponse({
      match,
      timeline,
      userPuuid: data.userPuuid,
      subjects: data.subjects,
      focusPuuids,
      extraOmittedEventTypes: ["PAUSE_END"],
    });
    const prompt = await buildServerPromptPayload({
      brief: response.brief,
      locale: data.locale ?? "en",
      match,
      subjects: data.subjects,
      verdictMode,
      freeForAllTeam: canonicalFreeForAllTeam,
      promptVariant: "v2",
    });

    return { ...response, prompt };
  });

export const getJudgeVerdict = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => JudgeVerdictInputSchema.parse(input))
  .handler(async ({ data }) => {
    const requestStartedAt = Date.now();
    const requestSignal = getRequest().signal;
    if (data.includeRaw) assertContextInspectionAllowed();
    if (data.scope !== "v2-full") assertContextInspectionAllowed();
    assertRateLimit({
      scope: "judge-verdict",
      limit: 4,
      windowMs: ONE_MINUTE_MS,
      message: "Too many AI verdict requests. Please wait a minute and try again.",
    });
    if (!data.includeRaw) await assertTurnstile(data.turnstileToken);
    if (data.scope === "window") {
      if (data.startMs == null || data.endMs == null) {
        throw new Error("Specify Time verdict requires startMs and endMs.");
      }
      const span = data.endMs - data.startMs;
      if (span < MIN_WINDOW_MS) throw new Error("Window must be at least 5 minutes.");
      if (span > MAX_WINDOW_MS) throw new Error("Window must be at most 10 minutes.");
    }

    const routing = inferRouting(data.matchId, data.routingRegion);
    const base = `https://${routing}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(
      data.matchId,
    )}`;

    const [match, timeline] = await Promise.all([
      riotGet<MatchPayload>(base),
      riotGet<TimelinePayload>(`${base}/timeline`),
    ]);
    const timelineEnd = timelineEndMs(timeline);
    if (timelineEnd < MIN_WINDOW_MS) {
      throw new Error("[GAME_TOO_SHORT] AI verdicts are unavailable for games under 5 minutes.");
    }
    const requestedWindowMs =
      data.scope === "window" ? (data.endMs as number) - (data.startMs as number) : undefined;
    const actualContextStartMs =
      data.scope === "full" || data.scope === "v2-full"
        ? 0
        : contextStartMinuteMs(data.startMs as number);
    const actualContextEndMs =
      data.scope === "full" || data.scope === "v2-full"
        ? timelineEnd
        : contextEndMs(data.endMs as number, timelineEnd);
    const verdictMode = data.verdictMode ?? "duel";
    const canonicalFreeForAllTeam =
      verdictMode === "free-for-all"
        ? buildCanonicalFreeForAllTeam(match, data.freeForAllTeam)
        : undefined;
    const focusPuuids =
      verdictMode === "free-for-all"
        ? canonicalFreeForAllTeam
            ?.map((player) => player.puuid)
            .filter((puuid): puuid is string => typeof puuid === "string" && puuid.length > 0)
        : undefined;

    const windowResponse =
      data.scope === "v2-full"
        ? (() => {
            if (timelineEnd > MAX_FULL_GAME_CONTEXT_MS) {
              throw new Error(
                "[FULL_GAME_TOO_LONG] V2 full-game context is unavailable for matches over 60 minutes. Use Specify Time instead.",
              );
            }
            return buildGoldSwingFullGameResponse({
              match,
              timeline,
              userPuuid: data.userPuuid,
              subjects: data.subjects,
              focusPuuids,
              extraOmittedEventTypes: ["PAUSE_END"],
            });
          })()
        : data.scope === "full"
          ? (() => {
              if (timelineEnd > MAX_FULL_GAME_CONTEXT_MS) {
                throw new Error(
                  "[FULL_GAME_TOO_LONG] Full-game context is unavailable for matches over 60 minutes. Use Specify Time instead.",
                );
              }
              return buildWindowResponse({
                startMs: actualContextStartMs,
                endMs: actualContextEndMs,
                match,
                timeline,
                userPuuid: data.userPuuid,
                subjects: data.subjects,
                focusPuuids,
                trimToRelevantEvidence: false,
                extraOmittedEventTypes: ["PAUSE_END"],
              });
            })()
          : buildWindowResponse({
              startMs: actualContextStartMs,
              endMs: actualContextEndMs,
              match,
              timeline,
              userPuuid: data.userPuuid,
              subjects: data.subjects,
              focusPuuids,
            });

    const promptPayload = await buildServerPromptPayload({
      brief: windowResponse.brief,
      locale: data.locale ?? "en",
      match,
      subjects: data.subjects,
      verdictMode,
      freeForAllTeam: canonicalFreeForAllTeam,
      promptVariant: data.scope === "v2-full" ? "v2" : "standard",
    });
    let quotaReserved = false;
    if (!data.includeRaw) {
      const { consumeVerdictQuota } = await import("@/functions/verdict-quota.server");
      await consumeVerdictQuota({
        accessToken: data.accessToken,
        anonymousId: data.anonymousId,
      });
      quotaReserved = true;
    }

    let aiResult: Awaited<ReturnType<typeof callAiGateway>>;
    try {
      aiResult = await callAiGateway(promptPayload.prompt, requestSignal);
    } catch (error) {
      if (quotaReserved) {
        try {
          const { refundVerdictQuota } = await import("@/functions/verdict-quota.server");
          await refundVerdictQuota({
            accessToken: data.accessToken,
            anonymousId: data.anonymousId,
          });
        } catch (refundError) {
          console.warn(
            "Failed to refund verdict quota.",
            refundError instanceof Error ? refundError.message : String(refundError),
          );
        }
      }
      await writeVerdictAnalytics({
        success: false,
        matchId: data.matchId,
        scope: data.scope,
        routingRegion: routing,
        locale: data.locale ?? "en",
        errorType: error instanceof Error ? error.message : "unknown_error",
        gameLengthMs: timelineEnd,
        requestedWindowMs,
        actualContextWindowMs: actualContextEndMs - actualContextStartMs,
        maxTokens: 0,
        durationMs: Date.now() - requestStartedAt,
      });
      throw error;
    }
    const includeDiagnostics = data.includeRaw === true;
    const costEstimate = aiResult.costEstimate ?? null;
    const selectedPlayers = buildStoredVerdictPlayers(match, data, canonicalFreeForAllTeam);
    const storedVerdict = parseStoredVerdict(aiResult.content, selectedPlayers);
    let verdictResultId: string | undefined;
    if (!includeDiagnostics) {
      try {
        const owner = await resolveVerdictResultOwner(data.accessToken);
        verdictResultId = await storeVerdictResult({
          matchId: data.matchId,
          locale: data.locale ?? "en",
          verdictMode,
          selectedPlayers,
          verdictDisplay: storedVerdict.verdictDisplay,
          reasoning: storedVerdict.reasoning,
          userId: owner.userId,
          userDisplay: owner.userDisplay,
        });
      } catch (error) {
        console.error(
          "[verdict-result] continuing without shareable verdict result:",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    await writeVerdictAnalytics({
      success: true,
      matchId: data.matchId,
      scope: data.scope,
      routingRegion: routing,
      locale: data.locale ?? "en",
      model: aiResult.model,
      thinking: aiResult.thinking,
      finishReason: aiResult.finishReason,
      gameLengthMs: timelineEnd,
      requestedWindowMs,
      actualContextWindowMs: actualContextEndMs - actualContextStartMs,
      usage: aiResult.usage,
      costEstimate,
      maxTokens: aiResult.maxTokens ?? 0,
      durationMs: Date.now() - requestStartedAt,
    });
    const raw = includeDiagnostics ? aiResult.raw : undefined;

    if (!includeDiagnostics) {
      return {
        content: aiResult.content,
        verdictResultId,
      };
    }

    return {
      content: aiResult.content,
      reasoningContent: aiResult.reasoningContent,
      model: aiResult.model,
      thinking: aiResult.thinking,
      usage: aiResult.usage,
      costEstimate,
      raw,
      prompt: promptPayload,
      context: windowResponse,
      verdictResultId,
    };
  });
