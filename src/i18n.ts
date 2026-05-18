import { useEffect, useMemo, useState } from "react";

export type Locale = "en" | "ko";

const STORAGE_KEY = "summoners-courtroom:locale";

export const LOCALES: Array<{ code: Locale; label: string }> = [
  { code: "en", label: "English" },
  { code: "ko", label: "한국어" },
];

const translations = {
  en: {
    languageSelect: "Language",
    heroLabel: "League of Legends AI Verdict",
    riotIdPlaceholder: "Riot ID (e.g. Faker#KR1)",
    search: "Search",
    loading: "Loading",
    heroHelper:
      "Enter your Riot ID to pull recent matches from Riot, then let the AI Judge weigh in on every match.",
    newSearch: "New search",
    savePlayer: "Save",
    unsavePlayer: "Unsave",
    matchHistoryRefreshed: "Match history refreshed.",
    refreshFailed: "Refresh failed.",
    refreshMatchHistory: "Refresh match history",
    availableIn: "Available in",
    updated: "Updated",
    justNow: "just now",
    secondsAgo: "s ago",
    minutesAgo: "m ago",
    hoursAgo: "h ago",
    daysAgo: "d ago",
    lastMatches: "Last {count} matches",
    winRate: "Win Rate",
    winLoss: "W / L",
    avgKda: "Avg KDA",
    recentMatches: "Recent Matches",
    noRecentMatches: "No recent matches found for this account.",
    showMoreMatches: "Show {count} more {noun}",
    clearAllHistory: "Clear all history ({count})",
    selectRegion: "Select region / shard",
    sampleSizeLabel: "Number of recent matches to use for performance stats",
    disclaimerLabel: "Riot Games Disclaimer",
    invalidRiotId: "Enter your Riot ID as Name#TAG (e.g. Faker#KR1).",
    failedToLoadMatches: "Failed to load matches",
    clearedRecentSearches: "Cleared {count} recent search{plural}.",
    couldntParse: 'Couldn\'t parse "{riotId}" — expected Name#TAG.',
    savedPlayer: "Saved {riotId}.",
    unsavedPlayer: "Unsaved {riotId}.",
    removeRecent: "Remove {riotId} from recent searches",
    unsaveRiotId: "Unsave {riotId}",
    home: "Go to Summoner's Courtroom home",
    victory: "Victory",
    defeat: "Defeat",
    biggerFaultQuestion: "Who's the bigger fault?",
    cancel: "Cancel",
    fullGame: "Full Game",
    fullGameVictoryUnavailable: "Full-game verdicts are only available for defeated games.",
    rankedSoloVerdictOnly: "AI verdicts are only available for Ranked Solo games.",
    fullGameTooLongWarning:
      "[FULL_GAME_TOO_LONG] Full-game verdicts are unavailable for matches over 60 minutes. Use Specify Time with a 5-10 minute window.",
    specifyTime: "Specify Time",
    pickAgain: "Pick again",
    backToScope: "Back to scope",
    timeSelection: "Time:",
    gameTime: "Game:",
    selectedWindowLength: "{minutes}:{seconds} long",
    startTime: "Start",
    endTime: "End",
    minMaxWindow: "Min 5:00 · Max 10:00",
    specifyTimeMinWindowWarning: "The selected window must be at least 5 minutes.",
    verdict: "Verdict",
    verdictTitle: "The Verdict",
    previewOnlyWarning:
      "Preview only — this is an example of how the verdict will be displayed. No AI was used to generate this output.",
    moreAtFault: "More at fault",
    judgeAnother: "Judge another",
    close: "Close",
    judgeDeliberating: "The Judge is deliberating",
    contextualizeStep: "Contextualize",
    contextualizeStepSub: "Translating raw stats into human language",
    judgeStep: "IA Judge",
    judgeStepSub: "AI is weighing the evidence",
    verdictStep: "Verdict",
    verdictStepSub: "Extracting the final ruling",
    queueRankedSolo: "Ranked Solo",
    queueRankedFlex: "Ranked Flex",
    queueNormalGame: "Normal game",
    queueNormalDraft: "Normal Draft",
    queueNormalBlind: "Normal Blind",
    queueAram: "ARAM",
    queueArena: "Arena",
    queueQuickplay: "Quickplay",
    queueSwiftplay: "Swiftplay",
    durationMinutesSeconds: "{minutes}m {seconds}s",
    durationMinutes: "{minutes}m",
    durationSeconds: "{seconds}s",
    relativeHoursAgo: "{count}h ago",
    relativeDaysAgo: "{count}d ago",
    relativeMinutesAgo: "{count}m ago",
    relativeSecondsAgo: "{count}s ago",
  },
  ko: {
    languageSelect: "언어",
    heroLabel: "리그 오브 레전드 AI 판결",
    riotIdPlaceholder: "Riot ID (예: Faker#KR1)",
    search: "검색",
    loading: "불러오는 중",
    heroHelper:
      "Riot ID를 입력해 최근 경기를 불러오고, AI 판사가 각 경기를 평가하도록 해보세요.",
    newSearch: "새 검색",
    savePlayer: "저장",
    unsavePlayer: "저장 해제",
    matchHistoryRefreshed: "전적이 새로고침되었습니다.",
    refreshFailed: "새로고침에 실패했습니다.",
    refreshMatchHistory: "전적 새로고침",
    availableIn: "업데이트 가능 시간:",
    updated: "마지막 업데이트:",
    justNow: "방금 전",
    secondsAgo: "초 전",
    minutesAgo: "분 전",
    hoursAgo: "시간 전",
    daysAgo: "일 전",
    lastMatches: "최근 {count}경기",
    winRate: "승률",
    winLoss: "승 / 패",
    avgKda: "평균 KDA",
    recentMatches: "최근 경기",
    noRecentMatches: "이 계정의 최근 경기를 찾을 수 없습니다.",
    showMoreMatches: "{count}경기 더 보기",
    clearAllHistory: "검색 기록 모두 삭제 ({count})",
    selectRegion: "서버 선택",
    sampleSizeLabel: "통계에 사용할 최근 경기 수",
    disclaimerLabel: "Riot Games Disclaimer",
    invalidRiotId: "Riot ID를 Name#TAG 형식으로 입력하세요. (예: Faker#KR1)",
    failedToLoadMatches: "경기 기록을 불러오지 못했습니다.",
    clearedRecentSearches: "최근 검색 {count}개를 삭제했습니다.",
    couldntParse: '"{riotId}"를 해석할 수 없습니다. Name#TAG 형식이 필요합니다.',
    savedPlayer: "{riotId}를 저장했습니다.",
    unsavedPlayer: "{riotId} 저장을 해제했습니다.",
    removeRecent: "최근 검색에서 {riotId} 삭제",
    unsaveRiotId: "{riotId} 저장 해제",
    home: "Summoner's Courtroom 홈으로 이동",
    victory: "승리",
    defeat: "패배",
    biggerFaultQuestion: "누가 더 큰 잘못을 했나요?",
    cancel: "취소",
    fullGame: "전체 경기",
    fullGameVictoryUnavailable: "전체 경기 판결은 패배한 경기에서만 사용할 수 있습니다.",
    rankedSoloVerdictOnly: "AI 판결은 랭크 솔로 게임에서만 사용할 수 있습니다.",
    fullGameTooLongWarning:
      "[FULL_GAME_TOO_LONG] 60분을 초과한 경기는 전체 경기 판결을 사용할 수 없습니다. 시간 선택에서 5-10분 구간을 선택해 주세요.",
    specifyTime: "시간 선택",
    pickAgain: "뒤로가기",
    backToScope: "뒤로가기",
    timeSelection: "시간 선택:",
    gameTime: "경기 시간:",
    selectedWindowLength: "{minutes}분 {seconds}초",
    startTime: "시작",
    endTime: "종료",
    minMaxWindow: "최소 5분 · 최대 10분",
    specifyTimeMinWindowWarning: "선택한 구간은 최소 5분 이상이어야 합니다.",
    verdict: "판결",
    verdictTitle: "판결문",
    previewOnlyWarning:
      "미리보기 전용입니다. 판결이 표시되는 방식의 예시이며, 이 결과 생성에는 AI가 사용되지 않았습니다.",
    moreAtFault: "더 큰 잘못이 있는 플레이어",
    judgeAnother: "새 판결",
    close: "닫기",
    judgeDeliberating: "게임 내용 분석 및 심의 중",
    contextualizeStep: "맥락 검토",
    contextualizeStepSub: "경기 데이터를 이해할 수 있는 맥락으로 변환",
    judgeStep: "AI 판정",
    judgeStepSub: "AI가 증거를 검토",
    verdictStep: "판결",
    verdictStepSub: "최종 판결 정리",
    queueRankedSolo: "솔로 랭크",
    queueRankedFlex: "자유 랭크",
    queueNormalGame: "일반 게임",
    queueNormalDraft: "일반 교차 선택",
    queueNormalBlind: "일반 비공개 선택",
    queueAram: "무작위 총력전",
    queueArena: "아레나",
    queueQuickplay: "빠른 대전",
    queueSwiftplay: "스위프트플레이",
    durationMinutesSeconds: "{minutes}분 {seconds}초",
    durationMinutes: "{minutes}분",
    durationSeconds: "{seconds}초",
    relativeHoursAgo: "{count}시간 전",
    relativeDaysAgo: "{count}일 전",
    relativeMinutesAgo: "{count}분 전",
    relativeSecondsAgo: "{count}초 전",
  },
} as const;

export type TranslationKey = keyof typeof translations.en;

function readStoredLocale(): Locale | null {
  try {
    if (typeof window === "undefined") return null;
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "ko" || value === "en" ? value : null;
  } catch {
    return null;
  }
}

function detectLocale(): Locale {
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ko")) {
    return "ko";
  }
  return "en";
}

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    setLocaleState(readStoredLocale() ?? detectLocale());
  }, []);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const t = useMemo(
    () =>
      (key: TranslationKey, vars?: Record<string, string | number>) => {
        let text = translations[locale][key] ?? translations.en[key];
        if (vars) {
          for (const [name, value] of Object.entries(vars)) {
            text = text.replaceAll(`{${name}}`, String(value));
          }
        }
        return text;
      },
    [locale],
  );

  return { locale, setLocale, t };
}
