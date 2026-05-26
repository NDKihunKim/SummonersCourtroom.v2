import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Gavel, ArrowLeft, Check, Share2, MessageSquareWarning } from "lucide-react";
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
import { getJudgeVerdict } from "@/functions/timeline-window.functions";
import {
  createSharedVerdict,
  type SharedVerdictPayload,
} from "@/functions/shared-verdict.functions";
import { submitVerdictFeedback } from "@/functions/verdict-feedback.functions";
import { useChampionNameFormatter } from "@/lib/ddragon";
import { sortByRole } from "@/lib/role-order";
import type { Shard } from "@/lib/regions";
import type { Locale, TranslationKey } from "@/i18n";
import { TurnstileWidget, type TurnstileHandle } from "./TurnstileWidget";
import { supabase } from "@/integrations/supabase/client";
import { getAnonymousId } from "@/lib/anonymous-id";

type Stage = "closed" | "pickAlly" | "pickScope" | "specifyTime" | "loading" | "verdict";
type PipelineStep = "contextualize" | "judge" | "parse";
type Scope = "full" | "window";
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

function toFreeForAllContextPlayer(player: Participant): FreeForAllContextPlayer {
  return {
    champion: player.champion,
    puuid: player.puuid,
    role: player.teamPosition,
    summoner: player.summoner,
  };
}

function participantKey(player: Participant): string {
  return player.puuid ?? player.summoner?.toLowerCase() ?? player.champion;
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

function splitReasoningChoices(reasoning: string): ReasoningChoice[] {
  const text = reasoning.trim();
  if (!text) return [];

  const matches = [...text.matchAll(/(?:^|\n)\s*(\d{1,2})\.\s+/g)];
  if (matches.length === 0) return [{ index: 1, text }];

  return matches
    .slice(0, 5)
    .map((match, position) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = matches[position + 1]?.index ?? text.length;
      const index = Number(match[1]);
      return {
        index: Number.isFinite(index) ? index : position + 1,
        text: text.slice(start, end).trim(),
      };
    })
    .filter((choice) => choice.text.length > 0);
}

