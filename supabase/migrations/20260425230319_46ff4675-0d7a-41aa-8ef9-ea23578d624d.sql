-- ============================================================================
-- cached_summoners — shared cache of previously searched League players.
--
-- Powers two features:
--   1. Autocomplete "shared index": suggest players that have been searched
--      ≥ 2 times on the same shard, sorted by tier (Challenger → Iron).
--   2. Instant match-history page loads: cache the normalized match list so
--      a second visitor for the same Riot ID skips Riot API calls entirely.
--      A refresh button (server-side cooldown) re-fetches from Riot.
--
-- Composite primary key is (shard, puuid) because Riot's puuid is globally
-- unique already, but pairing with shard keeps single-shard queries index-only.
-- ============================================================================

CREATE TABLE public.cached_summoners (
  shard           TEXT NOT NULL,
  puuid           TEXT NOT NULL,
  game_name       TEXT NOT NULL,
  tag_line        TEXT NOT NULL,
  -- Ranked Solo/Duo tier info (RANKED_SOLO_5x5). Nullable = unranked.
  tier            TEXT,
  division        TEXT,
  lp              INT,
  queue_type      TEXT NOT NULL DEFAULT 'RANKED_SOLO_5x5',
  -- Suggestion gating: only show in shared index when search_count >= 2.
  search_count    INT NOT NULL DEFAULT 1,
  -- When the cached match list was last fetched from Riot.
  cached_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Used for the per-player refresh-button cooldown.
  last_refresh_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Normalized Match[] payload — same shape we render in the UI.
  matches         JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Sortable single integer derived from tier/division/lp by trigger below.
  -- Higher = better rank. 0 = unranked (sorts last).
  tier_rank       INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shard, puuid)
);

-- Fast prefix-match lookup for autocomplete. Functional index on lower(name).
CREATE INDEX idx_cached_summoners_shard_name_lower
  ON public.cached_summoners (shard, lower(game_name) text_pattern_ops);

-- "Top players on this shard" query — used to rank suggestions.
CREATE INDEX idx_cached_summoners_shard_rank
  ON public.cached_summoners (shard, tier_rank DESC, search_count DESC);

-- ----------------------------------------------------------------------------
-- tier_rank computation
--
-- We map tier+division+lp to a single int so the DB can sort suggestions in
-- index order. Layout (decimal-friendly so it's easy to debug):
--
--   tier_base  +  division_offset  +  lp
--
--   Challenger: 10000 (no division, lp added directly, capped at 9999)
--   Grandmaster: 9000
--   Master:      8000
--   Diamond:     7000  (I=400, II=300, III=200, IV=100) + lp/2
--   Emerald:     6000  (same)
--   Platinum:    5000
--   Gold:        4000
--   Silver:      3000
--   Bronze:      2000
--   Iron:        1000
--   Unranked / null tier → 0
--
-- LP is divided by 2 in apex tiers below GM so a Diamond I 99LP doesn't
-- overflow into the next bucket. Apex tiers (Master+) just add lp directly,
-- capped at 9999 to keep them within their bucket.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.compute_tier_rank(
  p_tier     TEXT,
  p_division TEXT,
  p_lp       INT
) RETURNS INT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  base   INT := 0;
  divoff INT := 0;
  lpadd  INT := 0;
BEGIN
  IF p_tier IS NULL THEN
    RETURN 0;
  END IF;

  CASE upper(p_tier)
    WHEN 'CHALLENGER'  THEN base := 10000; lpadd := LEAST(COALESCE(p_lp, 0), 9999);
    WHEN 'GRANDMASTER' THEN base := 9000;  lpadd := LEAST(COALESCE(p_lp, 0), 999);
    WHEN 'MASTER'      THEN base := 8000;  lpadd := LEAST(COALESCE(p_lp, 0), 999);
    WHEN 'DIAMOND'     THEN base := 7000;
    WHEN 'EMERALD'     THEN base := 6000;
    WHEN 'PLATINUM'    THEN base := 5000;
    WHEN 'GOLD'        THEN base := 4000;
    WHEN 'SILVER'      THEN base := 3000;
    WHEN 'BRONZE'      THEN base := 2000;
    WHEN 'IRON'        THEN base := 1000;
    ELSE                    base := 0;
  END CASE;

  -- Divisional tiers (Iron..Diamond) get a division offset + half-LP nudge.
  IF base BETWEEN 1000 AND 7999 THEN
    CASE upper(COALESCE(p_division, 'IV'))
      WHEN 'I'   THEN divoff := 400;
      WHEN 'II'  THEN divoff := 300;
      WHEN 'III' THEN divoff := 200;
      WHEN 'IV'  THEN divoff := 100;
      ELSE            divoff := 100;
    END CASE;
    lpadd := LEAST(COALESCE(p_lp, 0) / 2, 99);
  END IF;

  RETURN base + divoff + lpadd;
END;
$$;

-- Trigger keeps tier_rank in sync. Validation triggers > CHECK constraints
-- because we want logic, not a static expression.
CREATE OR REPLACE FUNCTION public.cached_summoners_set_tier_rank()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.tier_rank := public.compute_tier_rank(NEW.tier, NEW.division, NEW.lp);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cached_summoners_tier_rank
  BEFORE INSERT OR UPDATE ON public.cached_summoners
  FOR EACH ROW
  EXECUTE FUNCTION public.cached_summoners_set_tier_rank();/Users/andykim/Desktop/loljudge_Project/match-history-pro/supabase/migrations/20260425231812_60c38d44-11e9-48c1-a163-09280df796d4.sql

-- ----------------------------------------------------------------------------
-- Row-Level Security
--
-- - Public SELECT: cached data is just public Riot stats; suggestions need to
--   work for signed-out users.
-- - No INSERT/UPDATE/DELETE policies → anon/auth roles cannot write. Writes
--   go through server functions using the service-role client, which bypasses
--   RLS by design.
-- ----------------------------------------------------------------------------

ALTER TABLE public.cached_summoners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cached summoners are publicly readable"
  ON public.cached_summoners
  FOR SELECT
  USING (true);
