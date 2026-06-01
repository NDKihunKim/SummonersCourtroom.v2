CREATE TABLE IF NOT EXISTS public.riot_rate_limit_backoffs (
  scope text PRIMARY KEY,
  blocked_until timestamptz NOT NULL,
  retry_after_seconds integer,
  source_status integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_riot_rate_limit_backoffs_blocked_until
  ON public.riot_rate_limit_backoffs (blocked_until);

ALTER TABLE public.riot_rate_limit_backoffs ENABLE ROW LEVEL SECURITY;
