# Open Appstore

An open, developer-first app store: a server-rendered storefront plus a developer console, built as a
single lightweight edge application. Every page is real HTML on first paint — JavaScript only enhances it.

- **Name**: Open Appstore
- **Android application id (companion client)**: `com.app.store`
- **Stack**: Hono 4 + Cloudflare Pages · Supabase (PostgREST + GoTrue) · plain HTML/CSS/JS/JSON
- **No TypeScript, no build-time frameworks**: `src/**/*.js` only, bundled by Vite for the Worker

---

## 1. URLs

| What | URL |
| --- | --- |
| Intended production domain | https://openappstore.openflip.in |
| Local dev | http://localhost:3000 |
| Sandbox preview | https://3000-ie74f2trvh5cfaiw2ngva-5185f4aa.sandbox.novita.ai |
| GitHub | https://github.com/rishabhsrivastavarishabh/Open-Appstore |
| Production deploy | https://openappstore.pages.dev |
| Health check | `/api/health` |
| Play listing (companion app) | https://play.google.com/store/apps/details?id=com.app.store |

---

## 2. Completed features

### Storefront (server-rendered)
- `/` home: hero, featured, trending, categories, new releases — full HTML on first byte
- `/apps` browse with search, category, sort, price filters and pagination (real totals)
- `/top-charts`, `/categories`, `/category/:slug`, `/developers`, `/developer/:slug`
- `/app/:slug` detail: gallery, description, reviews, version history, **update-available banner**,
  changelog, links & downloads card, Google Drive mirror, privacy policy, **“Open in app” deep link**
- `/search`, `/legal/privacy`, `/legal/terms`, `/about`
- **Store ⇄ Developer mode switch** in the header on every page
- Dark/light theme with persistence, toasts, skeletons, share sheet
- `sitemap.xml` (with `<image:image>` entries) and `robots.txt`
- Web manifest with `related_applications` pointing at `com.app.store`

### Developer console
- `/developer` dashboard with a 1‑2‑3 stepper that reflects real progress
- `/developer/apps` — edit listings, publish releases (semver validated, duplicate version → 409)
- `/developer/submit` — new listing (gated until the developer profile exists)
- `/developer/profile` — studio profile with live preview
- `/developer/security` — **two-factor authentication**, backup codes, devices, sign-in history
- `/developer/api-keys` — **create / list / revoke `dev_…` API keys** (secret shown once)
- `/developer/docs` — the full REST API reference, including the v1 Developer API

### Social sign-in (OAuth 2.0)

Five providers are supported generically -- Google, GitHub, Facebook, Microsoft
(`azure`) and Apple. Supabase GoTrue performs the authorization-code + PKCE
flow, so **no provider client secret exists anywhere in this codebase** or in
the Worker's environment.

- `GET /api/auth/oauth/{provider}?next=/developer` -- 302 to the provider
- `GET /api/auth/providers` -- which providers are live right now
- `GET /api/auth/google` -- kept as an alias so old links keep working

The sign-in page is server-rendered and asks GoTrue which providers are
actually enabled, so it never shows a button that dead-ends in an error.
Currently enabled on this deployment: **Google + email/password**. Enabling
another provider is Supabase-dashboard-only, no redeploy.

`next` is validated as a same-site path; absolute and protocol-relative values
are replaced with `/developer` to prevent a covert-redirect after sign-in.
GitHub is asked only for `user:email`, never `repo`.

### Developer API v1 (`/api/v1`) — API-key authenticated
- **15 endpoints**: apps CRUD, publish/unpublish, analytics, reviews + replies, versions,
  developer profile, portfolio stats, plus `GET /api/v1` (descriptor) and `/whoami`
- **API keys** — `dev_<b64url>` = HMAC-SHA256-signed payload carrying the user id + key id,
  so a forged key is rejected with zero database reads. SHA-256 of the key is stored, never the key.
- **Uniform envelope** — `{ success, data, meta }` / `{ success, error: { code, message, details } }`
- **11 documented error codes** (`validation_failed`, `rate_limited`, `conflict`, …) — clients
  branch on `error.code`, never on the message
- **Rate limits** with `X-RateLimit-Limit/Remaining/Reset` on every response and `Retry-After`
  on 429 — free 1,000/h, verified studios 5,000/h
- **Tenant isolation** enforced in one place (`requireKey`), so every query is scoped to the
  caller's own `developer_id`; another developer's app id returns `404`, never their data
