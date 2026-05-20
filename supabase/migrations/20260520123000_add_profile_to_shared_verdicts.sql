ALTER TABLE public.shared_verdicts
  ADD COLUMN IF NOT EXISTS profile_shard TEXT,
  ADD COLUMN IF NOT EXISTS profile_game_name TEXT,
  ADD COLUMN IF NOT EXISTS profile_tag_line TEXT;
