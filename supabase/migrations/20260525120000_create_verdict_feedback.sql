-- User objections to AI verdict reasoning.
--
-- These rows are private operational/product feedback. They intentionally do
-- not store prompts, context JSON, raw model diagnostics, API keys, or
-- Turnstile tokens.

CREATE TABLE public.verdict_feedback (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  anonymous_id_hash       TEXT,
  source                  TEXT NOT NULL CHECK (source IN ('verdict', 'shared')),
  share_id                TEXT,
  match_id                TEXT,
  locale                  TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ko')),
  verdict_mode            TEXT NOT NULL,
  scope_label             TEXT,
  selected_players        JSONB NOT NULL DEFAULT '[]'::jsonb,
  verdict_display         JSONB NOT NULL,
  selected_reason_indexes INTEGER[] NOT NULL,
  selected_reasons        JSONB NOT NULL DEFAULT '[]'::jsonb,
  complaint               TEXT
);

CREATE INDEX idx_verdict_feedback_created_at
  ON public.verdict_feedback (created_at DESC);

CREATE INDEX idx_verdict_feedback_match_id
  ON public.verdict_feedback (match_id);

CREATE INDEX idx_verdict_feedback_share_id
  ON public.verdict_feedback (share_id);

CREATE INDEX idx_verdict_feedback_user_id
  ON public.verdict_feedback (user_id);

ALTER TABLE public.verdict_feedback ENABLE ROW LEVEL SECURITY;

-- No anon/auth policies: clients submit feedback through server functions only.