- `verified` is **read-only** over the API — a studio cannot self-grant the badge or the higher tier

### Authentication
- Email + password sign-up / sign-in / password reset
- **Sign in with Google** (`/api/auth/google` → Supabase GoTrue → `/auth/callback`)
- **Two-factor authentication (TOTP, RFC 6238)** with QR enrolment and 10 single-use backup codes
- Sign-in history and device records for every attempt
- ❌ **Removed**: email one-time-code (OTP) sign-in and “email me a sign-in link” (magic link)

### Media handling
- Google Drive share links are rewritten automatically:
  - images → `drive.google.com/thumbnail?id=…&sz=w1600`
  - downloads → `drive.google.com/uc?export=download&id=…`
- Dropbox, GitHub and OneDrive links are normalised too; host labels shown on every link tile

---

## 3. API surface

All JSON, all under `/api`. Send `Authorization: Bearer <access_token>` where marked 🔒.

### Apps
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/apps` | `?search= &category= &sort=popular\|newest\|rating\|name &price=free\|paid &limit= &offset=` → `{ apps, total, count, has_more }` |
| GET | `/api/apps/:idOrSlug` | app + developer + reviews + versions |
| GET | `/api/apps/:id/versions` | release history |
| POST | `/api/apps/:id/download` | records the download, returns the resolved URL |
| GET | `/api/apps/:id/reviews`, POST 🔒 | list / create a review |
| GET | `/api/categories`, `/api/developers`, `/api/apps/stats`, `/api/health` | |

### Auth
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/signup` | `{ email, password, developer_name? }` |
| POST | `/api/auth/login` | → `{ session }`, or `{ requires_2fa: true, challenge }` |
| GET | `/api/auth/google` | `?next=` → 302 to Google via Supabase |
| POST | `/api/auth/oauth/exchange` | `{ code }` → `{ session }` (PKCE) |
| POST | `/api/auth/reset-password` | `{ email }` |
| POST | `/api/auth/refresh` | `{ refresh_token }` |
| POST | `/api/auth/logout` 🔒 | |
| GET | `/api/me` 🔒 | user + developer + profile |

### Two-factor
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/auth/2fa` 🔒 | `{ enabled, pending, backup_codes_left }` |
| POST | `/api/auth/2fa/setup` 🔒 | → `{ secret, otpauth_uri }` (not enforced yet) |
| POST | `/api/auth/2fa/enable` 🔒 | `{ code }` → `{ backup_codes }` (shown once) |
| POST | `/api/auth/2fa/disable` 🔒 | `{ code }` — TOTP or backup code |
| POST | `/api/auth/2fa/verify` | `{ challenge, code }` → `{ session }` |
| GET | `/api/auth/sessions` 🔒 | devices + last 15 sign-in attempts |

### Developer 🔒
`GET/POST /api/developer/apps`, `PATCH/DELETE /api/developer/apps/:id`,
`GET/POST /api/developer/apps/:id/versions`, `GET/PUT /api/developer/profile`,
`POST /api/developer/register`, `GET /api/developer/stats`.

### AI assistant
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/ai` | `{ available, model, limit_per_hour, endpoints }` — public, so the UI can hide the feature when it is unconfigured |
| POST | `/api/ai/listing` 🔒 | `{ app_name, category?, notes? }` → `{ tagline, description, features[] }` |
| POST | `/api/ai/ask` 🔒 | `{ prompt }` → an answer grounded on the published catalogue |

Backed by **OpenRouter** (`openai/gpt-4o-mini`) through a server-side proxy.

- The API key lives **only** in the `OPENROUTER_API_KEY` secret. It is never imported into any
  browser bundle — verified with `grep -c "sk-or-v1" dist/_worker.js public/static/app.js` → `0 0`.
- A pinned model is used rather than `openrouter/auto`, because `auto` is free to route a request
  to a far more expensive model while the account owner pays for it.
- **Sign-in is required** even though nothing here is private: every call spends real credit, so an
  anonymous endpoint would let a stranger drain the balance.
- AI calls get their own `ai` rate-limit tier of **20/hour per user**, far tighter than the
  1000/hour data tier, for the same reason.

---

## 4. Data architecture

**Storage**: Supabase Postgres, reached over PostgREST and GoTrue with `fetch` only (no SDK, edge-safe).

