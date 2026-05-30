import test from "node:test";
import assert from "node:assert/strict";
import { shouldRefetchCachedMatchForRefresh } from "../src/lib/match-cache.ts";
import type { Match } from "../src/lib/match-types.ts";

const baseMatch: Match = {
  id: "KR_1",
  riotMatchId: "KR_1",
  queue: "Ranked Solo",
  result: "Victory",
  duration: "30m 0s",
  playedAt: "12h ago",
  champion: "Ezreal",
  championIconSeed: 1,
  kills: 1,
  deaths: 2,
  assists: 3,
  cs: 100,
  gold: 10000,
  damage: 10000,
  vision: 10,
  items: [0, 0, 0, 0, 0, 0],
  trinket: 0,
  spells: ["Flash", "Heal"],
  team: [],
  enemies: [],
};

test("legacy cached matches without playedAtMs are refetched on refresh", () => {
  assert.equal(shouldRefetchCachedMatchForRefresh(baseMatch), true);
});

test("cached matches with a usable playedAtMs can be reused on refresh", () => {
  assert.equal(
    shouldRefetchCachedMatchForRefresh({ ...baseMatch, playedAtMs: 1_700_000_000_000 }),
    false,
  );
});
