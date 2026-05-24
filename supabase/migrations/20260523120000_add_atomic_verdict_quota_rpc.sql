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
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'Quota limit must be positive.';
  END IF;

  IF p_user_id IS NULL AND NULLIF(p_anonymous_id, '') IS NULL THEN
    RAISE EXCEPTION 'Quota identity is required.';
  END IF;

  v_key := CASE
    WHEN p_user_id IS NOT NULL THEN 'user:' || p_usage_date::TEXT || ':' || p_user_id::TEXT
    ELSE 'anonymous:' || p_usage_date::TEXT || ':' || COALESCE(p_anonymous_id, '') || ':' || p_ip_hash
  END;

  PERFORM pg_advisory_xact_lock(hashtext('verdict_quota'), hashtext(v_key));

  IF p_user_id IS NOT NULL THEN
    SELECT id, verdict_count
      INTO v_id, v_used
      FROM public.verdict_usage_daily
      WHERE usage_date = p_usage_date
        AND user_id = p_user_id
      FOR UPDATE;
  ELSE
    SELECT id, verdict_count
      INTO v_id, v_used
      FROM public.verdict_usage_daily
      WHERE usage_date = p_usage_date
        AND user_id IS NULL
        AND anonymous_id = p_anonymous_id
        AND ip_hash = p_ip_hash
      FOR UPDATE;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.verdict_usage_daily (
      usage_date,
      user_id,
      anonymous_id,
      ip_hash,
      verdict_count
    )
    VALUES (
      p_usage_date,
      p_user_id,
      CASE WHEN p_user_id IS NULL THEN p_anonymous_id ELSE NULL END,
      p_ip_hash,
      1
    )
    RETURNING id, verdict_count INTO v_id, v_used;

    RETURN jsonb_build_object(
      'consumed', TRUE,
      'used', v_used,
      'remaining', GREATEST(0, p_limit - v_used),
      'limit', p_limit
    );
  END IF;

  IF v_used >= p_limit THEN
    RETURN jsonb_build_object(
      'consumed', FALSE,
      'used', v_used,
      'remaining', 0,
      'limit', p_limit
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
    'limit', p_limit
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
  v_used INT;
BEGIN
  IF p_user_id IS NULL AND NULLIF(p_anonymous_id, '') IS NULL THEN
    RAISE EXCEPTION 'Quota identity is required.';
  END IF;

  v_key := CASE
    WHEN p_user_id IS NOT NULL THEN 'user:' || p_usage_date::TEXT || ':' || p_user_id::TEXT
    ELSE 'anonymous:' || p_usage_date::TEXT || ':' || COALESCE(p_anonymous_id, '') || ':' || p_ip_hash
  END;

  PERFORM pg_advisory_xact_lock(hashtext('verdict_quota'), hashtext(v_key));

  IF p_user_id IS NOT NULL THEN
    UPDATE public.verdict_usage_daily
      SET verdict_count = GREATEST(0, verdict_count - 1)
      WHERE usage_date = p_usage_date
        AND user_id = p_user_id
        AND verdict_count > 0
      RETURNING verdict_count INTO v_used;
  ELSE
    UPDATE public.verdict_usage_daily
      SET verdict_count = GREATEST(0, verdict_count - 1)
      WHERE usage_date = p_usage_date
        AND user_id IS NULL
        AND anonymous_id = p_anonymous_id
        AND ip_hash = p_ip_hash
        AND verdict_count > 0
      RETURNING verdict_count INTO v_used;
  END IF;

  RETURN jsonb_build_object(
    'refunded', v_used IS NOT NULL,
    'used', COALESCE(v_used, 0)
  );
END;
$refund$;

REVOKE ALL ON FUNCTION public.consume_verdict_quota_atomic(DATE, UUID, TEXT, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_verdict_quota_atomic(DATE, UUID, TEXT, TEXT, INT) FROM anon;
REVOKE ALL ON FUNCTION public.consume_verdict_quota_atomic(DATE, UUID, TEXT, TEXT, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_verdict_quota_atomic(DATE, UUID, TEXT, TEXT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.refund_verdict_quota_atomic(DATE, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_verdict_quota_atomic(DATE, UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.refund_verdict_quota_atomic(DATE, UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refund_verdict_quota_atomic(DATE, UUID, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
