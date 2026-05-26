CREATE TABLE IF NOT EXISTS public.deleted_account_identities (
  id BIGSERIAL PRIMARY KEY,
  identity_hash TEXT NOT NULL UNIQUE,
  provider TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  verdict_count INT NOT NULL DEFAULT 0 CHECK (verdict_count >= 0),
  window_started_at TIMESTAMPTZ,
  reset_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  purge_after TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX IF NOT EXISTS idx_deleted_account_identities_purge_after
  ON public.deleted_account_identities (purge_after);

ALTER TABLE public.deleted_account_identities ENABLE ROW LEVEL SECURITY;

-- No anon/auth policies. This table is read/written only by service-role
-- server functions for abuse prevention and quota continuity after deletion.
