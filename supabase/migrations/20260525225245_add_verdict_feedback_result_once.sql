-- Tie objections to the server-owned verdict snapshot and allow each signed-in
-- user to object to a specific verdict only once.

ALTER TABLE public.verdict_feedback
  ADD COLUMN verdict_result_id TEXT REFERENCES public.verdict_results(id) ON DELETE CASCADE;

CREATE INDEX idx_verdict_feedback_verdict_result_id
  ON public.verdict_feedback (verdict_result_id);

CREATE UNIQUE INDEX idx_verdict_feedback_one_per_user_verdict
  ON public.verdict_feedback (verdict_result_id, user_id)
  WHERE verdict_result_id IS NOT NULL AND user_id IS NOT NULL;
