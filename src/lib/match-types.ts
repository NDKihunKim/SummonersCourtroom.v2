/**
 * Shared, client-safe types for match data. Extracted from `mock-data.ts` so
 * server functions and components can import them without dragging mock
 * generators into the bundle.
 */

export type Participant = {
  champion: string;
  summoner: string;
  kills: number;
  deaths: number;
  assists: number;
  /** End-game creep score. Optional for older cached match rows. */
  cs?: number;
  /**
   * The 6 main inventory slots (item0..item5), preserved positionally.
   * Optional for cached rows written before full scoreboard support.
   */
  items?: number[];
  /** Trinket slot (item6). Optional for older cached match rows. */
  trinket?: number;
  /** Summoner spells. Optional for cached rows written before scoreboard loadouts. */
  spells?: [string, string];
  /** Keystone + secondary rune tree. Optional for cached rows written before scoreboard loadouts. */
  runes?: { keystoneId: number; secondaryStyleId: number };
  /** Riot PUUID for the ally — required for the judge pipeline. */
  puuid?: string;
  /**
   * Riot teamId (100 = Blue side, 200 = Red side). Optional so cached rows
   * written before this field was added still deserialize cleanly.
   */
  teamId?: 100 | 200;
  /**
   * Riot teamPosition: "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY".
   * May be "" / missing for remakes or non-ranked queues. Consumers should
   * treat empty/unknown as "Unknown".
   */
  teamPosition?: string;
};

export type Match = {
  id: string;
  queue: string;
  result: "Victory" | "Defeat";
  duration: string;
  /** Absolute game end timestamp in epoch ms. Used to render fresh relative time from cache. */
  playedAtMs?: number;
  playedAt: string;
  champion: string;
  championIconSeed: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
  damage: number;
  vision: number;
  /**
   * The 6 main inventory slots (item0..item5), preserved positionally.
   * Empty slots are kept as `0` so the UI grid stays aligned.
   */
  items: number[];
  /** Trinket slot (item6). `0` when the player has no trinket. */
  trinket: number;
  spells: [string, string];
  /**
   * Keystone perk id (e.g. 8005 Press the Attack) and secondary tree id
   * (e.g. 8100 Domination). Optional for backward compat with cached rows.
   */
  runes?: { keystoneId: number; secondaryStyleId: number };
  team: Participant[];
  enemies: Participant[];
  /** Riot match-v5 id (e.g. NA1_7344857921). Sent to Python contextualizer. */
  riotMatchId?: string;
  /** PUUID of the summoner this row represents ("you"). */
  userPuuid?: string;
  /** Regional routing slug for the match host. */
  routingRegion?: "americas" | "europe" | "asia" | "sea";
  /**
   * The viewing player's own teamId / teamPosition. The viewer is not in
   * `team` or `enemies`, so we surface their side + role at the top level
   * for components (e.g. the Judge prompt rundown) that need a complete
   * 5-vs-5 picture. Optional for backward compatibility with old caches.
   */
  userTeamId?: 100 | 200;
  userTeamPosition?: string;
};
