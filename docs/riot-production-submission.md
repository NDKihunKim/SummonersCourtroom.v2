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
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Public frontend Supabase values may be configured as non-secret environment variables when needed:

```bash
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_PROJECT_ID
```

Production context inspection must stay disabled:

- Leave `VITE_ENABLE_DEV_CONTEXT` unset or `false`.
- Do not expose `ADMIN_CONTEXT_TOKEN` to the browser.
- Do not put Riot keys or Supabase service-role keys in any `VITE_*` variable.

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

## Known Approval Risk

The visible verdict flow currently presents a preview/mock verdict. A deployed HTTPS prototype is useful now, but the final Riot production-key request will be stronger after the real post-game AI verdict pipeline is connected.