function objectionErrorKey(error: unknown): TranslationKey {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("OBJECTION_AUTH_REQUIRED")) return "objectionLoginRequired";
  if (message.includes("OBJECTION_ALREADY_SUBMITTED")) return "objectionAlreadySubmitted";
  if (message.includes("OBJECTION_RATE_LIMITED")) return "objectionRateLimited";
  if (message.includes("OBJECTION_SESSION_EXPIRED")) return "objectionSessionExpired";
  if (message.includes("OBJECTION_VERIFY_FAILED")) return "objectionVerifyFailed";
  return "objectionFailed";
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
  const playedAtLabel = formatPlayedAt(match.playedAt, locale, t);
  const championLabel = formatChampionName(match.champion);

  const [stage, setStage] = useState<Stage>("closed");
  const [faultMode, setFaultMode] = useState<FaultMode>("me-vs-1");
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
  const turnstileRef = useRef<TurnstileHandle>(null);
  const mockLoadingTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || undefined;
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const lastOpenJudgeRequestRef = useRef(0);
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
    };
  }, []);

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
        : null;
  const viewedParticipant: Participant = {
    champion: match.champion,
    summoner: you?.summoner ?? "You",
    kills: match.kills,
    deaths: match.deaths,
    assists: match.assists,
    puuid: you?.puuid ?? match.userPuuid,
    teamId: match.userTeamId,
    teamPosition: match.userTeamPosition,
  };
  const visibleTeamMembers = sortByRole(
    showEnemyTeam ? match.enemies : [...match.team, viewedParticipant],
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

  function reset() {
    clearMockLoadingTimers();
    setStage("closed");
    setFaultMode("me-vs-1");
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
    setSharing(false);
  }

  function startFreshVerdict() {
    clearMockLoadingTimers();
    setStage("pickAlly");
    setFaultMode("me-vs-1");
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
    setSharing(false);
  }

  useEffect(() => {
    if (openJudgeRequest === lastOpenJudgeRequestRef.current) return;
    lastOpenJudgeRequestRef.current = openJudgeRequest;
    if (openJudgeRequest > 0) startFreshVerdict();
  }, [openJudgeRequest]);

  function showMockWindowResult(windowRange: [number, number]) {
    if (!pickedAlly) return;
    clearMockLoadingTimers();
    setShareUrl(null);
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
    if (!isRankedGame) {
      toast.warning(t("rankedSoloVerdictOnly"));
      return;
    }
    const durationMs = parseMatchDurationToMs(match.duration);
    if (durationMs != null && durationMs < MIN_VERDICT_GAME_MS) {
      toast.warning(t("verdictGameTooShortWarning"));
      return;
    }
    if (scope === "full") {
      if (durationMs != null && durationMs > MAX_FULL_GAME_VERDICT_MS) {
        toast.warning(t("fullGameTooLongWarning"));
        return;
      }
    }

    setStage("loading");
    setReasoning(null);
    setVerdictDisplay(null);
    setShareUrl(null);
    setSharing(false);
    setCompleted(new Set());
    setActiveStep("contextualize");

    if (!match.riotMatchId || !match.userPuuid) {
      toast.error("Match metadata unavailable for AI verdict.");
      reset();
      return;
    }

    const subjectAChampionLabel = formatChampionName(subjectA.champion);
    const subjectBChampionLabel = formatChampionName(pickedAlly.champion);
    const freeForAllTeam =
      faultMode === "free-for-all" ? orderedSelectedFreeForAllPlayers : undefined;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    try {
      const turnstileToken = await executeTurnstile();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      await wait(250);
      setCompleted((s) => new Set(s).add("contextualize"));
      setActiveStep("judge");

      const verdict = await getJudgeVerdict({
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
      });
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI verdict request failed.");
      reset();
    } finally {
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
  }: {
    selectedReasons: ReasoningChoice[];
    source: "verdict" | "shared";
    shareId?: string;
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
                    setStage("pickAlly");
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

      {/* Expanded Judge slide */}
      {expanded && (
        <div className="border-t border-border bg-background/40 px-4 py-5 animate-fade-in">
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
              you={viewedParticipant}
              allies={match.team}
              enemies={match.enemies}
              freeForAllPlayers={visibleTeamMembers}
              selectedFreeForAllPlayers={selectedFreeForAllPlayers}
              onCancel={reset}
              selectedA={stage === "pickScope" ? subjectA : undefined}
              selectedB={stage === "pickScope" ? (pickedAlly ?? undefined) : undefined}
              t={t}
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
              onFullGame={() => runJudge("full")}
              isWin={showEnemyTeam ? !win : win}
              isShortGame={isShortVerdictGame}
              subjectsReady={subjectsReady}
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
                  formatChampionName={formatChampionName}
                />
              )}
              <JudgeLoading active={activeStep} completed={completed} t={t} />
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {t("judgeLoadingNotice")}
              </p>
            </>
          )}

          {!sharedVerdict && stage === "verdict" && reasoning && (
            <>
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
                onAgain={() => setStage("pickAlly")}
                onShare={() => void shareVerdict()}
                sharing={sharing}
                shareDisabled={!verdictResultId}
                onSubmitObjection={(selectedReasons) =>
                  submitObjection({ selectedReasons, source: "verdict" })
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
      )}
      <TurnstileWidget ref={turnstileRef} siteKey={turnstileSiteKey} resetKey={turnstileResetKey} />
    </div>
  );
}

// NameColumn was the previous inline roster renderer. It has been replaced
// by the dedicated `RosterColumns` component (see ./RosterColumns.tsx),
// which adds truncation + tooltip + champion icon + zebra striping.

