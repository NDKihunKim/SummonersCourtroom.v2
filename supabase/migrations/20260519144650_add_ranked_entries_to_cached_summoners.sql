ALTER TABLE public.cached_summoners
ADD COLUMN IF NOT EXISTS ranked_entries JSONB;
