import { ChampionIcon } from "./ChampionIcon";
import { ItemGrid } from "./ItemGrid";
import { RuneIcons } from "./RuneIcons";
import { SummonerSpells } from "./SummonerSpells";
import { sortByRole } from "@/lib/role-order";
import type { Match, Participant } from "@/lib/match-types";
import type { Locale, TranslationKey } from "@/i18n";

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

function withFallbackTeam(player: Participant, fallbackTeamId: Participant["teamId"]): Participant {
  return player.teamId ? player : { ...player, teamId: fallbackTeamId };
}

function ScoreboardRow({
  player,
  formatChampionName,
  t,
  locale,
}: {
  player: Participant;
  formatChampionName: (champion: string) => string;
  t: Translate;
  locale: Locale;
}) {
  const championLabel = formatChampionName(player.champion);
  const cs = typeof player.cs === "number" ? player.cs : "—";
  const items = player.items ?? [];
  const trinket = player.trinket ?? 0;

  return (
    <div className="grid grid-cols-[minmax(0,1.25fr)_2.4rem_3.4rem_minmax(86px,auto)] items-center gap-2 rounded-md border border-border/60 bg-background/45 px-2 py-1.5 shadow-[0_0_16px_rgba(255,199,89,0.03)] sm:grid-cols-[minmax(0,1.3fr)_2.6rem_3.6rem_minmax(108px,1fr)]">
      <div className="flex min-w-0 items-center gap-2">
        <ChampionIcon champion={player.champion} size={30} ring={false} />
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          <SummonerSpells spells={player.spells ?? ["", ""]} size={15} locale={locale} />
          <div className="w-px bg-border/60" style={{ height: 15 * 2 + 2 }} />
          <RuneIcons runes={player.runes} size={15} locale={locale} />
        </div>
        <div className="min-w-0">
          <div
            className="truncate text-xs font-semibold text-foreground sm:text-sm"
            title={championLabel}
          >
            {championLabel}
          </div>
          <div
            className="truncate text-[10px] leading-tight text-muted-foreground sm:text-xs"
            title={player.summoner}
          >
            {player.summoner}
          </div>
        </div>
      </div>
      <div className="text-center">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
          CS
        </div>
        <div className="text-xs font-semibold text-foreground">{cs}</div>
      </div>
      <div className="text-center">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
          K/D/A
        </div>
        <div className="text-xs font-semibold text-foreground">
          {player.kills}/{player.deaths}/{player.assists}
        </div>
      </div>
      <div>
        <div className="mb-0.5 text-center text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("scoreboardItems")}
        </div>
        <div className="flex justify-center">
          <ItemGrid items={items} trinket={trinket} size={17} locale={locale} />
        </div>
      </div>
    </div>
  );
}

function ScoreboardTeam({
  title,
  players,
  accentClass,
  formatChampionName,
  t,
  locale,
}: {
  title: string;
  players: Participant[];
  accentClass: string;
  formatChampionName: (champion: string) => string;
  t: Translate;
  locale: Locale;
}) {
  return (
    <div>
      <div
        className={`mb-2 text-center text-xs font-bold uppercase tracking-[0.2em] ${accentClass}`}
      >
        {title}
      </div>
      <div className="space-y-1.5">
        {players.map((player) => (
          <ScoreboardRow
            key={`${player.puuid ?? player.summoner}-${player.champion}`}
            player={player}
            formatChampionName={formatChampionName}
            t={t}
            locale={locale}
          />
        ))}
      </div>
    </div>
  );
}

export function MatchScoreboard({
  match,
  viewedParticipant,
  open,
  formatChampionName,
  t,
  locale,
}: {
  match: Match;
  viewedParticipant: Participant;
  open: boolean;
  formatChampionName: (champion: string) => string;
  t: Translate;
  locale: Locale;
}) {
  const viewedTeamId = match.userTeamId;
  const enemyTeamId = viewedTeamId === 100 ? 200 : viewedTeamId === 200 ? 100 : undefined;
  const allies = [viewedParticipant, ...match.team].map((player) =>
    withFallbackTeam(player, viewedTeamId),
  );
  const enemies = match.enemies.map((player) => withFallbackTeam(player, enemyTeamId));
  const roster = [...allies, ...enemies];
  const blue = sortByRole(roster.filter((player) => player.teamId === 100));
  const red = sortByRole(roster.filter((player) => player.teamId === 200));

  if (blue.length === 0 && red.length === 0) return null;

  return (
    <div
      className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
        open ? "mb-4 mt-4 grid-rows-[1fr] opacity-100" : "my-0 grid-rows-[0fr] opacity-0"
      }`}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={`overflow-hidden rounded-lg border border-border bg-card/70 p-3 transition-transform duration-300 ease-out min-[900px]:overflow-x-auto ${
            open ? "translate-y-0" : "-translate-y-2"
          }`}
        >
          <div className="space-y-4 min-[900px]:hidden">
            <ScoreboardTeam
              title={t("scoreboardBlueTeam")}
              players={blue}
              accentClass="text-hex-blue"
              formatChampionName={formatChampionName}
              t={t}
              locale={locale}
            />
            <div className="flex justify-center">
              <span className="text-2xl font-black uppercase tracking-wider text-gold">VS</span>
            </div>
            <ScoreboardTeam
              title={t("scoreboardRedTeam")}
              players={red}
              accentClass="text-destructive"
              formatChampionName={formatChampionName}
              t={t}
              locale={locale}
            />
          </div>
          <div className="hidden min-w-[860px] grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)] items-stretch gap-3 min-[900px]:grid">
            <ScoreboardTeam
              title={t("scoreboardBlueTeam")}
              players={blue}
              accentClass="text-hex-blue"
              formatChampionName={formatChampionName}
              t={t}
              locale={locale}
            />
            <div className="flex items-center justify-center">
              <span className="text-xl font-black uppercase tracking-wider text-gold">VS</span>
            </div>
            <ScoreboardTeam
              title={t("scoreboardRedTeam")}
              players={red}
              accentClass="text-destructive"
              formatChampionName={formatChampionName}
              t={t}
              locale={locale}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
