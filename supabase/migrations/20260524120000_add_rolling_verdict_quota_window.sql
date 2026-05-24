ALTER TABLE public.verdict_usage_daily
ADD COLUMN IF NOT EXISTS window_started_at TIMESTAMPTZ;

UPDATE public.verdict_usage_daily
SET window_started_at = created_at
WHERE window_started_at IS NULL;

ALTER TABLE public.verdict_usage_daily
ALTER COLUMN window_started_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_verdict_usage_daily_user_window
  ON public.verdict_usage_daily (user_id, window_started_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_verdict_usage_daily_anonymous_window
  ON public.verdict_usage_daily (anonymous_id, ip_hash, window_started_at DESC)
  WHERE user_id IS NULL;

CREATE OR REPLACE FUNCTION public.consume_verdict_quota_atomic(
  p_usage_date DATE,
  p_user_id UUID,
  p_anonymous_id TEXT,
  p_ip_hash TEXT,
  p_limit INT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $consume$
DECLARE
  v_key TEXT;
  v_id BIGINT;
  v_used INT;
  v_window_started_at TIMESTAMPTZ;
  v_reset_at TIMESTAMPTZ;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'Quota limit must be positive.';
  END IF;

  IF p_user_id IS NULL AND NULLIF(p_anonymous_id, '') IS NULL THEN
    RAISE EXCEPTION 'Quota identity is required.';
  END IF;

  v_key := CASE
    WHEN p_user_id IS NOT NULL THEN 'user:' || p_user_id::TEXT
    ELSE 'anonymous:' || COALESCE(p_anonymous_id, '') || ':' || p_ip_hash
  END;

  PERFORM pg_advisory_xact_lock(hashtext('verdict_quota'), hashtext(v_key));

  IF p_user_id IS NOT NULL THEN
    SELECT id, verdict_count, window_started_at
      INTO v_id, v_used, v_window_started_at
      FROM public.verdict_usage_daily
      WHERE user_id = p_user_id
        AND window_started_at > now() - interval '24 hours'
      ORDER BY window_started_at DESC
      LIMIT 1
      FOR UPDATE;
  ELSE
    SELECT id, verdict_count, window_started_at
      INTO v_id, v_used, v_window_started_at
      FROM public.verdict_usage_daily
      WHERE user_id IS NULL
        AND anonymous_id = p_anonymous_id
        AND ip_hash = p_ip_hash
        AND window_started_at > now() - interval '24 hours'
      ORDER BY window_started_at DESC
      LIMIT 1
      FOR UPDATE;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.verdict_usage_daily (
      usage_date,
      user_id,
      anonymous_id,
      ip_hash,
      verdict_count,
      window_started_at
    )
    VALUES (
      COALESCE(p_usage_date, (now() AT TIME ZONE 'utc')::date),
      p_user_id,
      CASE WHEN p_user_id IS NULL THEN p_anonymous_id ELSE NULL END,
      p_ip_hash,
      1,
      now()
    )
    RETURNING id, verdict_count, window_started_at
      INTO v_id, v_used, v_window_started_at;

    v_reset_at := v_window_started_at + interval '24 hours';

    RETURN jsonb_build_object(
      'consumed', TRUE,
      'used', v_used,
      'remaining', GREATEST(0, p_limit - v_used),
      'limit', p_limit,
      'resetAt', to_char(v_reset_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  END IF;

  v_reset_at := v_window_started_at + interval '24 hours';

  IF v_used >= p_limit THEN
    RETURN jsonb_build_object(
      'consumed', FALSE,
      'used', v_used,
      'remaining', 0,
      'limit', p_limit,
      'resetAt', to_char(v_reset_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  END IF;

  UPDATE public.verdict_usage_daily
    SET verdict_count = verdict_count + 1
    WHERE id = v_id
    RETURNING verdict_count INTO v_used;

  RETURN jsonb_build_object(
    'consumed', TRUE,
    'used', v_used,
    'remaining', GREATEST(0, p_limit - v_used),
    'limit', p_limit,
    'resetAt', to_char(v_reset_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
END;
$consume$;

CREATE OR REPLACE FUNCTION public.refund_verdict_quota_atomic(
  p_usage_date DATE,
  p_user_id UUID,
  p_anonymous_id TEXT,
  p_ip_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $refund$
DECLARE
  v_key TEXT;
  v_id BIGINT;
  v_used INT;
BEGIN
  IF p_user_id IS NULL AND NULLIF(p_anonymous_id, '') IS NULL THEN
    RAISE EXCEPTION 'Quota identity is required.';
  END IF;

  v_key := CASE
    WHEN p_user_id IS NOT NULL THEN 'user:' || p_user_id::TEXT
    ELSE 'anonymous:' || COALESCE(p_anonymous_id, '') || ':' || p_ip_hash
  END;

  PERFORM pg_advisory_xact_lock(hashtext('verdict_quota'), hashtext(v_key));

  IF p_user_id IS NOT NULL THEN
    SELECT id, verdict_count
      INTO v_id, v_used
      FROM public.verdict_usage_daily
      WHERE user_id = p_user_id
        AND window_started_at > now() - interval '24 hours'
      ORDER BY window_started_at DESC
      LIMIT 1
      FOR UPDATE;
  ELSE
    SELECT id, verdict_count
      INTO v_id, v_used
      FROM public.verdict_usage_daily
      WHERE user_id IS NULL
        AND anonymous_id = p_anonymous_id
        AND ip_hash = p_ip_hash
        AND window_started_at > now() - interval '24 hours'
      ORDER BY window_started_at DESC
      LIMIT 1
      FOR UPDATE;
  END IF;

  IF v_id IS NULL OR v_used <= 0 THEN
    RETURN jsonb_build_object('refunded', FALSE, 'used', 0);
  END IF;

  IF v_used = 1 THEN
    DELETE FROM public.verdict_usage_daily
      WHERE id = v_id;
    RETURN jsonb_build_object('refunded', TRUE, 'used', 0);
  END IF;

  UPDATE public.verdict_usage_daily
    SET verdict_count = verdict_count - 1
    WHERE id = v_id
    RETURNING verdict_count INTO v_used;

  RETURN jsonb_build_object('refunded', TRUE, 'used', v_used);
END;
$refund$;

NOTIFY pgrst, 'reload schema';
