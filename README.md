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
- **Automatic app size + device awareness** on `/app/:slug` (see §2.1)
- `/search`, `/legal/privacy`, `/legal/terms`, `/about`
- **Store ⇄ Developer mode switch** in the header on every page
- Dark/light theme with persistence, toasts, skeletons, share sheet
- **Full Search Console SEO**: generated `sitemap.xml` (with `<image:image>`) + `robots.txt`,
  automatic canonical URLs, Open Graph + Twitter cards, path-derived `noindex`, and JSON-LD
  (`WebSite`/`SearchAction`, `SoftwareApplication`, `ItemList`, `BreadcrumbList`) — see §8
- Web manifest with `related_applications` pointing at `com.app.store`
- **`/about`** — company, how the store works, and contact (appstore@openflip.in)
- **Cookie consent banner** on every page (choice stored in `localStorage`, not a cookie)
- **AI features on the storefront**: **Sarath**, the store's AI app guide — a floating widget on
  every page, natural-language app search on `/apps`, AI app comparison on every listing, and
  personalised picks on the home page

### Developer console
- `/developer` dashboard with a 1‑2‑3 stepper that reflects real progress
- `/developer/apps` — edit listings, publish releases (semver validated, duplicate version → 409)
- `/developer/submit` — new listing (gated until the developer profile exists)
- `/developer/profile` — studio profile with live preview
- `/developer/security` — **two-factor authentication**, backup codes (**regenerate without disabling 2FA**), devices, sign-in history
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

### 2.1 Automatic app size & device awareness

`src/lib/appsize.js` decides an app's download size without anyone having to type it in
correctly, because the stored data cannot be trusted: `app_versions.file_size` is `NULL`
for 9 of 10 rows, and the one populated row records `54` for a file that is actually
58,879,844 bytes.

Resolution order, cheapest source first:

1. **Recorded** — a `file_size` on any version. `normalizeStoredSize()` disambiguates the
   unit: the submit form asks for whole MB, but some rows hold raw bytes, so a value above
   `100000` can only be bytes.
2. **KV cache** — keyed on the *download URL*, not the app id, so re-uploading a binary
   naturally misses the cache. 7-day TTL. (No KV binding is configured today, so this step
   is skipped and every miss re-probes; that is gated behind `s-maxage=60`.)
3. **Live HEAD probe** — reads `Content-Length` without transferring the body. 4-second
   abort so a slow or hostile host can never hold up a render, and an HTML content-type is
   rejected because that means we followed a share/interstitial page rather than the binary.

A probed size is labelled **auto-detected** in the Information card. `classifyDownload()`
maps the file extension (`apk`/`aab`/`ipa`/`exe`/`dmg`/`deb`/`rpm`/`AppImage`/`zip`) to a
target platform, shown as **File type** and **Platform** rows.

**The device notice is rendered empty and hidden, then filled by JavaScript.** The page is
edge-cached (`s-maxage=60`), so a server-rendered "Compatible with your Android device"
would be served to iPhone visitors. `detectPlatform()` also handles iPadOS, which reports
itself as a Mac and is only distinguishable via `navigator.maxTouchPoints`.

The notice **informs, never blocks** — a visitor on a laptop is very often there to send
the link to their phone, so a mismatch points them at the Share button instead of refusing.

**Share modal** offers copy-link, copy-slug, WhatsApp, Telegram, X, email, native share and
a QR code. The QR encoder is **self-hosted** (`qrcode-generator@1.4.4`) rather than an
`<img>` pointed at a QR web service, which would hand every shared app URL to a third party.
A hand-rolled encoder was written first and **rejected**: it produced symbols that looked
entirely plausible and decoded as nothing. Both the library and the `drawQr()` wrapper are
verified by round-tripping rendered pixels through `pyzbar` (4/4 at the production 200px
canvas size).

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
| POST | `/api/auth/signup` | `{ email, password, developer_name?, phone?, developer_type?, marketing_opt_in?, accepted_terms_at? }` — validates first, then **max 3 attempts per email per hour** |
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
| POST | `/api/auth/2fa/regenerate-codes` 🔒 | `{ code }` — **TOTP only** → 10 fresh `{ backup_codes }`; old sheet is revoked |
| POST | `/api/auth/2fa/disable` 🔒 | `{ code }` — TOTP or backup code |
| POST | `/api/auth/2fa/verify` | `{ challenge, code }` → `{ session }` |
| GET | `/api/auth/sessions` 🔒 | devices + last 15 sign-in attempts |

