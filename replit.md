# Open Appstore

An open, developer-first app store — server-rendered storefront plus developer console, built as a single lightweight edge application.

## Stack

- **Runtime**: Hono 4 + Cloudflare Pages / Workers
- **Backend**: Supabase (PostgREST + GoTrue)
- **Frontend**: Plain HTML/CSS/JS, server-rendered, Vite for bundling
- **No TypeScript, no build-time frameworks**: `src/**/*.js` only

## Running locally on Replit

```bash
npm run dev
```

Starts the Vite dev server (with Cloudflare Workers adapter) on **port 5000**. The workflow `Start application` runs this automatically.

**Requires Node.js 22+** — Wrangler (the Cloudflare CLI) mandates it.

## Publishing on Replit (autoscale)

**Build step**: `npm run build:server` — esbundles `server.js` + all sources into `dist-server/index.js` (single Node.js-compatible bundle).

**Run command**: `node dist-server/index.js`

`server.js` wraps the Hono app with `@hono/node-server`, injects public Supabase vars from `wrangler.jsonc`, and serves `/static/*` from `public/static/` (which Cloudflare Pages does automatically but Node.js needs explicitly).

## Environment variables

Public values are committed in `wrangler.jsonc` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `STORE_ID`) — safe because Supabase RLS protects them.

Secret needed for 2FA and audit writes:
- `SUPABASE_SERVICE_ROLE_KEY` — add via Replit Secrets (never commit this)

## Project structure

```
src/
  index.js          — Hono app entry (all routes)
  routes/           — API route modules (api-apps, api-auth, api-developer)
  lib/              — Supabase client, media helpers, types
  views/            — Server-rendered HTML templates (store + developer console)
public/static/      — Static assets (icons, CSS, JS)
scripts/seed.mjs    — Demo data seeder (safe to re-run)
wrangler.jsonc      — Cloudflare Pages config + public env vars
vite.config.js      — Vite + Hono dev server config
```

## Deploying

Target: Cloudflare Pages. See README §8 for deployment steps and Google OAuth setup instructions.

## User preferences

- Keep the existing project structure and stack — no migrations or restructuring unless explicitly requested.
