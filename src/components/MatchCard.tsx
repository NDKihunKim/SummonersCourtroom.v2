import { JudgeLoading, type PipelineStep } from "./JudgeLoading";
import { SharedVerdictResult, Verdict } from "./VerdictPanel";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Gavel, ArrowLeft, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { Match, Participant } from "@/lib/match-types";
import { ChampionIcon } from "./ChampionIcon";
import { MatchupHeader } from "./MatchupHeader";
import { ItemGrid } from "./ItemGrid";
import { SummonerSpells } from "./SummonerSpells";
import { RuneIcons } from "./RuneIcons";
import { RosterColumns } from "./RosterColumns";
import { ExpandToggle } from "./ExpandToggle";
import { ScopeSpecifyTime } from "./ScopeSpecifyTime";
import { ScopeActions } from "./ScopeActions";
import { ModeButton, PlayerTile } from "./PickAllyHelpers";
import { PickAlly } from "./PickAlly";
import { MatchScoreboard } from "./MatchScoreboard";
import { getJudgeVerdict } from "@/functions/timeline-window.functions";
import {
  createSharedVerdict,
  type SharedVerdictPayload,
} from "@/functions/shared-verdict.functions";
import { submitVerdictFeedback } from "@/functions/verdict-feedback.functions";
import { useChampionNameFormatter } from "@/lib/ddragon";
import { sortByRole } from "@/lib/role-order";
import { formatRelativePlayedAt } from "@/lib/relative-time";
import type { Shard } from "@/lib/regions";
import type { Locale, TranslationKey } from "@/i18n";
import { TurnstileWidget, type TurnstileHandle } from "./TurnstileWidget";
import { supabase } from "@/integrations/supabase/client";
import { getAnonymousId } from "@/lib/anonymous-id";

type Stage = "closed" | "pickAlly" | "pickScope" | "specifyTime" | "loading" | "verdict";
// PipelineStep is now imported from ./JudgeLoading
type Scope = "full" | "window" | "v2-full";
type FaultMode = "me-vs-1" | "one-vs-one" | "free-for-all" | "switch-teams";
type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;
type VerdictDisplay = { championName: string; championKey?: string; summonerName?: string };
type ReasoningChoice = { index: number; text: string; explanation?: string };
type FreeForAllContextPlayer = {
  champion: string;
  puuid?: string;
  role?: string;
  summoner?: string;
};

const SHOW_DEV_CONTEXT = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_CONTEXT === "true";
const MIN_VERDICT_GAME_MS = 5 * 60_000;
const MAX_FULL_GAME_VERDICT_MS = 60 * 60_000;
const MIN_CONTEXTUALIZE_LOADING_MS = 1800;
const PERSISTED_VERDICT_VERSION = 1;
const PERSISTED_VERDICT_TTL_MS = 30 * 60_000;

type PersistedVerdictState = {
  version: typeof PERSISTED_VERDICT_VERSION;
  createdAt: number;
  matchId: string;
  userPuuid?: string;
  locale: Locale;
  faultMode: FaultMode;
  showEnemyTeam: boolean;
  pickedSubjectA: Participant | null;
  pickedAlly: Participant;
  freeForAllSelection: Participant[];
  reasoning: string;
  verdictDisplay: VerdictDisplay | null;
  verdictScope: Scope | null;
  verdictWindow: [number, number] | null;
  verdictResultId: string | null;
  shareUrl: string | null;
};

