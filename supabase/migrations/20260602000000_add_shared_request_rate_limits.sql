-- Shared request rate limits table for cross-isolate abuse prevention.
-- Each Cloudflare Workers edge isolate writes to this table so the global
-- rate-limit count is accurate regardless of which edge serves the request.

CREATE TABLE IF NOT EXISTS request_rate_limits (
  scope text NOT NULL,
  key text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  limit_count integer NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (scope, key)
);

-- Index for periodic cleanup of expired rows (see request-rate-limit-shared.ts).
CREATE INDEX IF NOT EXISTS idx_request_rate_limits_expires
  ON request_rate_limits (expires_at);

-- Atomic increment with window-reset logic.
-- Uses pg_advisory_xact_lock on the table's oid to serialize per-key updates
-- so two concurrent isolates cannot both pass the limit.
CREATE OR REPLACE FUNCTION consume_request_rate_limit_atomic(
  p_scope text,
  p_key text,
  p_limit integer,
  p_window_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_count integer;
  v_expires timestamptz;
  v_table_oid oid;
BEGIN
  -- Serialize access by scope+key to prevent race conditions across isolates.
  SELECT pc.oid INTO v_table_oid
    FROM pg_class pc
    JOIN pg_namespace pn ON pc.relnamespace = pn.oid
   WHERE pc.relname = 'request_rate_limits' AND pn.nspname = 'public';

  PERFORM pg_advisory_xact_lock(v_table_oid, hashtext(p_scope || ':' || p_key));

  SELECT window_started_at, count
    INTO v_window_start, v_count
    FROM request_rate_limits
   WHERE scope = p_scope AND key = p_key;

  -- If no row or window expired, start fresh.
  IF NOT FOUND OR v_window_start + (p_window_ms * interval '1 ms') <= v_now THEN
    v_expires := v_now + (p_window_ms * interval '1 ms') + interval '5 minutes';
    INSERT INTO request_rate_limits (scope, key, count, limit_count, window_started_at, expires_at, updated_at)
    VALUES (p_scope, p_key, 1, p_limit, v_now, v_expires, v_now)
    ON CONFLICT (scope, key) DO UPDATE
    SET count = 1,
        limit_count = p_limit,
        window_started_at = v_now,
        expires_at = v_expires,
        updated_at = v_now;
    RETURN jsonb_build_object('consumed', true, 'count', 1, 'limit', p_limit, 'remaining', p_limit - 1);
  END IF;

  -- Window still active -- check limit.
  IF v_count >= p_limit THEN
    RETURN jsonb_build_object('consumed', false, 'count', v_count, 'limit', p_limit, 'remaining', 0);
  END IF;

  -- Increment.
  v_expires := v_window_start + (p_window_ms * interval '1 ms') + interval '5 minutes';
  UPDATE request_rate_limits
     SET count = count + 1, updated_at = v_now, expires_at = v_expires
   WHERE scope = p_scope AND key = p_key;

  RETURN jsonb_build_object('consumed', true, 'count', v_count + 1, 'limit', p_limit, 'remaining', p_limit - v_count - 1);
END;
$$;

-- Only the service_role (supabaseAdmin) can call the atomic function.
REVOKE ALL ON FUNCTION consume_request_rate_limit_atomic(text, text, integer, integer) FROM PUBLIC;
