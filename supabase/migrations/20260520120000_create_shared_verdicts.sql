-- Shared AI verdict snapshots.
--
-- These rows are public-safe, read-only verdict snapshots created only after
-- a user clicks Share. They intentionally do not store prompts, context JSON,
-- raw model responses, token usage, API keys, or Turnstile tokens.

CREATE TABLE public.shared_verdicts (
  id               TEXT PRIMARY KEY,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),
  match_id         TEXT,
  locale           TEXT NOT NULL DEFAULT 'en',
  verdict_mode     TEXT NOT NULL,
  scope_label      TEXT,
  selected_players JSONB NOT NULL DEFAULT '[]'::jsonb,
  verdict_display  JSONB NOT NULL,
  reasoning         TEXT NOT NULL
);

CREATE INDEX idx_shared_verdicts_expires_at
  ON public.shared_verdicts (expires_at);

ALTER TABLE public.shared_verdicts ENABLE ROW LEVEL SECURITY;

-- No anon/auth policies: public visitors read shares through server functions.
