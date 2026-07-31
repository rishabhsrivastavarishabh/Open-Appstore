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
| Production deploy | not deployed yet — see [§8 Deployment](#8-deployment) |
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
- `/developer/docs` — the full REST API reference

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
| GET | `/api/categories`, `/api/developers`, `/api/stats`, `/api/health` | |

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
│   │   └── totp.js         # RFC 6238 TOTP, base32, backup codes, sealed challenges
│   ├── routes/             # api-apps.js · api-auth.js · api-developer.js
│   └── views/              # layout.js · store.js · developer.js · components.js
├── public/static/          # app.js · app.css · logo.svg · icons
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

**Status**: ❌ not deployed yet. Two paths are possible — Genspark-hosted Cloudflare, or your own
Cloudflare account with an API token in the Deploy panel. Pick one and the deploy can proceed.

Before Google sign-in works in production:

1. **Rotate the Google client secret** — the one in the uploaded JSON has been exposed in chat.
2. Supabase Dashboard → **Authentication → Providers → Google**: paste the client id + (new) secret.
3. Google Cloud Console → **Authorized redirect URIs**: add
   `https://edcdqykohvcnwqgiwhke.supabase.co/auth/v1/callback`.
4. Google Cloud Console → **Authorized JavaScript origins**: add your deployed site origin.
5. Register `SUPABASE_SERVICE_ROLE_KEY` as a deployment secret (never in `wrangler.jsonc`).

---

## 9. Not implemented yet

- User-facing library page for `user_installed_apps` (data is seeded, UI pending)
- In-app notifications UI (`notifications` table unused)
- Paid-app checkout (prices are display-only)
- Full 3D skeuomorphic restyle of the storefront
- Brand logo is an **interim** vector reconstruction of the supplied reference; a pixel-faithful
  version is still open

## 10. Suggested next steps

1. Choose the deployment path and ship it, then finish the Google provider configuration above.
2. Build the user library + notifications screens on the existing tables.
3. Replace the interim logo with the final artwork and regenerate the icon set.
4. Add rate limiting on `/api/auth/*` and a "trusted device" skip for 2FA.

---

**Last updated**: 2026-07-31
