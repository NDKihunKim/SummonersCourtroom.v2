# Summoner's Courtroom

**Live at [summcourt.com](https://summcourt.com)** - AI-assisted match analysis
for League of Legends players.

Enter a Riot ID, pull recent ranked matches through the Riot Games API, and
request an AI verdict on eligible defeats. Verdicts and match snapshots can be
shared by link. The app is server-rendered on Cloudflare Workers and ships in
English and Korean.

## Features

- **Riot ID lookup** (`/summoner/<shard>/<gameName>/<tagLine>`) and recent
  match history through the Riot Games API.
- **AI verdicts** for eligible ranked defeats through a private AI gateway;
  provider credentials stay server-side.
- **Shareable verdict snapshots** at `/share/<id>`.
- **Accounts and quotas** backed by Supabase Auth (email magic link, Google,
  Discord), user profiles, and per-user verdict usage limits.
- **Abuse protection**: Cloudflare Turnstile on public flows, per-IP rate
  limiting shared across Workers isolates, and atomic quota functions.
- **Observability**: Workers observability logs and Analytics Engine
  instrumentation in production.
- **i18n**: English and Korean UI.
- **Optional Python contextualizer** (`python/`) that formats and sanitizes
  Riot match timelines for the AI prompt.

## Stack

| Layer | Technology |
| --- | --- |
| App | React 19, TanStack Start/Router/Query, Vite, Tailwind CSS, Radix UI |
| Runtime | Cloudflare Workers (`wrangler`) |
| Data and auth | Supabase (PostgreSQL, Auth, RLS) |
| External APIs | Riot Games API, private AI gateway |
| Validation | Zod, React Hook Form |
| Protection | Cloudflare Turnstile, shared rate limiting, quota RPCs |
| Tests | `node:test` |

## Architecture

```text
Browser (React 19)
   |
TanStack Start SSR on Cloudflare Workers
   |-- Supabase Auth / PostgreSQL (RLS)
   |-- Riot Games API
   |-- Private AI gateway (server-side credentials)
   |-- Shared rate-limit table + atomic quota functions
   `-- Workers observability logs / Analytics Engine
```

## Local development

```bash
npm install
cp .env.example .env.local     # public Supabase values; add server secrets locally
npm run dev
```

Build and deploy:

```bash
npm run build                  # vite build; removes dist/server/.dev.vars
npm run deploy                 # build + wrangler deploy
```

Set server-only secrets with `wrangler secret put` (for example
`RIOT_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_GATEWAY_TOKEN`,
`TURNSTILE_SECRET_KEY`). Never commit them; `.env.example` documents the
required names. The committed `.env.production` contains only public
build-time values.

Database migrations live in `supabase/migrations/`. RLS is enabled on all
application tables, including the shared rate-limit table.

## Tests

Tests use `node:test` and live in `tests/`.

## License

No license is granted. All rights reserved.
