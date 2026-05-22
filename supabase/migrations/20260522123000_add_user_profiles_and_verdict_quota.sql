CREATE TABLE public.user_profiles (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan       TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own profile"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE public.verdict_usage_daily (
  id            BIGSERIAL PRIMARY KEY,
  usage_date    DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  anonymous_id  TEXT,
  ip_hash       TEXT NOT NULL,
  verdict_count INT NOT NULL DEFAULT 0 CHECK (verdict_count >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR anonymous_id IS NOT NULL)
);

CREATE UNIQUE INDEX idx_verdict_usage_daily_user
  ON public.verdict_usage_daily (usage_date, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX idx_verdict_usage_daily_anonymous
  ON public.verdict_usage_daily (usage_date, anonymous_id, ip_hash)
  WHERE user_id IS NULL;

ALTER TABLE public.verdict_usage_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own verdict usage"
  ON public.verdict_usage_daily
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.user_profiles_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.user_profiles_set_updated_at();

CREATE OR REPLACE FUNCTION public.verdict_usage_daily_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_verdict_usage_daily_updated_at
  BEFORE UPDATE ON public.verdict_usage_daily
  FOR EACH ROW
  EXECUTE FUNCTION public.verdict_usage_daily_set_updated_at();

