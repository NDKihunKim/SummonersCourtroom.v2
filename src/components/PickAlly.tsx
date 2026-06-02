import { Fragment, useState } from "react";
import { Gavel } from "lucide-react";
import { ModeButton, PlayerTile } from "./PickAllyHelpers";
import { MatchScoreboard } from "./MatchScoreboard";
import { sortByRole } from "@/lib/role-order";
import type { Match, Participant } from "@/lib/match-types";
import type { Locale, TranslationKey } from "@/i18n";

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;
type FaultMode = "me-vs-1" | "one-vs-one" | "free-for-all" | "switch-teams";

function participantKey(player: Participant): string {
  return player.puuid ?? player.summoner?.toLowerCase() ?? player.champion;
}

export function PickAlly({
  mode,
  onModeChange,
  showEnemyTeam,
  onSwitchTeams,
  match,
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
  scoreboardOpen,
  onToggleScoreboard,
  selectedA,
  selectedB,
  t,
  locale,
  formatChampionName,
}: {
  mode: FaultMode;
  onModeChange: (mode: FaultMode) => void;
  showEnemyTeam: boolean;
  onSwitchTeams: () => void;
  match: Match;
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
  scoreboardOpen: boolean;
  onToggleScoreboard: () => void;
  selectedA?: Participant;
  selectedB?: Participant;
  t: Translate;
  locale: Locale;
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
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-1 text-sm font-semibold uppercase tracking-wider text-gold">
            <Gavel className="mr-1 inline h-3.5 w-3.5" /> {t("biggerFaultQuestion")}
          </h3>
          <ModeButton active={mode === "free-for-all"} onClick={() => selectMode("free-for-all")}>
            Free for All
          </ModeButton>
          {!showEnemyTeam ? (
            <ModeButton active={mode === "me-vs-1"} onClick={() => selectMode("me-vs-1")}>
              Me vs 1
            </ModeButton>
          ) : null}
          <ModeButton active={mode === "one-vs-one"} onClick={() => selectMode("one-vs-one")}>
            1 vs 1
          </ModeButton>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModeButton active={scoreboardOpen} onClick={onToggleScoreboard}>
            {scoreboardOpen ? t("scoreboardHide") : t("scoreboardShow")}
          </ModeButton>
          <ModeButton active={showEnemyTeam} onClick={switchTeams}>
            Switch Teams
          </ModeButton>
        </div>
      </div>

      <MatchScoreboard
        match={match}
        viewedParticipant={you}
        open={scoreboardOpen}
        formatChampionName={formatChampionName}
        t={t}
        locale={locale}
      />

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
