-- Nuke-and-pave shared verdict links.
--
-- Existing share rows can be discarded. From this point on, shared_verdicts is
-- only a public-link pointer to a server-owned verdict_results row.

DROP TABLE IF EXISTS public.shared_verdicts CASCADE;

CREATE TABLE public.shared_verdicts (
  id                TEXT PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),
  verdict_result_id TEXT NOT NULL REFERENCES public.verdict_results(id) ON DELETE CASCADE,
  profile_shard     TEXT,
  profile_game_name TEXT,
  profile_tag_line  TEXT,
  scope_label       TEXT
);

CREATE INDEX idx_shared_verdicts_expires_at
  ON public.shared_verdicts (expires_at);

CREATE INDEX idx_shared_verdicts_verdict_result_id
  ON public.shared_verdicts (verdict_result_id);

ALTER TABLE public.shared_verdicts ENABLE ROW LEVEL SECURITY;

-- No anon/auth policies: public visitors read shares through server functions.