function verdictStorageKey(match: Match): string {
  return `summoners-courtroom:verdict-result:v1:${match.riotMatchId ?? match.id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isParticipant(value: unknown): value is Participant {
  return (
    isRecord(value) &&
    typeof value.champion === "string" &&
    typeof value.summoner === "string" &&
    typeof value.kills === "number" &&
    typeof value.deaths === "number" &&
    typeof value.assists === "number"
  );
}

function isVerdictDisplay(value: unknown): value is VerdictDisplay {
  return (
    isRecord(value) &&
    typeof value.championName === "string" &&
    (value.championKey === undefined || typeof value.championKey === "string") &&
    (value.summonerName === undefined || typeof value.summonerName === "string")
  );
}

function isScope(value: unknown): value is Scope {
  return value === "full" || value === "window" || value === "v2-full";
}

function isFaultMode(value: unknown): value is FaultMode {
  return (
    value === "me-vs-1" ||
    value === "one-vs-one" ||
    value === "free-for-all" ||
    value === "switch-teams"
  );
}

function isVerdictWindow(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function parsePersistedVerdictState(raw: string | null): PersistedVerdictState | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) return null;
    if (value.version !== PERSISTED_VERDICT_VERSION) return null;
    if (typeof value.createdAt !== "number") return null;
    if (Date.now() - value.createdAt > PERSISTED_VERDICT_TTL_MS) return null;
    if (typeof value.matchId !== "string") return null;
    if (value.userPuuid !== undefined && typeof value.userPuuid !== "string") return null;
    if (value.locale !== "en" && value.locale !== "ko") return null;
    if (!isFaultMode(value.faultMode)) return null;
    if (typeof value.showEnemyTeam !== "boolean") return null;
    if (value.pickedSubjectA !== null && !isParticipant(value.pickedSubjectA)) return null;
    if (!isParticipant(value.pickedAlly)) return null;
    if (
      !Array.isArray(value.freeForAllSelection) ||
      !value.freeForAllSelection.every(isParticipant)
    ) {
      return null;
    }
    if (typeof value.reasoning !== "string" || value.reasoning.trim().length === 0) return null;
    if (value.verdictDisplay !== null && !isVerdictDisplay(value.verdictDisplay)) return null;
    if (value.verdictScope !== null && !isScope(value.verdictScope)) return null;
    if (value.verdictWindow !== null && !isVerdictWindow(value.verdictWindow)) return null;
    if (value.verdictResultId !== null && typeof value.verdictResultId !== "string") return null;
    if (value.shareUrl !== null && typeof value.shareUrl !== "string") return null;

    return value as PersistedVerdictState;
  } catch {
    return null;
  }
}

function readPersistedVerdictState(key: string): PersistedVerdictState | null {
  const read = (storage: Storage) => {
    const saved = parsePersistedVerdictState(storage.getItem(key));
    if (!saved) storage.removeItem(key);
    return saved;
  };

  try {
    const saved = read(window.sessionStorage);
    if (saved) return saved;
  } catch {
    // Fall back to localStorage below.
  }

  try {
    return read(window.localStorage);
  } catch {
    return null;
  }
}

function writePersistedVerdictState(key: string, payload: PersistedVerdictState) {
  const serialized = JSON.stringify(payload);
  try {
    window.sessionStorage.setItem(key, serialized);
  } catch {
    // Ignore storage failures; persistence is only for auth redirects.
  }

  try {
    window.localStorage.setItem(key, serialized);
  } catch {
    // Ignore storage failures; the in-memory verdict flow still works.
  }
}

function removePersistedVerdictState(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore storage failures; the in-memory verdict flow still works.
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures; the in-memory verdict flow still works.
  }
}

function toFreeForAllContextPlayer(player: Participant): FreeForAllContextPlayer {
  return {
    champion: player.champion,
    puuid: player.puuid,
    role: player.teamPosition,
    summoner: player.summoner,
  };
}

function isAbortLikeError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function getReadableVerdictError(error: unknown): string {
  if (!(error instanceof Error)) return "AI verdict request failed. Please try again.";

  const message = error.message.trim();
  if (!message) return "AI verdict request failed. Please try again.";

  const lower = message.toLowerCase();
  const looksInternal =
    lower.includes("gateway") ||
    lower.includes("api key") ||
    lower.includes("bearer") ||
    lower.includes("token") ||
    lower.includes("model") ||
    lower.includes("provider") ||
    lower.includes("stack") ||
    lower.includes("trace");

  return looksInternal ? "AI verdict request failed. Please try again." : message;
}

function addFreeForAllContextParams(params: URLSearchParams, team: Participant[]) {
  if (team.length === 0) return;
  params.set("verdictMode", "free-for-all");
  params.set("freeForAllTeam", JSON.stringify(team.map(toFreeForAllContextPlayer)));
}

const defaultT: Translate = (key, vars) => {
  const text = String(key);
  if (!vars) return text;
  return Object.entries(vars).reduce(
    (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
    text,
  );
};

function MobileRosterList({
  label,
  players,
  accent,
  onPlayerClick,
  formatChampionName,
  highlightedPlayerKey,
}: {
  label: string;
  players: Participant[];
  accent: string;
  onPlayerClick?: (summoner: string) => void;
  formatChampionName: (champion: string) => string;
  highlightedPlayerKey: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border/60 bg-background/35 p-2">
      <div className={`mb-2 text-[10px] font-semibold uppercase tracking-wider ${accent}`}>
        {label}
      </div>
      <div className="space-y-1">
        {players.map((player, index) => {
          const playerKey = player.puuid ?? player.summoner?.toLowerCase() ?? "";
          const isHighlighted = Boolean(highlightedPlayerKey && playerKey === highlightedPlayerKey);
          const content = (
            <>
              <ChampionIcon
                champion={player.champion}
                size={18}
                ring={false}
                className="shrink-0"
              />
              <span className="min-w-0 flex-1 truncate text-left text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {formatChampionName(player.champion)}
                </span>
                <span className="mx-1 text-muted-foreground/70">·</span>
                <span className={isHighlighted ? "font-semibold text-gold/80" : ""}>
                  {player.summoner}
                </span>
              </span>
            </>
          );
          const rowClass =
            "flex h-7 w-full min-w-0 items-center gap-1.5 rounded px-1.5 text-left transition-colors";

          return onPlayerClick ? (
            <button
              key={`${player.summoner}-${index}`}
              type="button"
              className={`${rowClass} hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold`}
              title={player.summoner}
              onClick={() => {
                const name = player.summoner?.trim();
                if (!name) return;
                onPlayerClick(name);
              }}
            >
              {content}
            </button>
          ) : (
            <div key={`${player.summoner}-${index}`} className={rowClass} title={player.summoner}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const QUEUE_KEYS: Array<[RegExp, TranslationKey]> = [
  [/ranked\s+solo/i, "queueRankedSolo"],
  [/ranked\s+flex/i, "queueRankedFlex"],
  [/normal\s+draft|swiftplay|queue\s+480/i, "queueNormalGame"],
  [/normal\s+blind/i, "queueNormalBlind"],
  [/\baram\b/i, "queueAram"],
  [/\barena\b/i, "queueArena"],
  [/quickplay/i, "queueQuickplay"],
];

function formatQueue(queue: string, locale: Locale, t: Translate): string {
  const key = QUEUE_KEYS.find(([pattern]) => pattern.test(queue))?.[1];
  if (key && (locale === "ko" || /^queue\s+\d+$/i.test(queue))) return t(key);
  return queue;
}

function formatDuration(duration: string, locale: Locale, t: Translate): string {
  if (locale !== "ko") return duration;
  const match = duration.match(/^(?:(\d+)m\s*)?(?:(\d+)s)?$/i);
  if (!match) return duration;
  const minutes = match[1] ? Number(match[1]) : 0;
  const seconds = match[2] ? Number(match[2]) : 0;
  if (minutes > 0 && seconds > 0) return t("durationMinutesSeconds", { minutes, seconds });
  if (minutes > 0) return t("durationMinutes", { minutes });
  return t("durationSeconds", { seconds });
}

function parseMatchDurationToMs(duration: string): number | null {
  const trimmed = duration.trim();

  const mAndS = trimmed.match(/^(?:(\d{1,3})m)?\s*(?:(\d{1,2})s)?$/i);
  if (mAndS && (mAndS[1] || mAndS[2])) {
    const minutes = Number(mAndS[1] ?? 0);
    const seconds = Number(mAndS[2] ?? 0);
    return seconds < 60 ? (minutes * 60 + seconds) * 1000 : null;
  }

  const colon = trimmed.match(/^(\d{1,3}):(\d{1,2})$/);
  if (colon) {
    const minutes = Number(colon[1]);
    const seconds = Number(colon[2]);
    return seconds < 60 ? (minutes * 60 + seconds) * 1000 : null;
  }

  return null;
}

function formatMsClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatWindowLength(ms: number, t: Translate): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return t("selectedWindowLength", {
    minutes: Math.floor(totalSeconds / 60),
    seconds: String(totalSeconds % 60).padStart(2, "0"),
  });
}

function formatPlayedAt(playedAt: string, locale: Locale, t: Translate): string {
  if (locale !== "ko") return playedAt;
  if (playedAt.toLowerCase() === "just now") return t("justNow");
  const match = playedAt.match(/^(\d+)\s*([smhd])\s+ago$/i);
  if (!match) return playedAt;
  const count = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "s") return t("relativeSecondsAgo", { count });
  if (unit === "m") return t("relativeMinutesAgo", { count });
  if (unit === "h") return t("relativeHoursAgo", { count });
  return t("relativeDaysAgo", { count });
}

function normalizeVerdictToken(value: string): string {
  return value.replace(/[^a-z0-9가-힣]/gi, "").toLowerCase();
}

function parseJudgeOutput(
  output: string,
  subjects: Array<{ champion: string; championLabel: string; summoner?: string }>,
): { verdict: VerdictDisplay | null; reasoning: string } {
  const lines = output.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex === -1) return { verdict: null, reasoning: output };

  const verdictLine = lines[firstContentIndex].trim();
  const verdictToken = normalizeVerdictToken(verdictLine);
  const subject = subjects.find((candidate) => {
    const candidates = [candidate.champion, candidate.championLabel, candidate.summoner ?? ""].map(
      normalizeVerdictToken,
    );
    return candidates.some((candidateToken) => candidateToken && candidateToken === verdictToken);
  });

  const reasoning = [...lines.slice(0, firstContentIndex), ...lines.slice(firstContentIndex + 1)]
    .join("\n")
    .trim();

  return {
    verdict: subject
      ? {
          championName: subject.championLabel,
          championKey: subject.champion,
          summonerName: subject.summoner,
        }
      : { championName: verdictLine },
    reasoning: reasoning || output,
  };
}

function shareErrorKey(error: unknown): TranslationKey {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Too many share requests")) return "shareFailed";
  return "shareFailed";
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }
}

export function MatchCard({
  match,
  you,
  onPlayerClick,
  profileShard,
  profileGameName,
  profileTagLine,
  openJudgeRequest = 0,
  onProfileInteraction,
  sharedVerdict,
  onSharedNewVerdict,
  locale = "en",
  t = defaultT,
}: {
  match: Match;
  /**
   * The viewing player as a Participant. Forwarded to RosterColumns so the
   * Allies column renders a full 5 (you + 4 teammates). Optional so existing
   * call sites that don't have the viewing player handy keep working.
   */
  you?: Participant;
  /**
   * Invoked when any roster row (ally or enemy) is clicked. Receives the
   * raw Riot ID string. Optional — when omitted roster rows are read-only.
   */
  onPlayerClick?: (summoner: string) => void;
  profileShard?: Shard;
  profileGameName?: string;
  profileTagLine?: string;
  openJudgeRequest?: number;
  onProfileInteraction?: (matchId: string) => void;
  sharedVerdict?: SharedVerdictPayload | null;
  onSharedNewVerdict?: () => void;
  locale?: Locale;
  t?: Translate;
}) {
  const win = match.result === "Victory";
  const kda = ((match.kills + match.assists) / Math.max(1, match.deaths)).toFixed(2);
  const formatChampionName = useChampionNameFormatter(locale);
  const resultLabel = win ? t("victory") : t("defeat");
  const queueLabel = formatQueue(match.queue, locale, t);
  const isRankedGame = match.queue === "Ranked Solo" || match.queue === "Ranked Flex";
  const durationLabel = formatDuration(match.duration, locale, t);
  const matchDurationMs = parseMatchDurationToMs(match.duration);
  const isShortVerdictGame = matchDurationMs != null && matchDurationMs < MIN_VERDICT_GAME_MS;
  const [relativeNowMs, setRelativeNowMs] = useState(() => Date.now());
  const playedAtLabel =
    typeof match.playedAtMs === "number"
      ? formatRelativePlayedAt(match.playedAtMs, relativeNowMs, locale, t)
      : formatPlayedAt(match.playedAt, locale, t);
  const championLabel = formatChampionName(match.champion);

  const [stage, setStage] = useState<Stage>("closed");
  const [faultMode, setFaultMode] = useState<FaultMode>("free-for-all");
  const [showEnemyTeam, setShowEnemyTeam] = useState(false);
  const [pickedSubjectA, setPickedSubjectA] = useState<Participant | null>(null);
  const [pickedAlly, setPickedAlly] = useState<Participant | null>(null);
  const [freeForAllSelection, setFreeForAllSelection] = useState<Participant[]>([]);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [verdictDisplay, setVerdictDisplay] = useState<VerdictDisplay | null>(null);
  const [activeStep, setActiveStep] = useState<PipelineStep>("contextualize");
  const [completed, setCompleted] = useState<Set<PipelineStep>>(new Set());
  const [verdictScope, setVerdictScope] = useState<Scope | null>(null);
  const [verdictWindow, setVerdictWindow] = useState<[number, number] | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [verdictResultId, setVerdictResultId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);
  const mockLoadingTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const verdictAbortControllerRef = useRef<AbortController | null>(null);
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || undefined;
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const lastOpenJudgeRequestRef = useRef(0);
  const persistedVerdictKey = verdictStorageKey(match);
  const resetTurnstile = useCallback(() => {
    turnstileRef.current?.reset();
    setTurnstileResetKey((key) => key + 1);
  }, []);
  const executeTurnstile = useCallback(async () => {
    if (!turnstileSiteKey) return undefined;
    if (!turnstileRef.current) {
      throw new Error("Human verification is not ready. Please try again.");
    }
    const token = await turnstileRef.current.execute();
    if (!token) throw new Error("Human verification did not complete. Please try again.");
    return token;
  }, [turnstileSiteKey]);

  useEffect(() => {
    return () => {
      mockLoadingTimersRef.current.forEach((timer) => clearTimeout(timer));
      verdictAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (typeof match.playedAtMs !== "number") return;

    setRelativeNowMs(Date.now());
    const interval = window.setInterval(() => {
      setRelativeNowMs(Date.now());
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [match.playedAtMs]);

  const expanded = stage !== "closed" || Boolean(sharedVerdict);
  const verdictWindowLabel =
    verdictScope === "window" && verdictWindow
      ? `[${formatMsClock(verdictWindow[0])}-${formatMsClock(verdictWindow[1])}] ${formatWindowLength(
          verdictWindow[1] - verdictWindow[0],
          t,
        )}`
      : verdictScope === "full"
        ? `${t("fullGame")} - ${
            matchDurationMs != null ? formatWindowLength(matchDurationMs, t) : match.duration
          }`
        : verdictScope === "v2-full"
          ? `${t("fullGame")} - ${
              matchDurationMs != null ? formatWindowLength(matchDurationMs, t) : match.duration
            }`
          : null;
  const viewedParticipant: Participant = useMemo(
    () => ({
      champion: match.champion,
      summoner: you?.summoner ?? "You",
      kills: match.kills,
      deaths: match.deaths,
      assists: match.assists,
      cs: match.cs,
      items: match.items,
      trinket: match.trinket,
      puuid: you?.puuid ?? match.userPuuid,
      teamId: match.userTeamId,
      teamPosition: match.userTeamPosition,
    }),
    [
      match.assists,
      match.champion,
      match.cs,
      match.deaths,
      match.items,
      match.kills,
      match.trinket,
      match.userPuuid,
      match.userTeamId,
      match.userTeamPosition,
      you?.puuid,
      you?.summoner,
    ],
  );
  const ownTeamMembers = useMemo(
    () => sortByRole([...match.team, viewedParticipant]),
    [match.team, viewedParticipant],
  );
  const mobileRoster = useMemo(() => {
    const viewedKey = viewedParticipant.puuid ?? viewedParticipant.summoner?.toLowerCase() ?? "";
    const fullRoster = [...match.team, ...match.enemies].filter((player) => {
      const key = player.puuid ?? player.summoner?.toLowerCase() ?? "";
      return key !== viewedKey;
    });
    fullRoster.push(viewedParticipant);

    const sortedBlue = sortByRole(fullRoster.filter((player) => player.teamId === 100));
    const sortedRed = sortByRole(fullRoster.filter((player) => player.teamId === 200));
    const hasSideData = sortedBlue.length > 0 || sortedRed.length > 0;

    return {
      blue: hasSideData ? sortedBlue : sortByRole(fullRoster.slice(0, 5)),
      red: hasSideData ? sortedRed : sortByRole(fullRoster.slice(5, 10)),
    };
  }, [match.enemies, match.team, viewedParticipant]);
  const highlightedPlayerKey =
    viewedParticipant.puuid ?? viewedParticipant.summoner?.toLowerCase() ?? "";
  const mobileDetailsLabels =
    locale === "ko"
      ? {
          show: "상세 정보 보기",
          hide: "상세 정보 숨기기",
          loadout: "스펠 / 룬",
          items: "아이템",
          stats: "기록",
          blue: "블루 팀",
          red: "레드 팀",
          cs: "CS",
          gold: "골드",
          damage: "피해량",
          vision: "시야",
        }
      : {
          show: "Show details",
          hide: "Hide details",
          loadout: "Spells / Runes",
          items: "Items",
          stats: "Stats",
          blue: "Blue Team",
          red: "Red Team",
          cs: "CS",
          gold: "Gold",
          damage: "Damage",
          vision: "Vision",
        };
  const visibleTeamMembers = useMemo(
    () => (showEnemyTeam ? sortByRole(match.enemies) : ownTeamMembers),
    [match.enemies, ownTeamMembers, showEnemyTeam],
  );
  const selectedFreeForAllPlayers =
    faultMode === "free-for-all" ? freeForAllSelection : visibleTeamMembers;
  const orderedSelectedFreeForAllPlayers = sortByRole(selectedFreeForAllPlayers);
  const subjectA = pickedSubjectA ?? viewedParticipant;
  const verdictHighlightChampionKey =
    verdictDisplay?.championKey ??
    (verdictDisplay
      ? (faultMode === "free-for-all"
          ? orderedSelectedFreeForAllPlayers
          : [subjectA, pickedAlly].filter((player): player is Participant => player !== null)
        ).find((player) =>
          [player.champion, formatChampionName(player.champion)].some(
            (candidate) =>
              normalizeVerdictToken(candidate) ===
              normalizeVerdictToken(verdictDisplay.championName),
          ),
        )?.champion
      : undefined);
  const subjectsReady =
    faultMode === "free-for-all"
      ? selectedFreeForAllPlayers.length >= 3 && selectedFreeForAllPlayers.length <= 5
      : faultMode === "me-vs-1"
        ? Boolean(pickedAlly)
        : Boolean(pickedSubjectA && pickedAlly);

  function clearMockLoadingTimers() {
    mockLoadingTimersRef.current.forEach((timer) => clearTimeout(timer));
    mockLoadingTimersRef.current = [];
  }

  const clearPersistedVerdict = useCallback(() => {
    removePersistedVerdictState(persistedVerdictKey);
  }, [persistedVerdictKey]);

  function openDefaultFreeForAllPicker() {
    setStage(ownTeamMembers.length >= 2 ? "pickScope" : "pickAlly");
    setFaultMode("free-for-all");
    setShowEnemyTeam(false);
    setPickedSubjectA(ownTeamMembers[0] ?? null);
    setPickedAlly(ownTeamMembers[1] ?? null);
    setFreeForAllSelection(ownTeamMembers);
  }

  function reset() {
    mockLoadingTimersRef.current.forEach((timer) => clearTimeout(timer));
    mockLoadingTimersRef.current = [];
    clearPersistedVerdict();
    setStage("closed");
    setFaultMode("free-for-all");
    setShowEnemyTeam(false);
    setPickedSubjectA(null);
    setPickedAlly(null);
    setFreeForAllSelection([]);
    setReasoning(null);
    setVerdictDisplay(null);
    setCompleted(new Set());
    setActiveStep("contextualize");
    setVerdictScope(null);
    setVerdictWindow(null);
    setShareUrl(null);
    setVerdictResultId(null);
    setSharing(false);
    setScoreboardOpen(false);
  }

  function startFreshVerdict() {
    clearMockLoadingTimers();
    clearPersistedVerdict();
    setStage(ownTeamMembers.length >= 2 ? "pickScope" : "pickAlly");
    setFaultMode("free-for-all");
    setShowEnemyTeam(false);
    setPickedSubjectA(ownTeamMembers[0] ?? null);
    setPickedAlly(ownTeamMembers[1] ?? null);
    setFreeForAllSelection(ownTeamMembers);
    setReasoning(null);
    setVerdictDisplay(null);
    setCompleted(new Set());
    setActiveStep("contextualize");
    setVerdictScope(null);
    setVerdictWindow(null);
    setShareUrl(null);
    setVerdictResultId(null);
    setSharing(false);
    setScoreboardOpen(false);
  }

  useEffect(() => {
    if (openJudgeRequest === lastOpenJudgeRequestRef.current) return;
    lastOpenJudgeRequestRef.current = openJudgeRequest;
    if (openJudgeRequest <= 0) return;

    clearMockLoadingTimers();
    clearPersistedVerdict();
    setStage(ownTeamMembers.length >= 2 ? "pickScope" : "pickAlly");
    setFaultMode("free-for-all");
    setShowEnemyTeam(false);
    setPickedSubjectA(ownTeamMembers[0] ?? null);
    setPickedAlly(ownTeamMembers[1] ?? null);
    setFreeForAllSelection(ownTeamMembers);
    setReasoning(null);
    setVerdictDisplay(null);
    setCompleted(new Set());
    setActiveStep("contextualize");
    setVerdictScope(null);
    setVerdictWindow(null);
    setShareUrl(null);
    setVerdictResultId(null);
    setSharing(false);
    setScoreboardOpen(false);
  }, [clearPersistedVerdict, openJudgeRequest, ownTeamMembers]);

  useEffect(() => {
    if (sharedVerdict || stage !== "closed" || reasoning) return;

    const saved = readPersistedVerdictState(persistedVerdictKey);
    if (!saved) return;
    if (saved.matchId !== (match.riotMatchId ?? match.id)) return;
    if (saved.userPuuid && match.userPuuid && saved.userPuuid !== match.userPuuid) return;
    if (saved.locale !== locale) return;

    setFaultMode(saved.faultMode);
    setShowEnemyTeam(saved.showEnemyTeam);
    setPickedSubjectA(saved.pickedSubjectA);
    setPickedAlly(saved.pickedAlly);
    setFreeForAllSelection(saved.freeForAllSelection);
    setReasoning(saved.reasoning);
    setVerdictDisplay(saved.verdictDisplay);
    setVerdictScope(saved.verdictScope);
    setVerdictWindow(saved.verdictWindow);
    setVerdictResultId(saved.verdictResultId);
    setShareUrl(saved.shareUrl);
    setSharing(false);
    setCompleted(new Set(["contextualize", "judge", "parse"]));
    setActiveStep("parse");
    setStage("verdict");
  }, [
    locale,
    match.id,
    match.riotMatchId,
    match.userPuuid,
    persistedVerdictKey,
    reasoning,
    sharedVerdict,
    stage,
  ]);

  useEffect(() => {
    if (sharedVerdict || stage !== "verdict" || !reasoning || !pickedAlly) return;

    const payload: PersistedVerdictState = {
      version: PERSISTED_VERDICT_VERSION,
      createdAt: Date.now(),
      matchId: match.riotMatchId ?? match.id,
      ...(match.userPuuid ? { userPuuid: match.userPuuid } : {}),
      locale,
      faultMode,
      showEnemyTeam,
      pickedSubjectA,
      pickedAlly,
      freeForAllSelection,
      reasoning,
      verdictDisplay,
      verdictScope,
      verdictWindow,
      verdictResultId,
      shareUrl,
    };

    writePersistedVerdictState(persistedVerdictKey, payload);
  }, [
    faultMode,
    freeForAllSelection,
    locale,
    match.id,
    match.riotMatchId,
    match.userPuuid,
    pickedAlly,
    pickedSubjectA,
    persistedVerdictKey,
    reasoning,
    shareUrl,
    sharedVerdict,
    showEnemyTeam,
    stage,
    verdictDisplay,
    verdictResultId,
    verdictScope,
    verdictWindow,
  ]);

  function showMockWindowResult(windowRange: [number, number]) {
    if (!pickedAlly) return;
    clearMockLoadingTimers();
    setShareUrl(null);
    setVerdictResultId(null);
    setSharing(false);
    setReasoning(
      [
        `${formatChampionName(pickedAlly.champion)} created avoidable pressure loss during the selected window; for example, they were late to the key fight and gave the enemy team time to convert the advantage.`,
        "",
        `${formatChampionName(pickedAlly.champion)} also failed to match the team's objective timing, which made the losing sequence harder to recover from.`,
      ].join("\n"),
    );
    setVerdictDisplay({
      championName: formatChampionName(pickedAlly.champion),
      championKey: pickedAlly.champion,
      summonerName: pickedAlly.summoner,
    });
    setCompleted(new Set(["contextualize", "judge", "parse"]));
    setActiveStep("parse");
    setVerdictScope("window");
    setVerdictWindow(windowRange);
    setStage("verdict");
  }

  function showMockLoading(windowRange: [number, number]) {
    if (!pickedAlly) return;
    clearMockLoadingTimers();
    clearPersistedVerdict();
    setReasoning(null);
    setVerdictDisplay(null);
    setShareUrl(null);
    setVerdictResultId(null);
    setSharing(false);
    setCompleted(new Set());
    setActiveStep("contextualize");
    setVerdictScope("window");
    setVerdictWindow(windowRange);
    setStage("loading");
    setLiveAnnouncement("The AI Judge is reviewing the match timeline.");

    mockLoadingTimersRef.current = [
      setTimeout(() => {
        setCompleted(new Set(["contextualize"]));
        setActiveStep("judge");
      }, 1800),
      setTimeout(() => {
        setCompleted(new Set(["contextualize", "judge"]));
        setActiveStep("parse");
      }, 4200),
      setTimeout(() => {
        setCompleted(new Set(["contextualize", "judge", "parse"]));
      }, 6600),
    ];
  }

  async function runJudge(scope: Scope, windowRange?: [number, number]) {
    if (!pickedAlly) return;
    clearMockLoadingTimers();
    verdictAbortControllerRef.current?.abort();
    if (!isRankedGame) {
      toast.warning(t("rankedSoloVerdictOnly"));
      return;
    }
    const durationMs = parseMatchDurationToMs(match.duration);
    if (durationMs != null && durationMs < MIN_VERDICT_GAME_MS) {
      toast.warning(t("verdictGameTooShortWarning"));
      return;
    }
    if (scope === "full" || scope === "v2-full") {
      if (durationMs != null && durationMs > MAX_FULL_GAME_VERDICT_MS) {
        toast.warning(t("fullGameTooLongWarning"));
        return;
      }
    }

    clearPersistedVerdict();
    setStage("loading");
    setReasoning(null);
    setVerdictDisplay(null);
    setShareUrl(null);
    setSharing(false);
    setCompleted(new Set());
    setActiveStep("contextualize");
    const contextualizeStartedAt = Date.now();

    if (!match.riotMatchId || !match.userPuuid) {
      toast.error("Match metadata unavailable for AI verdict.");
      reset();
      return;
    }

    const verdictAbortController = new AbortController();
    verdictAbortControllerRef.current = verdictAbortController;

    const subjectAChampionLabel = formatChampionName(subjectA.champion);
    const subjectBChampionLabel = formatChampionName(pickedAlly.champion);
    const freeForAllTeam =
      faultMode === "free-for-all" ? orderedSelectedFreeForAllPlayers : undefined;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    try {
      const turnstileToken = await executeTurnstile();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      await wait(Math.max(0, MIN_CONTEXTUALIZE_LOADING_MS - (Date.now() - contextualizeStartedAt)));
      setCompleted((s) => new Set(s).add("contextualize"));
      setActiveStep("judge");

      const verdict = await getJudgeVerdict({
        signal: verdictAbortController.signal,
        data: {
          matchId: match.riotMatchId,
          userPuuid: match.userPuuid,
          ...(match.routingRegion ? { routingRegion: match.routingRegion } : {}),
          scope,
          ...(scope === "window" && windowRange
            ? { startMs: windowRange[0], endMs: windowRange[1] }
            : {}),
          locale,
          turnstileToken,
          ...(accessToken ? { accessToken } : { anonymousId: getAnonymousId() }),
          verdictMode: faultMode === "free-for-all" ? "free-for-all" : "duel",
          ...(freeForAllTeam
            ? {
                freeForAllTeam: freeForAllTeam.map(toFreeForAllContextPlayer),
              }
            : {}),
          subjects: {
            a: {
              champion: subjectA.champion,
              puuid: subjectA.puuid,
            },
            b: {
              champion: pickedAlly.champion,
              puuid: pickedAlly.puuid,
            },
          },
        },
      }) as { content: string; verdictResultId?: string | null };
      const parsed = parseJudgeOutput(
        verdict.content,
        freeForAllTeam
          ? freeForAllTeam.map((player) => ({
              champion: player.champion,
              championLabel: formatChampionName(player.champion),
              summoner: player.summoner,
            }))
          : [
              {
                champion: subjectA.champion,
                championLabel: subjectAChampionLabel,
                summoner: subjectA.summoner,
              },
              {
                champion: pickedAlly.champion,
                championLabel: subjectBChampionLabel,
                summoner: pickedAlly.summoner,
              },
            ],
      );
      setReasoning(parsed.reasoning);
      setVerdictDisplay(parsed.verdict);
      setVerdictResultId(verdict.verdictResultId ?? null);
      setCompleted((s) => new Set(s).add("judge"));
      setActiveStep("parse");

      await wait(2000);
      setCompleted((s) => new Set(s).add("parse"));

      setVerdictScope(scope);
      setVerdictWindow(windowRange ?? null);
      setStage("verdict");
      setLiveAnnouncement("The AI verdict is ready. Review the reasoning below.");
    } catch (e) {
      if (verdictAbortController.signal.aborted || isAbortLikeError(e)) return;
      const errorMsg = getReadableVerdictError(e);
      toast.error(errorMsg);
      setLiveAnnouncement(`Error: ${errorMsg}`);
      reset();
    } finally {
      if (verdictAbortControllerRef.current === verdictAbortController) {
        verdictAbortControllerRef.current = null;
      }
      resetTurnstile();
    }
  }

  async function shareVerdict() {
    if (!reasoning || !verdictDisplay) return;
    if (!verdictResultId) {
      toast.error(t("shareFailed"));
      return;
    }

    try {
      setSharing(true);
      if (shareUrl) {
        const copied = await copyToClipboard(shareUrl);
        toast[copied ? "success" : "error"](t(copied ? "shareLinkCopied" : "shareCopyFailed"));
        return;
      }

      const turnstileToken = await executeTurnstile();
      const result = await createSharedVerdict({
        data: {
          turnstileToken,
          verdictResultId,
          ...(profileShard && profileGameName && profileTagLine
            ? {
                profile: {
                  shard: profileShard,
                  gameName: profileGameName,
                  tagLine: profileTagLine,
                },
              }
            : {}),
          scopeLabel: verdictWindowLabel,
        },
      });
      const nextShareUrl = new URL(result.path, window.location.origin).toString();
      setShareUrl(nextShareUrl);
      const copied = await copyToClipboard(nextShareUrl);
      toast.success(t(copied ? "shareLinkCopied" : "shareLinkReady"));
    } catch (error) {
      console.error("[share] failed to create share link:", error);
      toast.error(t(shareErrorKey(error)));
    } finally {
      setSharing(false);
      resetTurnstile();
    }
  }

  async function submitObjection({
    selectedReasons,
    source,
    shareId,
    feedback,
  }: {
    selectedReasons: ReasoningChoice[];
    source: "verdict" | "shared";
    shareId?: string;
    feedback?: string;
  }) {
    const currentReasoning = source === "shared" ? sharedVerdict?.reasoning : reasoning;
    const currentVerdictDisplay =
      source === "shared" ? sharedVerdict?.verdictDisplay : verdictDisplay;
    if (!currentReasoning || !currentVerdictDisplay) return;

    const selectedPlayers =
      source === "shared" && sharedVerdict
        ? sharedVerdict.selectedPlayers
        : faultMode === "free-for-all"
          ? orderedSelectedFreeForAllPlayers.map((player) => ({
              champion: player.champion,
              championLabel: formatChampionName(player.champion),
              summoner: player.summoner,
              kills: player.kills,
              deaths: player.deaths,
              assists: player.assists,
            }))
          : [subjectA, pickedAlly]
              .filter((player): player is Participant => player !== null)
              .map((player) => ({
                champion: player.champion,
                championLabel: formatChampionName(player.champion),
                summoner: player.summoner,
                kills: player.kills,
                deaths: player.deaths,
                assists: player.assists,
              }));

    const turnstileToken = await executeTurnstile();
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    const currentVerdictResultId = source === "shared" ? undefined : verdictResultId;
    if (!accessToken || !currentVerdictResultId) {
      throw new Error("OBJECTION_AUTH_REQUIRED");
    }

    await submitVerdictFeedback({
      data: {
        turnstileToken,
        accessToken,
        verdictResultId: currentVerdictResultId,
        source,
        ...(shareId ? { shareId } : {}),
        matchId: match.riotMatchId,
        locale,
        verdictMode: source === "shared" && sharedVerdict ? sharedVerdict.verdictMode : faultMode,
        scopeLabel:
          source === "shared" && sharedVerdict ? sharedVerdict.scopeLabel : verdictWindowLabel,
        selectedPlayers,
        verdictDisplay: currentVerdictDisplay,
        selectedReasons,
        ...(feedback ? { feedback } : {}),
      },
    });
  }

  return (
    <div
      className={`group relative overflow-hidden rounded-lg border-l-4 bg-card transition-all ${
        win ? "border-l-hex-blue" : "border-l-destructive"
      } ${expanded ? "" : "hover:translate-x-1"}`}
      style={{ boxShadow: "var(--shadow-elegant)" }}
    >
      <div className="relative p-4">
        <div className="flex items-center gap-4">
          <div className="w-24 shrink-0">
            <div className={`text-sm font-bold ${win ? "text-hex-blue" : "text-destructive"}`}>
              {resultLabel}
            </div>
            <div className="text-xs text-muted-foreground">{queueLabel}</div>
            <div className="mt-1 text-xs text-muted-foreground">{durationLabel}</div>
            <div className="text-xs text-muted-foreground">{playedAtLabel}</div>
          </div>

          {/* Champion identity column — icon stacked above the name so the
              champion square stays the dominant visual anchor and the name
              reads as its label directly underneath. `min-w-0` + `truncate`
              keep long / unbroken champion names (e.g. "Aurelion Sol")
              from pushing the rest of the row sideways. */}
          <div className="flex w-[60px] shrink-0 flex-col items-center gap-1">
            {/* Real Data Dragon champion square (with letter-tile fallback
                if Riot ships an unmapped name or the image fails to load). */}
            <ChampionIcon champion={match.champion} size={52} />
            <span
              className="block w-full min-w-0 truncate text-center text-xs font-semibold text-foreground"
              title={championLabel}
            >
              {championLabel}
            </span>
          </div>

          {/* Loadout: spells | runes — sits right after the champion so
              players read champion → spells → runes → KDA → items → stats,
          matching the requested order. */}
          <div className="hidden items-center gap-1.5 md:flex">
            <SummonerSpells spells={match.spells} locale={locale} />
            <div className="w-px bg-border/60" style={{ height: 22 * 2 + 2 }} />
            <RuneIcons runes={match.runes} locale={locale} />
          </div>

          <div className="ml-2 min-w-[110px] text-center">
            <div className="text-lg font-bold text-foreground">
              {match.kills} <span className="text-muted-foreground">/</span>{" "}
              <span className="text-destructive">{match.deaths}</span>{" "}
              <span className="text-muted-foreground">/</span> {match.assists}
            </div>
            <div className="text-xs text-muted-foreground">{kda} KDA</div>
          </div>

          {/* Items + trinket */}
          <div className="hidden items-center min-[820px]:flex">
            <ItemGrid items={match.items} trinket={match.trinket} locale={locale} />
          </div>

          {/* Stats */}
          <div className="hidden flex-col text-xs text-muted-foreground min-[940px]:flex">
            <span>CS {match.cs}</span>
            <span>{match.gold.toLocaleString()} gold</span>
            <span>{match.damage.toLocaleString()} dmg</span>
            <span>{match.vision} vision</span>
          </div>

          {/* Ally + enemy roster — fixed left offset so every match row's
              roster starts at the same x-position regardless of which
              optional columns (stats, loadout) actually rendered for this
              row. Previously this used `ml-auto`, which pushed the roster
              all the way to the right edge — making rows with a Defeat
              down-arrow shift the roster slightly left vs. Victory rows
              and creating visible misalignment between adjacent cards. */}
          <div className="ml-6 hidden min-[1060px]:block">
            <RosterColumns
              allies={match.team}
              enemies={match.enemies}
              you={you}
              onPlayerClick={onPlayerClick}
              formatChampionName={formatChampionName}
            />
          </div>

          {/* Down-arrow region — takes the remaining horizontal space
              between the participants preview (RosterColumns) and the
              right edge of the card, then centers the toggle inside that
              region. `flex-1` claims the leftover space; `justify-center`
              horizontally centers the chevron so it visually anchors the
              midpoint of that gap (instead of hugging the right edge as
              before). `ml-auto` on the wrapper still ensures the region
              starts immediately after the roster — so on narrow layouts
              where the roster is hidden (`lg:block`), the toggle stays
              right-aligned via the wrapper's own `ml-auto`.
              Only rendered on Defeat rows whose Judge slide is still
              closed — the parent owns this gating so <ExpandToggle />
              can stay dumb/reusable. */}
          {stage === "closed" && !sharedVerdict && (
            <div className="ml-auto flex flex-1 justify-center">
              {isRankedGame && !isShortVerdictGame ? (
                <ExpandToggle
                  onClick={() => {
                    onProfileInteraction?.(match.riotMatchId ?? match.id);
                    openDefaultFreeForAllPicker();
                  }}
                />
              ) : (
                <button
                  type="button"
                  disabled
                  title={
                    isShortVerdictGame
                      ? t("verdictGameTooShortWarning")
                      : t("rankedSoloVerdictOnly")
                  }
                  className="inline-flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground opacity-60"
                  aria-label={
                    isShortVerdictGame
                      ? t("verdictGameTooShortWarning")
                      : t("rankedSoloVerdictOnly")
                  }
                >
                  <Gavel className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pb-4 min-[1180px]:hidden">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-gold/70 hover:text-gold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold"
          aria-expanded={mobileDetailsOpen}
          onClick={() => setMobileDetailsOpen((open) => !open)}
        >
          {mobileDetailsOpen ? mobileDetailsLabels.hide : mobileDetailsLabels.show}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${mobileDetailsOpen ? "rotate-180" : ""}`}
          />
        </button>

        <div
          className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out ${
            mobileDetailsOpen ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="space-y-3 rounded-md border border-border/60 bg-background/30 p-3">
              <div className="md:hidden">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gold">
                  {mobileDetailsLabels.loadout}
                </div>
                <div className="flex items-center gap-2">
                  <SummonerSpells spells={match.spells} locale={locale} />
                  <div className="w-px bg-border/60" style={{ height: 22 * 2 + 2 }} />
                  <RuneIcons runes={match.runes} locale={locale} />
                </div>
              </div>

              <div className="max-[819px]:block min-[820px]:hidden">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gold">
                  {mobileDetailsLabels.items}
                </div>
                <ItemGrid items={match.items} trinket={match.trinket} locale={locale} />
              </div>

              <div className="max-[939px]:block min-[940px]:hidden">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gold">
                  {mobileDetailsLabels.stats}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div className="rounded border border-border/50 bg-card/40 px-2 py-1.5">
                    <span className="text-foreground">{match.cs}</span> {mobileDetailsLabels.cs}
                  </div>
                  <div className="rounded border border-border/50 bg-card/40 px-2 py-1.5">
                    <span className="text-foreground">{match.gold.toLocaleString()}</span>{" "}
                    {mobileDetailsLabels.gold}
                  </div>
                  <div className="rounded border border-border/50 bg-card/40 px-2 py-1.5">
                    <span className="text-foreground">{match.damage.toLocaleString()}</span>{" "}
                    {mobileDetailsLabels.damage}
                  </div>
                  <div className="rounded border border-border/50 bg-card/40 px-2 py-1.5">
                    <span className="text-foreground">{match.vision}</span>{" "}
                    {mobileDetailsLabels.vision}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 min-[620px]:grid-cols-2">
                <div className="max-[1059px]:block min-[1060px]:hidden">
                  <MobileRosterList
                    label={mobileDetailsLabels.blue}
                    players={mobileRoster.blue}
                    accent="text-hex-blue"
                    onPlayerClick={onPlayerClick}
                    formatChampionName={formatChampionName}
                    highlightedPlayerKey={highlightedPlayerKey}
                  />
                </div>
                <div className="max-[1179px]:block min-[1180px]:hidden">
                  <MobileRosterList
                    label={mobileDetailsLabels.red}
                    players={mobileRoster.red}
                    accent="text-destructive"
                    onPlayerClick={onPlayerClick}
                    formatChampionName={formatChampionName}
                    highlightedPlayerKey={highlightedPlayerKey}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Judge slide */}
      <div
        className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out ${
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
        aria-hidden={!expanded}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-border bg-background/40 px-4 py-5">
            {sharedVerdict && stage === "closed" && (
              <SharedVerdictResult
                verdict={sharedVerdict}
                t={t}
                onNewVerdict={onSharedNewVerdict}
              />
            )}

            {!sharedVerdict && (stage === "pickAlly" || stage === "pickScope") && (
              <PickAlly
                mode={faultMode}
                onModeChange={(nextMode) => {
                  setFaultMode(nextMode);
                  if (nextMode === "me-vs-1") setShowEnemyTeam(false);
                  setPickedSubjectA(null);
                  setPickedAlly(null);
                  setFreeForAllSelection([]);
                  if (nextMode === "free-for-all") {
                    const members = sortByRole(
                      showEnemyTeam ? match.enemies : [...match.team, viewedParticipant],
                    );
                    setFreeForAllSelection(members);
                    setPickedSubjectA(members[0] ?? null);
                    setPickedAlly(members[1] ?? null);
                    setStage(members.length >= 2 ? "pickScope" : "pickAlly");
                    return;
                  }
                  setStage("pickAlly");
                }}
                showEnemyTeam={showEnemyTeam}
                onSwitchTeams={() => {
                  const nextShowEnemyTeam = !showEnemyTeam;
                  setShowEnemyTeam(nextShowEnemyTeam);
                  const nextMode =
                    faultMode === "free-for-all"
                      ? "free-for-all"
                      : nextShowEnemyTeam
                        ? "one-vs-one"
                        : "me-vs-1";
                  setFaultMode(nextMode);
                  setPickedSubjectA(null);
                  setPickedAlly(null);
                  setFreeForAllSelection([]);
                  if (nextMode === "free-for-all") {
                    const members = sortByRole(
                      nextShowEnemyTeam ? match.enemies : [...match.team, viewedParticipant],
                    );
                    setFreeForAllSelection(members);
                    setPickedSubjectA(members[0] ?? null);
                    setPickedAlly(members[1] ?? null);
                    setStage(members.length >= 2 ? "pickScope" : "pickAlly");
                    return;
                  }
                  setStage("pickAlly");
                }}
                onClearSelection={() => {
                  setPickedSubjectA(null);
                  setPickedAlly(null);
                  setStage("pickAlly");
                }}
                match={match}
                scoreboardOpen={scoreboardOpen}
                onToggleScoreboard={() => setScoreboardOpen((open) => !open)}
                you={viewedParticipant}
                allies={match.team}
                enemies={match.enemies}
                freeForAllPlayers={visibleTeamMembers}
                selectedFreeForAllPlayers={selectedFreeForAllPlayers}
                onCancel={reset}
                selectedA={stage === "pickScope" ? subjectA : undefined}
                selectedB={stage === "pickScope" ? (pickedAlly ?? undefined) : undefined}
                t={t}
                locale={locale}
                formatChampionName={formatChampionName}
                onPick={(a) => {
                  setPickedSubjectA(null);
                  setPickedAlly(a);
                  setStage("pickScope");
                }}
                onPickDuel={(a, b) => {
                  setPickedSubjectA(a);
                  setPickedAlly(b);
                  setStage("pickScope");
                }}
                onDuelSelectionChange={(players) => {
                  if (faultMode !== "one-vs-one" && !showEnemyTeam) return;
                  setPickedSubjectA(players[0] ?? null);
                  setPickedAlly(players.length >= 2 ? players[1] : null);
                  setStage("pickScope");
                }}
                onFreeForAllSelectionChange={(players) => {
                  setFreeForAllSelection(players);
                  setPickedSubjectA(players[0] ?? null);
                  setPickedAlly(players[1] ?? null);
                  setStage("pickScope");
                }}
              />
            )}

          {!sharedVerdict && stage === "pickScope" && (
            <ScopeActions
              onFullGame={() => runJudge("v2-full")}
              onLegacyFullGame={
                SHOW_DEV_CONTEXT &&
                match.riotMatchId &&
                match.userPuuid &&
                !isShortVerdictGame &&
                subjectsReady
                  ? () => runJudge("full")
                  : undefined
              }
              onV2FullContext={
                SHOW_DEV_CONTEXT &&
                match.riotMatchId &&
                match.userPuuid &&
                !isShortVerdictGame &&
                subjectsReady
                  ? () => {
                      const params = new URLSearchParams();
                      params.set("scope", "v2-full");
                      params.set("locale", locale);
                      params.set("puuid", match.userPuuid as string);
                      if (match.routingRegion) params.set("region", match.routingRegion);
                      params.set("subjectA", subjectA.champion);
                      if (pickedAlly) params.set("subjectB", pickedAlly.champion);
                      if (faultMode === "free-for-all") {
                        addFreeForAllContextParams(params, orderedSelectedFreeForAllPlayers);
                      }
                      window.open(
                        `/dev/context/${match.riotMatchId}?${params.toString()}`,
                        "_blank",
                      );
                    }
                  : undefined
              }
              isWin={showEnemyTeam ? !win : win}
              isShortGame={isShortVerdictGame}
              subjectsReady={subjectsReady}
              showSpecifyTime={SHOW_DEV_CONTEXT}
              t={t}
              onSpecifyTime={
                match.riotMatchId && match.userPuuid && !isShortVerdictGame && subjectsReady
                  ? () => setStage("specifyTime")
                  : undefined
              }
            />
          )}

          {!sharedVerdict &&
            stage === "specifyTime" &&
            pickedAlly &&
            match.riotMatchId &&
            match.userPuuid && (
              <ScopeSpecifyTime
                matchId={match.riotMatchId}
                userPuuid={match.userPuuid}
                routingRegion={match.routingRegion}
                durationStr={match.duration}
                onBack={() => setStage("pickScope")}
                // SUBJECT_A = the viewer's champion on this match
                // SUBJECT_B = the ally the user picked in the previous step
                subjectAChampion={subjectA.champion}
                subjectBChampion={pickedAlly.champion}
                // Full match + viewer so TimelineWindowResult can build the
                // per-team champion+role rundown injected into the upper prompt.
                match={match}
                you={you}
                locale={locale}
                t={t}
                onRun={(range) => void runJudge("window", range)}
                onMockResult={SHOW_DEV_CONTEXT ? showMockWindowResult : undefined}
                onMockLoading={SHOW_DEV_CONTEXT ? showMockLoading : undefined}
                verdictMode={faultMode === "free-for-all" ? "free-for-all" : "duel"}
                freeForAllTeam={
                  faultMode === "free-for-all"
                    ? orderedSelectedFreeForAllPlayers.map(toFreeForAllContextPlayer)
                    : undefined
                }
              />
            )}

          {!sharedVerdict && stage === "loading" && (
            <>
              <div className="mb-3 flex justify-center">
                <ModeButton
                  active={scoreboardOpen}
                  onClick={() => setScoreboardOpen((open) => !open)}
                  aria-expanded={scoreboardOpen}
                >
                  {scoreboardOpen ? t("scoreboardHide") : t("scoreboardShow")}
                </ModeButton>
              </div>
              <MatchScoreboard
                match={match}
                viewedParticipant={viewedParticipant}
                open={scoreboardOpen}
                formatChampionName={formatChampionName}
                t={t}
                locale={locale}
              />
              {/* Pinned "You vs Ally" matchup card so the user always knows
                  which two subjects the Judge is comparing while the
                  pipeline runs. Reuses PlayerTile for visual parity with
                  the PickAlly screen. */}
              {pickedAlly && (
                <MatchupHeader
                  you={{
                    champion: subjectA.champion,
                    summoner: subjectA.summoner,
                    kills: subjectA.kills,
                    deaths: subjectA.deaths,
                    assists: subjectA.assists,
                  }}
                  ally={pickedAlly}
                  players={
                    faultMode === "free-for-all" ? orderedSelectedFreeForAllPlayers : undefined
                  }
                  highlightChampionKey={verdictHighlightChampionKey}
                  highlightChampionName={verdictDisplay?.championName}
                  loadingSequence
                  formatChampionName={formatChampionName}
                />
              )}
              <div aria-live="polite" aria-atomic="true">
                <JudgeLoading active={activeStep} completed={completed} t={t} />
              </div>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {t("judgeLoadingNotice")}
              </p>
            </>
          )}

          {!sharedVerdict && stage === "verdict" && reasoning && (
            <>
              <div className="mb-3 flex justify-center">
                <ModeButton
                  active={scoreboardOpen}
                  onClick={() => setScoreboardOpen((open) => !open)}
                  aria-expanded={scoreboardOpen}
                >
                  {scoreboardOpen ? t("scoreboardHide") : t("scoreboardShow")}
                </ModeButton>
              </div>
              <MatchScoreboard
                match={match}
                viewedParticipant={viewedParticipant}
                open={scoreboardOpen}
                formatChampionName={formatChampionName}
                t={t}
                locale={locale}
              />
              {/* Same matchup header on the verdict screen so the ruling
                  is always read in the context of the two compared
                  players (especially useful after re-judging). */}
              {pickedAlly && (
                <MatchupHeader
                  you={{
                    champion: subjectA.champion,
                    summoner: subjectA.summoner,
                    kills: subjectA.kills,
                    deaths: subjectA.deaths,
                    assists: subjectA.assists,
                  }}
                  ally={pickedAlly}
                  players={
                    faultMode === "free-for-all" ? orderedSelectedFreeForAllPlayers : undefined
                  }
                  highlightChampionKey={verdictHighlightChampionKey}
                  highlightChampionName={verdictDisplay?.championName}
                  formatChampionName={formatChampionName}
                />
              )}
              <Verdict
                verdictDisplay={verdictDisplay}
                reasoning={reasoning}
                windowLabel={verdictWindowLabel}
                onClose={reset}
                onAgain={startFreshVerdict}
                onShare={() => void shareVerdict()}
                sharing={sharing}
                shareDisabled={!verdictResultId}
                onSubmitObjection={(selectedReasons, feedback) =>
                  submitObjection({ selectedReasons, source: "verdict", feedback })
                }
                onAfterObjection={resetTurnstile}
                onViewContext={() => {
                  const params = new URLSearchParams();
                  params.set("scope", verdictScope ?? "full");
                  params.set("locale", locale);
                  if (match.userPuuid) params.set("puuid", match.userPuuid);
                  if (match.routingRegion) params.set("region", match.routingRegion);
                  params.set("subjectA", subjectA.champion);
                  if (pickedAlly) params.set("subjectB", pickedAlly.champion);
                  if (faultMode === "free-for-all") {
                    addFreeForAllContextParams(params, orderedSelectedFreeForAllPlayers);
                  }
                  if (verdictScope === "window" && verdictWindow) {
                    params.set("startMs", String(verdictWindow[0]));
                    params.set("endMs", String(verdictWindow[1]));
                  }
                  const id = match.riotMatchId ?? "unknown";
                  window.open(`/dev/context/${id}?${params.toString()}`, "_blank");
                }}
                t={t}
              />
            </>
          )}
          </div>
        </div>
      </div>
      {/* Screen-reader-only live region for dynamic announcements. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveAnnouncement}
      </div>
      <TurnstileWidget ref={turnstileRef} siteKey={turnstileSiteKey} resetKey={turnstileResetKey} />
    </div>
  );
}

// NameColumn was the previous inline roster renderer. It has been replaced
// by the dedicated `RosterColumns` component (see ./RosterColumns.tsx),
// which adds truncation + tooltip + champion icon + zebra striping.
