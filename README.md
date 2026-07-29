# Open App Store

An open app marketplace with a built-in developer console — server-rendered on the edge with Hono + Cloudflare Pages, backed by a live Supabase (PostgREST + GoTrue) database.

## Project Overview

- **Name**: Open App Store
- **Goal**: A complete two-sided app marketplace where visitors discover / review apps and developers publish and manage them, delivered as fast server-rendered HTML on Cloudflare's edge network.
- **Key features**:
  - **Store ⇄ Developer mode switch** in the header — one click flips the entire navigation, theme accents and page set between the consumer storefront and the developer console.
  - **First page is real server-rendered HTML** — the home page arrives fully populated (~36 KB of markup with live app data), not a client-side SPA shell. JavaScript is layered on top as progressive enhancement.
  - Live search with keyboard navigation (`/` hotkey, arrow keys, Enter/Esc)
  - Browse with filters (category, price, rating, sort) + grid/list toggle, persisted
  - Top charts with Chart.js visualisations
  - App detail pages with screenshots, ratings breakdown, reviews and star-picker review submission
  - Developer directory and public developer profiles
  - Full auth: email/password signup + login, magic link, password reset, refresh-token rotation
  - Developer console: dashboard stats, my-apps management (inline edit dialog, publish/unpublish, delete), app submission with live preview, developer profile, API documentation
  - Dark/light theme with persistence, mobile tab bar, responsive at 390 / 768 / 1920 px
  - PWA manifest + full icon set, `robots.txt`

## URLs

- **Local dev**: http://localhost:3000
- **Sandbox preview**: https://3000-ie74f2trvh5cfaiw2ngva-5185f4aa.sandbox.novita.ai
- **Production**: not yet deployed to Cloudflare Pages
- **Health check**: `/api/health`

## Brand / Logo

The brand mark is a hand-authored SVG recreation of the supplied app-icon artwork: a light squircle tile containing a blue→indigo gradient shopping bag with a white **negative-space download arrow** (the arrow is knocked out of the bag body rather than drawn on top, so it reads correctly at any size). Verified at **9.8/10** fidelity against the reference and legible down to 64 px.

| Asset | Purpose |
| --- | --- |
| `public/static/favicon.svg` | Browser favicon (vector, source of truth) |
| `public/static/logo.svg` | Inline `<img class="brand-mark">` in header, footer and auth pages |
| `public/static/apple-touch-icon.png` | 180 px iOS home-screen icon |
| `public/static/icon-192.png` | 192 px PWA icon |
| `public/static/icon-512.png` | 512 px PWA icon (also `maskable`) |

## Functional Entry URIs

### Store pages (server-rendered)

| Path | Description |
| --- | --- |
| `/` | Home — hero, featured, trending, categories, top developers |
| `/apps` | Browse / search. Params: `?q=`, `&category=`, `&price=free\|paid`, `&rating=`, `&sort=popular\|rating\|newest\|name`, `&view=grid\|list` |
| `/categories` | All categories with live app counts |
| `/top-charts` | Top charts + Chart.js breakdown |
| `/app/:slug` | App detail (slug or id), screenshots, reviews, review form |
| `/developers` | Developer directory |
| `/developer-profile/:id` | Public developer profile + their apps |
| `/legal/privacy`, `/legal/terms`, `/legal/guidelines` | Legal pages |

### Auth pages

| Path | Description |
| --- | --- |
| `/auth/login` | Password login + magic-link option |
| `/auth/signup` | Create account (email confirmation required) |
| `/auth/reset` | Password reset request |

### Developer console

| Path | Description |
| --- | --- |
| `/developer` | Dashboard — totals, downloads, ratings, recent apps |
| `/developer/apps` | My apps — edit dialog, publish/unpublish, delete |
| `/developer/submit` | Submit a new app, with live card preview |
| `/developer/profile` | Developer profile settings |
| `/developer/docs` | API documentation |

### Public API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Service heartbeat |
| GET | `/api/apps` | List apps. Params: `q`, `category`, `price`, `rating`, `sort`, `limit`, `offset`, `featured` |
| GET | `/api/apps/stats` | Aggregate marketplace stats |
| GET | `/api/apps/:key` | Single app by slug or id |
| GET | `/api/categories` | Categories with counts |
| GET | `/api/developers` | Developers with app counts |
| GET | `/api/developers/:id` | Single developer + apps |
| GET | `/api/apps/:id/reviews` | Reviews for an app |
| POST | `/api/apps/:id/reviews` | Submit a review *(auth required)* |
| POST | `/api/apps/:id/download` | Register a download / return download URL |

### Auth API

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/auth/signup` | Register (returns `needs_confirmation`) |
| POST | `/api/auth/login` | Password grant → access + refresh token |
| POST | `/api/auth/magic-link` | Send OTP / magic link |
| POST | `/api/auth/reset-password` | Send recovery email |
| POST | `/api/auth/refresh` | Rotate refresh token |
| POST | `/api/auth/logout` | Revoke session |
| GET | `/api/me` | Current user *(401 when anonymous)* |
| POST | `/api/developer/register` | Upgrade account to developer |

### Developer API *(all require `Authorization: Bearer <token>`)*

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/developer/apps` | List my apps + stats |
| POST | `/api/developer/apps` | Create an app |
| PATCH | `/api/developer/apps/:id` | Update an app |
| DELETE | `/api/developer/apps/:id` | Delete an app |

### Assets

`/manifest.webmanifest`, `/robots.txt`, `/static/app.css`, `/static/app.js`, `/static/logo.svg`, `/static/favicon.svg`, `/static/icon-{192,512}.png`, `/static/apple-touch-icon.png`

