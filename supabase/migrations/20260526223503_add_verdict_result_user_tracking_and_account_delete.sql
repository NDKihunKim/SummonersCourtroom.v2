ALTER TABLE public.verdict_results
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS user_display TEXT NOT NULL DEFAULT 'Visitor';

CREATE INDEX IF NOT EXISTS idx_verdict_results_user_id
  ON public.verdict_results (user_id)
  WHERE user_id IS NOT NULL;