function PickAlly({
  mode,
  onModeChange,
  showEnemyTeam,
  onSwitchTeams,
  you,
  allies,
  enemies,
  freeForAllPlayers,
  selectedFreeForAllPlayers,
  onPick,
  onPickDuel,
  onDuelSelectionChange,
  onFreeForAllSelectionChange,
  onClearSelection,
  onCancel,
  selectedA,
  selectedB,
  t,
  formatChampionName,
}: {
  mode: FaultMode;
  onModeChange: (mode: FaultMode) => void;
  showEnemyTeam: boolean;
  onSwitchTeams: () => void;
  you: Participant;
  allies: Participant[];
  enemies: Participant[];
  freeForAllPlayers: Participant[];
  selectedFreeForAllPlayers: Participant[];
  onPick: (a: Participant) => void;
  onPickDuel: (a: Participant, b: Participant) => void;
  onDuelSelectionChange: (players: Participant[]) => void;
  onFreeForAllSelectionChange: (players: Participant[]) => void;
  onClearSelection: () => void;
  onCancel: () => void;
  selectedA?: Participant;
  selectedB?: Participant;
  t: Translate;
  formatChampionName: (champion: string) => string;
}) {
  const [duelPicks, setDuelPicks] = useState<Participant[]>([]);
  const teamMembers = sortByRole(showEnemyTeam ? enemies : [...allies, you]);
  const pickHint =
    mode === "free-for-all"
      ? t("verdictPickFreeForAllHint")
      : showEnemyTeam || mode === "one-vs-one"
        ? t("verdictPickOneVsOneHint")
        : t("verdictPickMeVsOneHint");

  function playerKey(player: Participant): string {
    return participantKey(player);
  }

  function isPicked(player: Participant): boolean {
    const key = playerKey(player);
    return duelPicks.some((pick) => playerKey(pick) === key);
  }

  function isFreeForAllPicked(player: Participant): boolean {
    const key = playerKey(player);
    return selectedFreeForAllPlayers.some((pick) => playerKey(pick) === key);
  }

  function toggleFreeForAllPick(player: Participant) {
    const key = playerKey(player);
    const exists = selectedFreeForAllPlayers.some((pick) => playerKey(pick) === key);
    const next = exists
      ? selectedFreeForAllPlayers.filter((pick) => playerKey(pick) !== key)
      : [...selectedFreeForAllPlayers, player].slice(0, 5);
    onFreeForAllSelectionChange(next);
  }

  function toggleDuelPick(player: Participant) {
    setDuelPicks((current) => {
      const key = playerKey(player);
      const existing = current.findIndex((pick) => playerKey(pick) === key);
      if (existing >= 0) {
        const next = current.filter((_, index) => index !== existing);
        onDuelSelectionChange(next);
        return next;
      }
      const next = [...current, player];
      onDuelSelectionChange(next.slice(0, 2));
      if (next.length === 2) onPickDuel(next[0], next[1]);
      return next.slice(0, 2);
    });
  }

  function selectMode(nextMode: FaultMode) {
    onModeChange(nextMode);
    setDuelPicks([]);
  }

  function switchTeams() {
    setDuelPicks([]);
    onSwitchTeams();
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gold">
          <Gavel className="mr-1 inline h-3.5 w-3.5" /> {t("biggerFaultQuestion")}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {!showEnemyTeam ? (
            <ModeButton active={mode === "me-vs-1"} onClick={() => selectMode("me-vs-1")}>
              Me vs 1
            </ModeButton>
          ) : null}
          <ModeButton active={mode === "one-vs-one"} onClick={() => selectMode("one-vs-one")}>
            1 vs 1
          </ModeButton>
          <ModeButton active={mode === "free-for-all"} onClick={() => selectMode("free-for-all")}>
            Free for All
          </ModeButton>
          <ModeButton active={showEnemyTeam} onClick={switchTeams}>
            Switch Teams
          </ModeButton>
          <button
            onClick={onCancel}
            className="ml-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {t("cancel")}
          </button>
        </div>
      </div>

      <p className="mb-3 text-center text-xs text-muted-foreground">{pickHint}</p>

      {mode === "free-for-all" ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {freeForAllPlayers.map((player, i) => (
            <Fragment key={`${player.summoner}-${i}`}>
              {i > 0 ? <span className="text-xl font-bold text-muted-foreground">vs</span> : null}
              <button onClick={() => toggleFreeForAllPick(player)} className="group">
                <PlayerTile
                  highlighted={isFreeForAllPicked(player)}
                  name={player.summoner}
                  champion={player.champion}
                  championLabel={formatChampionName(player.champion)}
                  kda={`${player.kills}/${player.deaths}/${player.assists}`}
                />
              </button>
            </Fragment>
          ))}
        </div>
      ) : showEnemyTeam || mode === "one-vs-one" ? (
        <div className="flex flex-wrap justify-center gap-3">
          {teamMembers.map((player, i) => (
            <button
              key={`${player.summoner}-${i}`}
              onClick={() => toggleDuelPick(player)}
              className="group"
            >
              <PlayerTile
                highlighted={isPicked(player)}
                name={player.summoner}
                champion={player.champion}
                championLabel={formatChampionName(player.champion)}
                kda={`${player.kills}/${player.deaths}/${player.assists}`}
              />
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <PlayerTile
            highlighted
            name={you.summoner ?? "You"}
            champion={you.champion}
            championLabel={formatChampionName(you.champion)}
            kda={`${you.kills}/${you.deaths}/${you.assists}`}
          />
          <span className="text-xl font-bold text-muted-foreground">vs</span>
          <div className="flex flex-wrap gap-3">
            {allies.map((a, i) => (
              <button key={i} onClick={() => onPick(a)} className="group">
                <PlayerTile
                  highlighted={selectedB ? playerKey(selectedB) === playerKey(a) : false}
                  name={a.summoner}
                  champion={a.champion}
                  championLabel={formatChampionName(a.champion)}
                  kda={`${a.kills}/${a.deaths}/${a.assists}`}
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? "border-gold bg-gold/15 text-gold"
          : disabled
            ? "cursor-not-allowed border-border bg-muted/30 text-muted-foreground/60"
            : "border-border bg-card text-muted-foreground hover:border-gold hover:text-gold"
      }`}
    >
      {children}
    </button>
  );
}

function PlayerTile({
  name,
  champion,
  championLabel = champion,
  kda,
  highlighted,
  role,
}: {
  name: string;
  champion: string;
  championLabel?: string;
  kda: string;
  highlighted?: boolean;
  role?: string;
}) {
  return (
    <div
      className={`flex w-28 shrink-0 flex-col items-center gap-1 overflow-hidden rounded-lg border p-2 transition-all ${
        highlighted
          ? "border-gold bg-secondary/50"
          : "border-border bg-card hover:border-gold/40 hover:bg-secondary/40"
      }`}
    >
      {role ? (
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gold/80">
          {role}
        </span>
      ) : null}
      {/* Real champion square — instantly recognisable to LoL players,
          which is exactly what the "pick the bigger fault" UI needs. */}
      <ChampionIcon champion={champion} size={48} />
      {/* `w-full min-w-0` is required for `truncate` to engage on unbroken
          strings (e.g. CJK summoner names without spaces) inside a flex
          column with `items-center`. Without an explicit width, the span
          shrinks to fit its content and overflows the tile. The `title`
          attribute keeps the full name accessible on hover. */}
      <span
        className="block w-full min-w-0 truncate text-center text-xs font-semibold text-foreground"
        title={championLabel}
      >
        {championLabel}
      </span>
      <span
        className="block w-full min-w-0 truncate text-center text-[10px] text-muted-foreground"
        title={name}
      >
        {name}
      </span>
      <span className="text-[10px] text-muted-foreground">{kda}</span>
    </div>
  );
}

function ScopeActions({
  onFullGame,
  onSpecifyTime,
  isWin,
  isShortGame,
  subjectsReady,
  t,
}: {
  onFullGame: () => void;
  /**
   * When provided, the "Specify Time" button is enabled and triggers this
   * callback. Omitted (undefined) for matches that lack the matchId/puuid
   * needed to fetch a timeline window — button stays disabled in that case.
   */
  onSpecifyTime?: () => void;
  isShortGame: boolean;
  subjectsReady: boolean;
  /**
   * True when this match is a Victory. On wins we hide the "Full game"
   * button entirely — full-game judging is intentionally Defeat-only,
   * since the prompt is framed around assigning fault for a loss. Wins
   * can still be analyzed via the Specify-Time scope, which is neutral.
   */
  isWin: boolean;
  t: Translate;
}) {
  const fullGameDisabled = isWin || isShortGame || !subjectsReady;
  const fullGameTitle = isShortGame
    ? t("verdictGameTooShortWarning")
    : !subjectsReady
      ? undefined
      : isWin
        ? t("fullGameVictoryUnavailable")
        : undefined;
  const specifyTimeTitle = isShortGame
    ? t("verdictGameTooShortWarning")
    : !subjectsReady
      ? undefined
      : onSpecifyTime
        ? "Pick a 5-10 min slice of the game"
        : "Match metadata unavailable";

  return (
    <div className="mt-4 animate-fade-in">
      <div className="flex flex-wrap justify-center gap-3">
        {/* Full-game scope is Defeat-only. Victory rows still show the
            option disabled so users understand the feature boundary. */}
        <button
          onClick={fullGameDisabled ? undefined : onFullGame}
          disabled={fullGameDisabled}
          title={fullGameTitle}
          className={
            fullGameDisabled
              ? "cursor-not-allowed rounded-lg border border-border bg-muted/40 px-5 py-3 text-sm font-semibold text-muted-foreground"
              : "rounded-lg border border-gold bg-gold/10 px-5 py-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/20"
          }
        >
          {t("fullGame")}
        </button>
        <button
          onClick={onSpecifyTime}
          disabled={!onSpecifyTime || !subjectsReady}
          className={
            onSpecifyTime && subjectsReady
              ? "rounded-lg border border-gold bg-gold/10 px-5 py-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/20"
              : "cursor-not-allowed rounded-lg border border-border bg-muted/40 px-5 py-3 text-sm font-semibold text-muted-foreground"
          }
          title={specifyTimeTitle}
        >
          {t("specifyTime")}
        </button>
      </div>
    </div>
  );
}

function JudgeLoading({
  active,
  completed,
  t,
}: {
  active: PipelineStep;
  completed: Set<PipelineStep>;
  t: Translate;
}) {
  const loadingPhrases: TranslationKey[] = [
    "judgeLoadingPhraseDeliberating",
    "judgeLoadingPhraseTimeline",
    "judgeLoadingPhraseEvidence",
    "judgeLoadingPhraseMoments",
  ];
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [dotCount, setDotCount] = useState(1);
  const steps: { id: PipelineStep; label: string; sub: string }[] = [
    { id: "contextualize", label: t("contextualizeStep"), sub: t("contextualizeStepSub") },
    { id: "judge", label: t("judgeStep"), sub: t("judgeStepSub") },
    { id: "parse", label: t("verdictStep"), sub: t("verdictStepSub") },
  ];

  useEffect(() => {
    const id = window.setInterval(() => {
      setPhraseIndex((index) => (index + 1) % loadingPhrases.length);
    }, 5200);
    return () => window.clearInterval(id);
  }, [loadingPhrases.length]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setDotCount((count) => (count >= 3 ? 1 : count + 1));
    }, 600);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center gap-5 py-6">
      <div className="min-h-5 overflow-hidden text-center">
        <p
          key={phraseIndex}
          className="animate-judge-loading-phrase text-sm font-semibold uppercase tracking-[0.3em] text-gold"
        >
          {t(loadingPhrases[phraseIndex])}
          <span aria-hidden="true">{".".repeat(dotCount)}</span>
        </p>
      </div>
      <ol className="flex w-full max-w-2xl items-start justify-between gap-2">
        {steps.map((s, i) => {
          const isDone = completed.has(s.id);
          const isActive = active === s.id && !isDone;
          return (
            <li key={s.id} className="flex flex-1 flex-col items-center gap-2 text-center">
              <div className="flex w-full items-center">
                <div
                  className={`h-px flex-1 ${i === 0 ? "opacity-0" : isDone || isActive ? "bg-gold" : "bg-border"}`}
                />
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all ${
                    isDone
                      ? "border-gold bg-gold/20 text-gold"
                      : isActive
                        ? "border-gold bg-card text-gold"
                        : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {isDone ? (
                    <Check className="h-4 w-4" />
                  ) : isActive ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className="text-xs font-semibold">{i + 1}</span>
                  )}
                </div>
                <div
                  className={`h-px flex-1 ${i === steps.length - 1 ? "opacity-0" : isDone ? "bg-gold" : "bg-border"}`}
                />
              </div>
              <div>
                <div
                  className={`text-xs font-semibold uppercase tracking-wider ${
                    isDone || isActive ? "text-gold" : "text-muted-foreground"
                  }`}
                >
                  {s.label}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{s.sub}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SharedVerdictResult({
  verdict,
  t,
  onNewVerdict,
}: {
  verdict: SharedVerdictPayload;
  t: Translate;
  onNewVerdict?: () => void;
}) {
  const sharedPlayers = verdict.selectedPlayers.map(
    (player): Participant => ({
      champion: player.champion,
      summoner: player.summoner ?? player.championLabel ?? player.champion,
      kills: player.kills ?? 0,
      deaths: player.deaths ?? 0,
      assists: player.assists ?? 0,
    }),
  );
  const championLabels = new Map(
    verdict.selectedPlayers.map((player) => [
      player.champion,
      player.championLabel ?? player.champion,
    ]),
  );

  return (
    <div>
      {sharedPlayers.length >= 2 ? (
        <MatchupHeader
          you={sharedPlayers[0]}
          ally={sharedPlayers[1]}
          players={sharedPlayers.length > 2 ? sharedPlayers : undefined}
          highlightChampionKey={verdict.verdictDisplay.championKey}
          highlightChampionName={verdict.verdictDisplay.championName}
          formatChampionName={(champion) => championLabels.get(champion) ?? champion}
        />
      ) : null}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gavel className="h-4 w-4 text-gold" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gold">
            Shared Verdict
          </h3>
        </div>
        {verdict.scopeLabel && (
          <div className="text-right text-sm font-semibold uppercase tracking-wider text-gold">
            {verdict.scopeLabel}
          </div>
        )}
      </div>
      <div className="mb-3 rounded-lg border border-gold bg-gold/10 p-4 text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gold/80">
          {t("moreAtFault")}
        </div>
        <div className="mt-1 text-2xl font-bold text-gold">
          {verdict.verdictDisplay.championName}
        </div>
        {verdict.verdictDisplay.summonerName && (
          <div className="mt-1 text-xs font-medium text-muted-foreground">
            {verdict.verdictDisplay.summonerName}
          </div>
        )}
      </div>
      <p className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm leading-relaxed text-foreground">
        {verdict.reasoning}
      </p>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onNewVerdict}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {t("newVerdict")}
        </button>
      </div>
    </div>
  );
}

function ObjectionPanel({
  reasoning,
  t,
  onSubmit,
  onAfterSubmit,
  renderActions,
}: {
  reasoning: string;
  t: Translate;
  onSubmit: (selectedReasons: ReasoningChoice[]) => Promise<void>;
  onAfterSubmit: () => void;
  renderActions: (button: React.ReactNode, saved: React.ReactNode) => React.ReactNode;
}) {
  const choices = splitReasoningChoices(reasoning);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [explanationsByReason, setExplanationsByReason] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.session));
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSignedIn(Boolean(nextSession));
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  function toggleChoice(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
        setExplanationsByReason((currentExplanations) => {
          const { [index]: _removed, ...rest } = currentExplanations;
          return rest;
        });
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function updateExplanation(index: number, value: string) {
    setExplanationsByReason((current) => ({ ...current, [index]: value }));
  }

  async function submit() {
    const selectedReasons = choices
      .filter((choice) => selected.has(choice.index))
      .map((choice) => ({
        ...choice,
        explanation: explanationsByReason[choice.index]?.trim() ?? "",
      }));
    if (selectedReasons.length === 0) return;

    setSubmitting(true);
    try {
      await onSubmit(selectedReasons);
      setSubmitted(true);
      setOpen(false);
      setSelected(new Set());
      setExplanationsByReason({});
      toast.success(t("objectionSubmitted"));
    } catch (error) {
      if ((error instanceof Error ? error.message : "").includes("OBJECTION_ALREADY_SUBMITTED")) {
        setSubmitted(true);
        setOpen(false);
      }
      toast.error(t(objectionErrorKey(error)));
    } finally {
      setSubmitting(false);
      onAfterSubmit();
    }
  }

  if (choices.length === 0) return null;

  const objectionDisabled = submitted || signedIn !== true;
  const button = (
    <button
      type="button"
      disabled={objectionDisabled}
      onClick={() => setOpen((value) => !value)}
      title={signedIn === false ? t("objectionLoginRequired") : undefined}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      <MessageSquareWarning className="h-3.5 w-3.5" />
      {t("objection")}
    </button>
  );
  const saved = submitted ? (
    <span className="text-[10px] font-medium text-muted-foreground">{t("objectionSaved")}</span>
  ) : signedIn === false ? (
    <span className="text-[10px] font-medium text-muted-foreground">
      {t("objectionLoginRequired")}
    </span>
  ) : null;

  return (
    <>
      {renderActions(button, saved)}
      {open && (
        <div className="mt-3 space-y-3 rounded-lg border border-border bg-background/40 p-3 animate-fade-in">
          <p className="text-xs font-medium text-muted-foreground">{t("objectionHelp")}</p>
          <div className="space-y-2">
            {choices.map((choice) => {
              const checked = selected.has(choice.index);
              return (
                <div
                  key={`${choice.index}-${choice.text}`}
                  className={`rounded-md border p-2 text-xs leading-relaxed transition-colors ${
                    checked
                      ? "border-gold bg-gold/10 text-foreground"
                      : "border-border bg-card/60 text-muted-foreground hover:border-gold/50 hover:text-foreground"
                  }`}
                >
                  <label className="flex cursor-pointer gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleChoice(choice.index)}
                      className="mt-0.5 h-3.5 w-3.5 accent-gold"
                    />
                    <span>
                      <span className="font-semibold text-gold">{choice.index}. </span>
                      {choice.text}
                    </span>
                  </label>
                  {checked && (
                    <textarea
                      value={explanationsByReason[choice.index] ?? ""}
                      onChange={(event) => updateExplanation(choice.index, event.target.value)}
                      maxLength={1000}
                      placeholder={t("objectionPlaceholder")}
                      className="mt-2 min-h-16 w-full resize-y rounded-md border border-border bg-background/70 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gold/50"
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 flex-1 text-left text-[10px] font-medium leading-relaxed text-muted-foreground">
              {t("objectionNotice")}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                disabled={submitting || selected.size === 0}
                onClick={() => void submit()}
                className="rounded-md border border-gold bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? t("loading") : t("objectionSend")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Verdict({
  verdictDisplay,
  reasoning,
  windowLabel,
  onClose,
  onAgain,
  onShare,
  sharing,
  shareDisabled,
  onSubmitObjection,
  onAfterObjection,
  onViewContext,
  t,
}: {
  verdictDisplay: VerdictDisplay | null;
  reasoning: string;
  windowLabel: string | null;
  onClose: () => void;
  onAgain: () => void;
  onShare: () => void;
  sharing: boolean;
  shareDisabled: boolean;
  onSubmitObjection: (selectedReasons: ReasoningChoice[]) => Promise<void>;
  onAfterObjection: () => void;
  onViewContext: () => void;
  t: Translate;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gavel className="h-4 w-4 text-gold" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gold">
            {t("verdictTitle")}
          </h3>
        </div>
        {windowLabel && (
          <div className="text-right text-sm font-semibold uppercase tracking-wider text-gold">
            {windowLabel}
          </div>
        )}
      </div>
      {verdictDisplay && (
        <div className="mb-3 rounded-lg border border-gold bg-gold/10 p-4 text-center">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gold/80">
            {t("moreAtFault")}
          </div>
          <div className="mt-1 text-2xl font-bold text-gold">{verdictDisplay.championName}</div>
          {verdictDisplay.summonerName && (
            <div className="mt-1 text-xs font-medium text-muted-foreground">
              {verdictDisplay.summonerName}
            </div>
          )}
        </div>
      )}
      <p className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm leading-relaxed text-foreground">
        {reasoning}
      </p>
      <ObjectionPanel
        reasoning={reasoning}
        t={t}
        onSubmit={onSubmitObjection}
        onAfterSubmit={onAfterObjection}
        renderActions={(button, saved) => (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={onShare}
                disabled={sharing || shareDisabled}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Share2 className="h-3.5 w-3.5" />
                {sharing ? t("loading") : t("share")}
              </button>
              {button}
              {saved}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {SHOW_DEV_CONTEXT && (
                <button
                  onClick={onViewContext}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  View context
                </button>
              )}
              <button
                onClick={onAgain}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {t("newVerdict")}
              </button>
              <button
                onClick={onClose}
                className="rounded-md border border-gold bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/20"
              >
                {t("close")}
              </button>
            </div>
          </div>
        )}
      />
    </div>
  );
}
