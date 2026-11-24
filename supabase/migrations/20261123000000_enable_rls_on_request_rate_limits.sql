-- The shared rate-limit table is accessed only through the service role
-- (consume_request_rate_limit_atomic). RLS is enabled as defense in depth,
-- and anon/authenticated lose direct table access so client keys cannot
-- read or manipulate rate-limit rows.
alter table public.request_rate_limits enable row level security;

revoke all on table public.request_rate_limits from anon, authenticated;