**Why regeneration only accepts a TOTP code.** Regenerating invalidates every
previously issued backup code. If a session cookie alone were enough, an attacker
on a stolen session could replace the owner's recovery codes and lock them out;
if a *backup* code were accepted, a leaked code sheet could be used to mint a
fresh sheet and keep persistence indefinitely. Requiring a live authenticator
code means the person must still hold the enrolled device. The TOTP secret is
left untouched, so the authenticator app keeps working and there is no window
where the account sits unprotected — which is what the previous
"disable 2FA, then re-enable" workaround forced.

### Developer 🔒
`GET/POST /api/developer/apps`, `PATCH/DELETE /api/developer/apps/:id`,
`GET/POST /api/developer/apps/:id/versions`, `GET/PUT /api/developer/profile`,
`POST /api/developer/register`, `GET /api/developer/stats`.

### Sarath — the AI assistant

The assistant is named **Sarath** and introduces itself that way. The name is set in one place per
surface: the widget chrome and ARIA labels in `src/views/layout.js`, the greeting in
`public/static/app.js`, the on-page copy in `src/views/store.js`, and the two system prompts in
`src/routes/api-ai.js`. The prompts also instruct the model never to claim to be human and never to
claim to be a general-purpose assistant, so Sarath stays scoped to this catalogue.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/ai` | `{ available, model, limit_per_hour, limit_per_minute, endpoints }` — public, so the UI can hide the feature when it is unconfigured |
| GET | `/api/ai/context` | `{ apps, sample[], fields[] }` — how many catalogue apps the model is actually grounded on |
| POST | `/api/ai/search` | `{ query }` → ranked `{ slug, name, reason }[]` — natural-language app search |
| POST | `/api/ai/chat` | `{ messages[] }` → `{ reply }` — the Sarath widget; history comes from the client |
| POST | `/api/ai/compare` | `{ a, b }` → `{ rows[], pros_a, cons_a, pros_b, cons_b, verdict }` |
| POST | `/api/ai/picks` | `{ recent[], installed[], liked_categories[] }` → suggestions |
| POST | `/api/ai/listing` 🔒 | `{ app_name, category?, notes? }` → `{ tagline, description, features[] }` |
| POST | `/api/ai/ask` 🔒 | `{ prompt }` → an answer grounded on the published catalogue |

Backed by **OpenRouter** (`openai/gpt-4o-mini`) through a server-side proxy.

**Where it appears in the UI**
- Floating widget, bottom-right, on **every** page (`/api/ai/chat`).
- Natural-language search on `/apps` (`/api/ai/search`).
- "Compare with another app" on every app page (`/api/ai/compare`).
- "Apps you might like" on the home page (`/api/ai/picks`), driven by recently-viewed slugs in
  `localStorage`. The section **removes itself** when there is no history, so a first-time visitor
  never sees an empty "recommended for you" heading.

There is **no `/developer/assistant` page**. The two 🔒 developer endpoints remain part of the API
surface, but the console page that wrapped them was removed — the storefront widget covers the same
ground from anywhere in the app.

**Grounding**
- The model is given the **full detail** of up to `MAX_CONTEXT_APPS` (40) published listings:
  description, version, minimum Android, developer (+verified flag), rating, review count,
  downloads, price, website, whether a privacy policy and a download link exist, and the latest
  changelog. That is what lets it answer "what version is RailHop and who made it?" rather than only
  "what should I install?".
- Empty fields are **stripped** rather than sent as `null`: a `null` invites the model to report
  "not specified" as if that were a finding.
- `CATALOGUE_SELECT` column names are verified against the real `apps` table. This matters: an
  earlier version selected `tagline` / `rating_average` / `download_count`, none of which exist.
  PostgREST failed the whole query, `catalogue()` returned an error object, and **every AI answer
  was generated with zero catalogue context while still sounding completely fluent.** The test only
  asserted "answer is non-empty", so it passed. `GET /api/ai/context` now exposes the app count so
  the grounding is assertable, and a failed query can no longer masquerade as an empty catalogue.
- Model-returned slugs are resolved against the real catalogue (`hydrate()`); an invented app has no
  match and is dropped before it reaches the UI.

**Cost and abuse controls**
- The API key lives **only** in the `OPENROUTER_API_KEY` secret. It is never imported into any
  browser bundle — verified with `grep -c "sk-or-v1" dist/_worker.js public/static/app.js` → `0 0`.
- A pinned model is used rather than `openrouter/auto`, because `auto` is free to route a request
  to a far more expensive model while the account owner pays for it.
- Two gates: **20/hour** (tier `ai`) plus a **3/minute burst cap**. The burst check runs *before*
  the hourly bucket is charged, so being told to slow down does not cost a call.
- Storefront endpoints work **signed out** (the widget has to), keyed by user id or
  `CF-Connecting-IP` — set by the edge, so a client cannot forge it. A large NAT shares one budget;
  that is a deliberate trade. The 🔒 developer endpoints still require sign-in.
- **Input is validated before the limiter is charged.** Validation costs no AI call, so an empty
  textbox must not burn a slot of a 3/minute budget.
- Responses are cached for 10 minutes keyed on the request shape, so two visitors asking the same
  question cost one API call.

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

The token currently configured is verified live on every deploy:

```bash
curl -s https://openappstore.pages.dev/ | grep -o '<meta name="google-site-verification"[^>]*>'
```

### Search Console SEO

Everything a crawler needs is generated server-side; nothing depends on JavaScript running.

| Surface | Where | Notes |
| --- | --- | --- |
| `robots.txt` | `GET /robots.txt` | Generated, so the `Sitemap:` line always carries the *current* origin — a hardcoded one would point preview deploys at production. Disallows `/api/`, `/auth/`, `/developer`. |
| `sitemap.xml` | `GET /sitemap.xml` | Generated live from Supabase: static routes + every published app + categories that actually have apps + developer profiles. App entries carry `<image:image>` for the icon. A newly published app is discoverable on the next crawl with no rebuild. |
| Canonical | every page | Derived from the request URL by middleware, not passed per route — 22 call sites means the one page someone forgets would ship without a canonical. |
| Open Graph | every page | `og:title`, `og:description`, `og:type`, `og:url`, `og:site_name`, `og:locale`, `og:image` (+ `:alt`). App pages use `og:type=product`. |
| Twitter | every page | `summary_large_image` card with title, description, image and alt. |
| `robots` meta | every page | `index, follow, max-image-preview:large` on public pages; `noindex, follow` on `/developer*`, `/auth*`, search-result URLs and 404s. |
| JSON-LD | per page type | `WebSite` + `SearchAction` + `Organization` (home), `SoftwareApplication` + `Offer` + `AggregateRating` (app pages), `ItemList` (listings), `BreadcrumbList`, `CollectionPage`, `WebPage`. |

Decisions worth knowing:

- **Only `?category=` survives into the canonical URL.** Category pages are listed in the sitemap, so
  stripping the param would make all of them canonicalise to `/apps` — Search Console would then
  report "Alternate page with proper canonical tag" and index **none** of them. `sort`, `price` and
  `search` only reorder the same set, so those *do* collapse to the bare path, which is what stops a
  dozen near-duplicates competing with each other. `?category=All` is the default, so it collapses too.
- **`noindex` is derived from the path**, not passed per route, so a new private page is noindex by
  default. `robots.txt` alone is not enough: a disallowed URL can still be indexed without a snippet
  if something links to it, because the crawler never fetches the page to see the directive.
- **`aggregateRating` is omitted when an app has no reviews.** Google penalises a rating with no
  `reviewCount`, and inventing one would misrepresent the app.
- **Empty categories are left out of the sitemap.** A URL that renders no results is a soft-404 and
  drags down the crawl quality of everything around it.
- The last breadcrumb has no `item` — per schema.org, since it would only link to itself.

Verified by `82` assertions covering the token, robots, sitemap validity, JSON-LD parsing, canonical
behaviour, `noindex` placement and description uniqueness.

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
- **Email OTP cannot be built on this stack today.** There is no mail provider wired into the
  project (no Resend / SendGrid / SMTP credential), and Supabase's built-in OTP endpoint is
  disabled on this project — `POST /auth/v1/otp` returns
  `422 {"error_code":"otp_disabled"}`. Any "send a 6-digit code" flow therefore has no delivery
  channel. Adding one requires a mail provider + verified sending domain.

### Developer auth URLs

There is **one** account system, not a separate developer credential store: "developer" is a role
an account gains once it has a studio profile. Two parallel logins would mean two password resets
and two 2FA enrolments for the same person. These paths therefore all serve the same pages:

| Canonical | Aliases |
| --- | --- |
| `/auth/login` | `/auth/signin`, `/developer/signin`, `/developer/login` |
| `/auth/signup` | `/auth/register`, `/developer/register`, `/developer/signup` |
| `/auth/reset` | `/auth/forgot-password`, `/developer/forgot-password` |

All are `noindex` (via `NOINDEX_PREFIXES`), so the duplicate URLs cannot create a
duplicate-content problem in Search Console.

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

**Last updated**: 2026-08-11