| Table | Used for |
| --- | --- |
| `stores` | store identity (`STORE_ID`) |
| `developers` | studio profiles, rollup counters |
| `apps` | listings: name, slug, category, version, `version_code`, `min_version`, prices, `download_url`, `drive_url`, `website_link`, `privacy_policy_link`, `auto_update`, `update_available`, `change_log`, screenshots |
| `app_versions` | release history (`file_size` is an **integer, in MB**) |
| `app_reviews` | ratings + comments (`user_id` is NOT NULL) |
| `app_downloads` | one row per download |
| `user_installed_apps` | a user’s library |
| `user_profiles` | display names/avatars |
| `user_2fa` | `totp_secret`, `enabled`, `backup_codes` (SHA-256 hashes) |
| `user_devices` | device hash, name, IP, last seen |
| `user_login_history` | success/failure + reason for every attempt |
| `notifications`, `developer_stats` | reserved for future use |

**Security notes**
- The TOTP secret and backup-code hashes are only ever read server-side with the service-role key.
- A half-finished 2FA login is carried in an **AES-GCM sealed challenge token** (5-minute expiry), so no
  server-side session store is needed.
- Backup codes are stored as SHA-256 hashes and removed when used.

---

## 5. User guide

**Shoppers** — browse `/`, filter on `/apps`, open a listing, press **Get it now** (the download is
recorded and the correct direct URL is resolved). On Android, **Open in app** hands off to the
`com.app.store` client; everywhere else the same button points at the Play listing.

**Developers**
1. `/auth/signup` (or **Continue with Google**) → confirm your email if asked.
2. `/developer/profile` — create the studio profile. Submission stays locked until this exists.
3. `/developer/submit` — publish the first listing.
4. `/developer/apps` — **Release update** adds a version; tick *Update available* to show the banner on
   the store page, and write a changelog.
5. `/developer/security` — scan the QR code with Google Authenticator / Authy / 1Password / Bitwarden,
   confirm one code, then save the ten backup codes. From then on every sign-in asks for a code.

---

## 6. Project layout

```
webapp/
├── src/
│   ├── index.js            # routes + SSR pages (Hono)
│   ├── lib/
│   │   ├── supabase.js     # PostgREST/GoTrue fetch client (count=exact support)
│   │   ├── types.js        # select lists + row → view mappers
│   │   ├── media.js        # Drive/Dropbox/GitHub link normalisation
│   │   ├── totp.js         # RFC 6238 TOTP, base32, backup codes, sealed challenges
│   │   ├── apikey.js       # dev_ key mint/parse/verify + revocation store
│   │   └── ratelimit.js    # per-key fixed-window budget + X-RateLimit-* headers
│   ├── routes/             # api-apps.js · api-auth.js · api-developer.js · api-v1.js
│   └── views/              # layout.js · store.js · developer.js · components.js
├── public/static/          # app.js · app.css · logo.svg · icons
├── migrations/
│   └── 0002_developer_api_keys.sql   # OPTIONAL relational store (see §11)
├── scripts/seed.mjs        # idempotent demo-data seeder
├── vite.config.js · wrangler.jsonc · ecosystem.config.cjs
```

---

## 7. Local development

```bash
npm install
npm run build                 # required before the first start
pm2 start ecosystem.config.cjs
curl http://localhost:3000/api/health
pm2 logs webapp --nostream
```

`.dev.vars` (never committed) holds:

```
SUPABASE_URL=…
SUPABASE_ANON_KEY=…
SUPABASE_SERVICE_ROLE_KEY=…   # required for 2FA and audit writes
STORE_ID=…
```

Seed demo data (safe to re-run): `node scripts/seed.mjs`.

---

## 8. Deployment

**Status**: ✅ live at **https://openappstore.pages.dev**

**Platform**: Cloudflare Pages, project `openappstore`, production branch `main`, in your own
Cloudflare account ("Open Media Intelligence.") via an API token in the Deploy panel.

```bash
npm run build
npx wrangler pages deploy dist --project-name openappstore --branch main
```

### Environment secrets

