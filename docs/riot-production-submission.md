# Riot Production API Submission Notes

Product description:

Summoner's Courtroom analyzes completed League of Legends matches and helps players review post-game decisions.

## Deployment Target

- Host: Cloudflare Workers via Wrangler.
- Worker name: `summoners-courtroom`.
- Production build: `npm run build`.
- Dry-run deploy check: `npm run deploy:dry-run`.
- Production deploy: `npm run deploy`.
- Use the HTTPS Cloudflare URL for prototype review, then switch to the final custom domain before submitting the production key request.

## Production Environment

Set production secrets in Cloudflare, not in committed files:

```bash
wrangler secret put RIOT_API_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put AI_GATEWAY_TOKEN
```

Set production runtime values in Cloudflare as non-secret environment variables:

```bash
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_PROJECT_ID
VITE_TURNSTILE_SITE_KEY
AI_GATEWAY_URL
VITE_ENABLE_DEV_CONTEXT=false
```

Production context inspection must stay disabled:

- Leave `VITE_ENABLE_DEV_CONTEXT` unset or `false`.
- Do not expose `ADMIN_CONTEXT_TOKEN` to the browser.
- Do not put Riot keys, Supabase service-role keys, Turnstile secret keys, or AI gateway tokens in any `VITE_*` variable.

## Positioning

- Post-game match review only.
- No live-game coaching or real-time advantage.
- No hidden MMR or Elo calculator.
- No betting, gambling, crypto, NFTs, boosting, account trading, or harassment features.
- Public users see verdict results and reasoning, not the internal prompt, evidence JSON, or LLM input payload.

## Riot API Usage Summary

- Riot ID lookup: resolve searched Riot ID to account data.
- Summoner/profile data: show public profile icon metadata.
- Ranked data: show ranked solo tier when available.
- Completed match history: load recent completed matches for the searched player.
- Completed match detail/timeline: used only for post-game review/context, not live-game assistance.

## Riot Rate-Limit Protection

- App-level search, refresh, verdict, share, feedback, and account actions are rate limited before expensive server work.
- Riot `429` responses are converted to safe user-facing errors.
- Riot `Retry-After` is stored in `riot_rate_limit_backoffs` by Riot routing scope so later Worker isolates stop future Riot calls for that scope until the backoff expires.
- Match-history caching reuses cached match detail objects and fetches only new recent match details when refreshing a player.
- Add Cloudflare WAF/rate-limit rules as an outer abuse layer:
  - rate limit search/profile fetch requests by IP.
  - rate limit refresh requests more strictly because refresh intentionally rechecks Riot.
  - rate limit verdict requests by IP/session because verdict context may fetch match detail and timeline.
  - return a generic retry message instead of exposing internal route or provider details.

## Public Pages

Verify these routes on the deployed HTTPS URL:

- `/about`
- `/privacy`
- `/terms`
- `/contact`
- `/legal`

## Screenshots To Prepare

- Landing/search page.
- Match history page.
- Verdict result page.
- Privacy page.
- Terms page.
- Contact page.

## Manual Verification Before Submission

- Search works with a valid Riot ID.
- Match history loads from Riot/cache.
- Refresh cooldown still works.
- Riot `403`, `404`, and `429` errors show safe user-facing messages.
- `/dev/context/...` is unavailable to normal production users.
- Footer links open About, Privacy, Terms, Contact, and Legal.
- Browser source, bundled JS, localStorage, and network responses do not expose `RIOT_API_KEY` or Supabase service-role keys.

## Current Approval Notes

- The public ranked completed-match verdict flow is connected to the server-side AI verdict pipeline.
- Normal users can request a verdict, view the result, create a 72-hour share link, and submit an objection for future quality review.
- Internal prompt/context inspection remains unavailable to normal production users.
- Before submitting, run the manual verification checklist above on the final custom domain and capture the required screenshots from that domain.