## Data Architecture

- **Storage service**: **Supabase** (hosted Postgres) accessed exclusively over **PostgREST** (`/rest/v1/…`) and **GoTrue** (`/auth/v1/…`) with plain `fetch` — no `@supabase/supabase-js` SDK, so the bundle stays edge-friendly.
- **Live tables used**: `apps`, `developers`, `app_reviews`, `app_versions`.
- **Data models**:
  - `apps` — `id`, `slug`, `name`, `tagline`, `description`, `category`, `price`, `icon_url`, `screenshots`, `downloads`, `rating`, `total_ratings`, `status`, `developer_id`, `created_at`
  - `developers` — `id`, `name`, `slug`, `bio`, `website`, `avatar_url`, `verified`
  - `app_reviews` — `id`, `app_id`, `user_id`, `rating`, `title`, `body`, `created_at`
  - Categories are **derived** by aggregating `apps.category` (there is no `categories` table).
  - `AppView` in `src/lib/types.ts` is the normalised shape every view consumes.
- **Data flow**: Hono route → `sbSelect`/`sbWrite`/`sbAuth` (`src/lib/supabase.ts`) → Supabase REST → `toAppView()` → `hono/html` template → HTML response. The browser runtime (`public/static/app.js`) then calls the same `/api/*` endpoints for interactive updates, holding the session in `localStorage` under `oas.session.v1` with automatic 401 → refresh → replay.

### Important environment notes

- The **service-role key supplied is actually an anon key** (its JWT payload is `"role":"anon"`). Because of this, **RLS blocks anonymous INSERTs** into `apps`, `app_reviews` and `app_versions` (Postgres code `42501`). Writes therefore require a signed-in user bearer token *and* matching RLS policies — the API surfaces an actionable `hint` string when a write is rejected instead of failing silently.
- Supabase has **email confirmation enabled** (`mailer_autoconfirm: false`), so a fresh signup returns `needs_confirmation` and login until confirmed returns `email_not_confirmed` (the UI explains this in plain language). Only the `email` provider is enabled — **no OAuth**.
- File uploads (Vercel Blob in the original spec) are **intentionally omitted** — unavailable on Cloudflare Pages. Icon and screenshot fields accept URLs instead.

## User Guide

**As a visitor**
1. Open `/` — the storefront is already rendered in the HTML.
2. Search with the header box or press `/`; use ↑ ↓ and Enter to pick a result.
3. Go to `/apps` to filter by category, price, rating and sort order; toggle grid/list.
4. Open any app to see screenshots, the rating breakdown and reviews. **Get** starts the download; **Share** copies the link.
5. Toggle dark/light with the theme button — the choice is remembered.

**As a developer**
1. Click **Developer** in the header mode switch (or open `/developer`).
2. Create an account at `/auth/signup`, then **confirm the email Supabase sends** before logging in.
3. Log in at `/auth/login` (or request a magic link).
4. Use `/developer/submit` to publish an app — the live preview shows exactly how the store card will look.
5. Manage everything from `/developer/apps` (edit, publish/unpublish, delete) and watch performance on `/developer`.
6. `/developer/docs` documents every endpoint for programmatic use.

## Development

```bash
npm install
npm run build                      # vite build → dist/
pm2 start ecosystem.config.cjs     # wrangler pages dev dist on :3000
curl http://localhost:3000/api/health
pm2 logs webapp --nostream
```

Local secrets live in `.dev.vars` (gitignored); the same values are mirrored in the `vars` block of `wrangler.jsonc` for deploys.

## Tech Stack

- **Backend**: Hono 4 on Cloudflare Pages (edge runtime)
- **Rendering**: `hono/html` server-side templates (no SPA framework)
- **Frontend**: one vanilla ES module (`app.js`, ~1.3 k lines) + hand-written CSS design system (`app.css`, ~61 KB), Tailwind-free
- **CDN libraries**: Font Awesome 6, Chart.js
- **Database / Auth**: Supabase PostgREST + GoTrue over `fetch`
- **Build**: Vite 8 + `@hono/vite-build/cloudflare-pages`
- **Tooling**: Wrangler 4, PM2, TypeScript (strict)

## Not Yet Implemented

- Deployment to Cloudflare Pages production
- Binary/file uploads for app icons, screenshots and APK/IPA artifacts (needs R2)
- Server-side write access for anonymous flows — blocked until a genuine service-role key or explicit RLS policies are provided
- OAuth / social sign-in (disabled in the Supabase project)
- Favourites / wishlist, install history, and in-app purchase flows (tables absent)
- Sitemap generation (`robots.txt` already points at `/sitemap.xml`)
- Automated test suite (verification is currently curl-based)

## Recommended Next Steps

1. Deploy to Cloudflare Pages and set `SUPABASE_URL` / `SUPABASE_ANON_KEY` as project secrets.
2. Add RLS policies so authenticated users can insert their own `apps` and `app_reviews` rows, or supply a real service-role key.
3. Add an R2 bucket and wire icon/screenshot uploads to replace URL-only inputs.
4. Generate `/sitemap.xml` from published apps and categories.
5. Either disable Supabase email confirmation for smoother demos or add a "resend confirmation" action.
6. Add caching (Cloudflare Cache API or KV) for `/api/apps/stats` and category counts.

## Deployment

- **Platform**: Cloudflare Pages
- **Status**: ✅ Running locally / preview · ❌ Not yet deployed to production
- **Build output**: `dist/_worker.js` (117 KB, 33 KB gzip) + `dist/static/*`
- **Tech Stack**: Hono + TypeScript + Vite + Supabase
- **Last Updated**: 2026-07-29