All values are Cloudflare Pages **secrets**, never `vars` in `wrangler.jsonc`:

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STORE_ID`,
`AUTH_CHALLENGE_SECRET`, `OPENROUTER_API_KEY`, and optionally
`GOOGLE_SITE_VERIFICATION` / `GOOGLE_SITE_VERIFICATION_FILE`.

**Always push them with the helper**, which reads `.dev.vars` and sends every value explicitly:

```bash
node scripts/cf-secrets.mjs          # dry run, prints value lengths
node scripts/cf-secrets.mjs --push   # write, then redeploy for them to take effect
```

⚠️ Three traps, all of which have actually bitten this project:

1. **Never declare these in `wrangler.jsonc` `vars`.** A `vars` entry plus a secret of the same
   name makes Pages reject the deploy with `Binding name '<NAME>' already in use` (exit code 1).
2. **`wrangler pages secret put` replaces the whole env-var map, it does not merge.** Setting them
   one at a time leaves only the last one bound.
3. **Do not GET the project, merge one key, and PATCH the result back.** This looks like the correct
   fix for trap 2 and is in fact worse. Cloudflare returns `secret_text` entries with the `value`
   **stripped**, so echoing that map back writes **empty strings** over every existing secret. The
   API still answers `"success": true`, and a check that compares only key *names* sees all keys
   present and reports success — while production is broken. A blanked `SUPABASE_URL` surfaces as
   `Invalid URL: /rest/v1/...` on every data route. Verify by round-tripping the live site
   (`curl -s https://openappstore.pages.dev/api/apps?limit=1`), never by counting keys.

### Google Search Console verification

⚠️ **The DNS/CNAME method cannot be used for a `pages.dev` site.** Cloudflare owns the `pages.dev`
zone, so no CNAME can be added under it (`dig +short NS pages.dev` returns nothing delegable).
Search Console's DNS tab only becomes usable once `openappstore.openflip.in` is bound. Use either
supported method below instead — both keep the token in a secret, out of git:

| Method | Setup |
| --- | --- |
| **HTML tag** (recommended) | Search Console → *HTML tag*, copy the `content="…"` value → set `GOOGLE_SITE_VERIFICATION` → redeploy. Middleware injects the `<meta>` on **every** page, so any URL of the property verifies and a newly added page can never ship unverified. |
| **HTML file** | Search Console → *HTML file*, note the `google<token>.html` filename → set `GOOGLE_SITE_VERIFICATION_FILE` to that exact filename → redeploy. Only the configured filename responds; every other `google*.html` 404s, so the endpoint cannot confirm a guessed token. |

### Custom domain

`openappstore.openflip.in` is the intended domain. The `openflip.in` zone exists in the Cloudflare
account but is still **pending** — its nameservers have not been switched to Cloudflare yet. Once
the zone is active:

```bash
npx wrangler pages domain add openappstore.openflip.in --project-name openappstore
```

Note that `openflip.in` / `infinityfree.io` shared PHP hosting **cannot** run this app — it is a
Cloudflare Worker, so DNS for the subdomain has to point at Cloudflare Pages.

### Before Google sign-in works in production

1. **Rotate the Google client secret** — the one in the uploaded JSON has been exposed in chat.
2. Supabase Dashboard → **Authentication → Providers → Google**: paste the client id + (new) secret.
3. Google Cloud Console → **Authorized redirect URIs**: add
   `https://edcdqykohvcnwqgiwhke.supabase.co/auth/v1/callback`.
4. Google Cloud Console → **Authorized JavaScript origins**: add your deployed site origin.
5. Google Cloud Console → **Authorized JavaScript origins**: add `https://openappstore.pages.dev`.

---

## 9. Not implemented yet

- The redesign prompts (home-page gradient restyle, app-details restyle, `/app/{slug}` URL
  restructure, email-OTP signup flow) are **not** built. Note the OTP flow conflicts with the
  earlier deliberate removal of email-OTP login, so it needs a decision before implementation.

- User-facing library page for `user_installed_apps` (data is seeded, UI pending)
- In-app notifications UI (`notifications` table unused)
- Paid-app checkout (prices are display-only)
- Full 3D skeuomorphic restyle of the storefront
- Brand logo is an **interim** vector reconstruction of the supplied reference; a pixel-faithful
  version is still open

## 10. Suggested next steps

1. Finish the Google provider configuration above (rotate the secret first).
2. Switch `openflip.in` nameservers to Cloudflare, then bind the custom domain.
3. Build the user library + notifications screens on the existing tables.
4. Replace the interim logo with the final artwork and regenerate the icon set.
5. Add rate limiting on `/api/auth/*` and a "trusted device" skip for 2FA.
6. Run `migrations/0002_developer_api_keys.sql` if you want indexed key lookups, a real
   `review_responses` table and exact global rate limits (see §11).

---

**Last updated**: 2026-08-07
