-- Server-owned AI verdict results.
--
-- A row is created only after the server receives a DeepSeek verdict. Share
-- links are then created from this server-owned snapshot instead of trusting
-- verdict text submitted by the browser.

CREATE TABLE public.verdict_results (
  id               TEXT PRIMARY KEY,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),
  match_id         TEXT,
  locale           TEXT NOT NULL DEFAULT 'en',
  verdict_mode     TEXT NOT NULL,
  selected_players JSONB NOT NULL DEFAULT '[]'::jsonb,
  verdict_display  JSONB NOT NULL,
  reasoning         TEXT NOT NULL
);

CREATE INDEX idx_verdict_results_expires_at
  ON public.verdict_results (expires_at);

ALTER TABLE public.verdict_results ENABLE ROW LEVEL SECURITY;

-- No anon/auth policies: verdict snapshots are read only by server functions.
