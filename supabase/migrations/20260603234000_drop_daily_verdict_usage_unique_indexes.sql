DROP INDEX IF EXISTS public.idx_verdict_usage_daily_user;
DROP INDEX IF EXISTS public.idx_verdict_usage_daily_anonymous;

CREATE INDEX IF NOT EXISTS idx_verdict_usage_daily_user_date
  ON public.verdict_usage_daily (usage_date, user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_verdict_usage_daily_anonymous_date
  ON public.verdict_usage_daily (usage_date, anonymous_id, ip_hash)
  WHERE user_id IS NULL;
