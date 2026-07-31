#!/usr/bin/env node
/**
 * Seed the Open App Store Supabase project with a store row, demo developers,
 * a published app catalogue and release history.
 *
 * Reads credentials from .dev.vars (never committed). Idempotent: it looks up
 * existing rows by natural key before inserting.
 *
 *   node scripts/seed.mjs
 */
import { readFileSync } from 'node:fs'

const vars = Object.fromEntries(
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    })
)

const URL_ = vars.SUPABASE_URL
const KEY = vars.SUPABASE_SERVICE_ROLE_KEY
const STORE_ID = vars.STORE_ID || vars.NEXT_PUBLIC_STORE_ID || 'store_rJo7T2WZJHoEs6Ar'
if (!URL_ || !KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .dev.vars')

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

async function sel(table, query) {
  const r = await fetch(`${URL_}/rest/v1/${table}?${query}`, { headers: H })
  const t = await r.text()
  if (!r.ok) throw new Error(`${table} select ${r.status}: ${t}`)
  return JSON.parse(t || '[]')
}

async function ins(table, rows) {
  const r = await fetch(`${URL_}/rest/v1/${table}`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify(rows),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${table} insert ${r.status}: ${t}`)
  return JSON.parse(t || '[]')
}

/* ── 1. Store ───────────────────────────────────────────────────────────── */
let [store] = await sel('app_stores', `select=*&store_id=eq.${STORE_ID}&limit=1`)
if (!store) {
  ;[store] = await ins('app_stores', {
    store_id: STORE_ID,
    store_name: 'Open App Store',
    description:
      'An open, developer-first app store. Publish your build, share a Google Drive link and reach users instantly.',
    website_url: 'https://open-app-store.pages.dev',
    email: 'hello@openappstore.dev',
  })
  console.log('created store', store.store_id)
} else {
  console.log('store exists', store.store_id)
}

/* ── 2. Developers ──────────────────────────────────────────────────────── */
const DEVS = [
  {
    developer_name: 'Northwind Labs',
    company_name: 'Northwind Labs Pvt Ltd',
    description:
      'We build focused productivity tools that respect your time and your data. Ten years of shipping small, sharp software.',
    website: 'https://northwindlabs.dev',
    email: 'team@northwindlabs.dev',
    avatar_url: 'https://api.dicebear.com/9.x/shapes/svg?seed=northwind&backgroundColor=0ea5e9',
    verified: true,
    verified_badge: true,
    verified_at: new Date('2025-02-11').toISOString(),
  },
  {
    developer_name: 'Pixelforge Studio',
    company_name: 'Pixelforge Studio',
    description:
      'A two-person studio making creative tools for photographers, illustrators and video editors.',
    website: 'https://pixelforge.studio',
    email: 'hi@pixelforge.studio',
    avatar_url: 'https://api.dicebear.com/9.x/shapes/svg?seed=pixelforge&backgroundColor=a855f7',
    verified: true,
    verified_badge: true,
    verified_at: new Date('2025-05-02').toISOString(),
  },
  {
    developer_name: 'Ravi Kumar',
    company_name: null,
    description: 'Indie developer. I make offline-first utilities for Android and the web.',
    website: 'https://ravikumar.dev',
    email: 'ravi@ravikumar.dev',
    avatar_url: 'https://api.dicebear.com/9.x/shapes/svg?seed=ravik&backgroundColor=22c55e',
    verified: false,
  },
]

const devByName = {}
for (const d of DEVS) {
  let [row] = await sel(
    'developers',
    `select=*&developer_name=eq.${encodeURIComponent(d.developer_name)}&limit=1`
  )
  if (!row) [row] = await ins('developers', d)
  devByName[d.developer_name] = row
}
console.log('developers:', Object.keys(devByName).join(', '))

/* ── 3. Apps ────────────────────────────────────────────────────────────── */
const shot = (seed, hue) =>
  `https://placehold.co/1170x2532/${hue}/ffffff?text=${encodeURIComponent(seed)}`

const APPS = [
  {
    dev: 'Northwind Labs',
    app_name: 'Fokus Timer',
    app_slug: 'fokus-timer',
    category: 'Productivity',
    description: `**Fokus Timer** turns the Pomodoro technique into something you will actually stick with.

### Why people use it
- **Adaptive sessions** — Fokus watches how often you skip breaks and quietly adjusts your work blocks.
- **Deep-work stats** — see your real focused hours per project, not just raw screen time.
- **Nothing leaves your device** — sessions are stored locally; sync is opt-in and end-to-end encrypted.

### What's inside
A clean timer, a project picker, a weekly report and a widget. No ads, no account required, no upsell popups.`,
    icon_url: 'https://api.dicebear.com/9.x/icons/svg?seed=fokus&backgroundColor=0ea5e9&icon=clockFill',
    screenshots: [shot('Fokus — Timer', '0ea5e9'), shot('Fokus — Stats', '0284c7'), shot('Fokus — Projects', '0369a1')],
    latest_version: '3.4.1',
    latest_version_code: 341,
    min_version: '3.0.0',
    is_free: true,
    price: 0,
    rating: 4.8,
    total_downloads: 128_400,
    total_reviews: 3120,
    change_log: '• Adaptive break lengths\n• Fixed a widget crash on Android 15\n• 30% smaller download',
    auto_update: true,
    update_available: true,
  },
  {
    dev: 'Northwind Labs',
    app_name: 'Ledger Lite',
    app_slug: 'ledger-lite',
    category: 'Finance',
    description: `A personal ledger that fits in your pocket and never phones home.

- Double-entry bookkeeping made readable for humans
- Import CSV statements from 40+ banks
- Monthly envelopes with rollover
- CSV and PDF export you actually own

Built for freelancers who file their own taxes.`,
    icon_url: 'https://api.dicebear.com/9.x/icons/svg?seed=ledger&backgroundColor=16a34a&icon=wallet2',
    screenshots: [shot('Ledger — Overview', '16a34a'), shot('Ledger — Envelopes', '15803d')],
    latest_version: '2.1.0',
    latest_version_code: 210,
    is_free: false,
    price: 4.99,
    rating: 4.6,
    total_downloads: 41_900,
    total_reviews: 812,
    change_log: '• Envelope rollover\n• Faster CSV import',
    auto_update: true,
  },
  {
    dev: 'Pixelforge Studio',
    app_name: 'Lumen Photo',
    app_slug: 'lumen-photo',
    category: 'Photography',
    description: `**Lumen** is a RAW editor built around one idea: your edits should be reversible forever.

### Highlights
- Non-destructive layers with unlimited history
- Film emulation profiles built from real scans
- Batch export presets for web, print and social
- Opens ARW, CR3, NEF, DNG and HEIC

Runs entirely on-device — no cloud subscription.`,
    icon_url: 'https://api.dicebear.com/9.x/icons/svg?seed=lumen&backgroundColor=a855f7&icon=cameraFill',
    screenshots: [
      shot('Lumen — Develop', 'a855f7'),
      shot('Lumen — Layers', '9333ea'),
      shot('Lumen — Presets', '7e22ce'),
      shot('Lumen — Export', '6b21a8'),
    ],
    latest_version: '5.0.2',
    latest_version_code: 502,
    min_version: '4.8.0',
    is_free: false,
    price: 12.99,
    rating: 4.9,
    total_downloads: 76_200,
    total_reviews: 2410,
    change_log: '• New Portra 400 profile\n• 2× faster batch export\n• Apple Silicon fixes',
    auto_update: true,
  },
  {
    dev: 'Pixelforge Studio',
    app_name: 'Vectorly',
    app_slug: 'vectorly',
    category: 'Design',
    description: `A tiny vector editor for icons, logos and UI marks.

- Real boolean operations, pixel-snapped
- SVG in, SVG out — no proprietary format
- Icon grid templates for iOS, Android and web
- 900+ open-licensed starter glyphs`,
    icon_url: 'https://api.dicebear.com/9.x/icons/svg?seed=vectorly&backgroundColor=ec4899&icon=pentagon',
    screenshots: [shot('Vectorly — Canvas', 'ec4899'), shot('Vectorly — Grid', 'db2777')],
    latest_version: '1.9.4',
    latest_version_code: 194,
    is_free: true,
    price: 0,
    rating: 4.5,
    total_downloads: 33_100,
    total_reviews: 604,
    change_log: '• Boolean subtract fix\n• Dark canvas mode',
    auto_update: true,
  },
  {
    dev: 'Ravi Kumar',
    app_name: 'OfflineMaps',
    app_slug: 'offlinemaps',
    category: 'Travel',
    description: `Download an entire country and navigate with the radio off.

- OpenStreetMap vector tiles, 40 MB per state
- Turn-by-turn walking, cycling and driving
- Works in aeroplane mode, forever
- No account, no telemetry, no ads`,
    icon_url: 'https://api.dicebear.com/9.x/icons/svg?seed=offlinemaps&backgroundColor=f59e0b&icon=mapFill',
    screenshots: [shot('OfflineMaps — Map', 'f59e0b'), shot('OfflineMaps — Routes', 'd97706')],
    latest_version: '4.2.0',
    latest_version_code: 420,
    is_free: true,
    price: 0,
    rating: 4.7,
    total_downloads: 214_800,
    total_reviews: 5890,
    change_log: '• India tiles refreshed (June 2026)\n• Cycling elevation profiles',
    auto_update: true,
    update_available: true,
  },
  {
    dev: 'Ravi Kumar',
    app_name: 'ClipVault',
    app_slug: 'clipvault',
    category: 'Utilities',
    description: `A clipboard manager that remembers everything you copy — and forgets it when you tell it to.

- Searchable history with pinning
- Automatic redaction of anything that looks like a card number or OTP
- Sync over your own LAN, never a server
- 8 MB install`,
    icon_url: 'https://api.dicebear.com/9.x/icons/svg?seed=clipvault&backgroundColor=64748b&icon=clipboardFill',
    screenshots: [shot('ClipVault — History', '64748b')],
    latest_version: '1.3.2',
    latest_version_code: 132,
    is_free: true,
    price: 0,
    rating: 4.4,
    total_downloads: 18_600,
    total_reviews: 297,
    change_log: '• OTP auto-redaction\n• LAN sync pairing QR',
    auto_update: false,
  },
  {
    dev: 'Northwind Labs',
    app_name: 'Quietly',
    app_slug: 'quietly',
    category: 'Health',
    description: `Guided breathing and sleep sounds, recorded in real rooms rather than generated.

- 40 sessions from 2 to 45 minutes
- Sleep timer that fades instead of cutting
- Works with the screen off
- No subscription — one download, yours forever`,
    icon_url: 'https://api.dicebear.com/9.x/icons/svg?seed=quietly&backgroundColor=14b8a6&icon=moonStarsFill',
    screenshots: [shot('Quietly — Sessions', '14b8a6'), shot('Quietly — Sleep', '0d9488')],
    latest_version: '2.6.0',
    latest_version_code: 260,
    is_free: true,
    price: 0,
    rating: 4.8,
    total_downloads: 91_300,
    total_reviews: 2033,
    change_log: '• 6 new rain recordings\n• Fade-out sleep timer',
    auto_update: true,
  },
  {
    dev: 'Pixelforge Studio',
    app_name: 'Reel Cutter',
    app_slug: 'reel-cutter',
    category: 'Video',
    description: `Trim, caption and export vertical video without a timeline you need a course to understand.

- Auto captions in 12 languages, on-device
- Beat-matched cuts from any audio track
- Export presets for Reels, Shorts and TikTok
- Watermark-free on the free tier`,
    icon_url: 'https://api.dicebear.com/9.x/icons/svg?seed=reelcutter&backgroundColor=ef4444&icon=filmFill',
    screenshots: [shot('Reel Cutter — Trim', 'ef4444'), shot('Reel Cutter — Captions', 'dc2626')],
    latest_version: '3.0.0',
    latest_version_code: 300,
    min_version: '2.5.0',
    is_free: false,
    price: 7.99,
    rating: 4.3,
    total_downloads: 52_700,
    total_reviews: 1188,
    change_log: '• Rebuilt caption engine\n• Beat detection\n• Breaking: projects from 2.x are migrated on first launch',
    auto_update: true,
  },
  {
    dev: 'Ravi Kumar',
    app_name: 'Devlog',
    app_slug: 'devlog',
    category: 'Developer Tools',
    description: `A markdown journal for engineers, with code blocks that keep their highlighting.

- Git-backed: every entry is a commit
- Syntax highlighting for 180 languages
- Daily template with yesterday/today/blockers
- Full-text search across years of notes`,
    icon_url: 'https://api.dicebear.com/9.x/icons/svg?seed=devlog&backgroundColor=6366f1&icon=terminalFill',
    screenshots: [shot('Devlog — Today', '6366f1'), shot('Devlog — Search', '4f46e5')],
    latest_version: '0.9.7',
    latest_version_code: 97,
    is_free: true,
    price: 0,
    rating: 4.6,
    total_downloads: 12_400,
    total_reviews: 184,
    change_log: '• Git auto-commit\n• Fenced-block copy button',
    auto_update: true,
  },
  {
    dev: 'Northwind Labs',
    app_name: 'Splitwise Lite',
    app_slug: 'splitwise-lite',
    category: 'Social',
    description: `Split bills with friends without anyone creating an account.

- Share a group by link — no signup for guests
- Handles unequal splits, tips and multiple currencies
- Settles in the fewest possible payments
- Exports a clean summary as an image`,
    icon_url: 'https://api.dicebear.com/9.x/icons/svg?seed=splitlite&backgroundColor=8b5cf6&icon=peopleFill',
    screenshots: [shot('Split — Group', '8b5cf6')],
    latest_version: '1.5.1',
    latest_version_code: 151,
    is_free: true,
    price: 0,
    rating: 4.2,
    total_downloads: 27_500,
    total_reviews: 431,
    change_log: '• Multi-currency groups\n• Fewest-payment settle',
    auto_update: true,
  },
  {
    dev: 'Pixelforge Studio',
    app_name: 'Fontpair',
    app_slug: 'fontpair',
    category: 'Design',
    description: `Find a typeface pairing that works, in about ten seconds.

- 1,400 open-licensed families
- Live preview with your own copy
- Contrast and legibility scoring
- Copy-ready CSS and Tailwind config`,
    icon_url: 'https://api.dicebear.com/9.x/icons/svg?seed=fontpair&backgroundColor=0891b2&icon=fonts',
    screenshots: [shot('Fontpair — Pairs', '0891b2')],
    latest_version: '2.0.3',
    latest_version_code: 203,
    is_free: true,
    price: 0,
    rating: 4.5,
    total_downloads: 15_800,
    total_reviews: 226,
    change_log: '• Tailwind v4 output\n• 120 new families',
    auto_update: true,
  },
  {
    dev: 'Ravi Kumar',
    app_name: 'Battery Journal',
    app_slug: 'battery-journal',
    category: 'Utilities',
    description: `Understand what is actually draining your phone.

- Per-app wake-lock and network attribution
- Charge-cycle health estimate over months
- Weekly digest you can read in 20 seconds
- Reads only what Android already exposes`,
    icon_url: 'https://api.dicebear.com/9.x/icons/svg?seed=battery&backgroundColor=84cc16&icon=batteryCharging',
    screenshots: [shot('Battery — Drain', '84cc16')],
    latest_version: '1.1.0',
    latest_version_code: 110,
    is_free: true,
    price: 0,
    rating: 4.1,
    total_downloads: 9_300,
    total_reviews: 118,
    change_log: '• Wake-lock attribution\n• Android 16 support',
    auto_update: true,
  },
]

let createdApps = 0
const appRows = []
for (const a of APPS) {
  const developer = devByName[a.dev]
  let [row] = await sel('apps', `select=*&app_slug=eq.${a.app_slug}&limit=1`)
  if (!row) {
    const slugKey = a.app_slug.replace(/-/g, '_')
    ;[row] = await ins('apps', {
      app_id: `app_${slugKey}`,
      app_name: a.app_name,
      app_slug: a.app_slug,
      description: a.description,
      icon_url: a.icon_url,
      screenshots: a.screenshots,
      category: a.category,
      current_version: a.latest_version,
      latest_version: a.latest_version,
      latest_version_code: a.latest_version_code,
      min_version: a.min_version || null,
      is_free: a.is_free,
      price: a.price,
      download_url: `https://github.com/openappstore/${a.app_slug}/releases/download/v${a.latest_version}/${a.app_slug}-${a.latest_version}.apk`,
      google_drive_link: `https://drive.google.com/file/d/1${a.app_slug.replace(/-/g, '').padEnd(32, 'x').slice(0, 32)}/view`,
      website: developer.website,
      website_link: developer.website,
      privacy_policy_link: `${developer.website}/privacy`,
      change_log: a.change_log,
      auto_update: a.auto_update !== false,
      update_available: a.update_available === true,
      email: developer.email,
      rating: a.rating,
      total_downloads: a.total_downloads,
      total_reviews: a.total_reviews,
      status: 'published',
      developer_id: developer.id,
      store_id: store.id,
    })
    createdApps++
  }
  appRows.push({ row, spec: a })
}
console.log(`apps: ${appRows.length} total, ${createdApps} created`)

/* ── 4. Release history ─────────────────────────────────────────────────── */
function priorVersions(v) {
  const p = v.split('.').map(Number)
  const out = [v]
  let [maj, min, pat] = [p[0] || 1, p[1] || 0, p[2] || 0]
  for (let i = 0; i < 2; i++) {
    if (pat > 0) pat -= 1
    else if (min > 0) {
      min -= 1
      pat = 0
    } else if (maj > 1) {
      maj -= 1
      min = 9
      pat = 0
    } else break
    out.push(`${maj}.${min}.${pat}`)
  }
  return out
}

let createdVersions = 0
for (const { row, spec } of appRows) {
  const existing = await sel('app_versions', `select=id&app_id=eq.${row.id}&limit=1`)
  if (existing.length) continue
  const vs = priorVersions(spec.latest_version)
  const rows = vs.map((v, i) => ({
    app_id: row.id,
    version_number: v,
    release_notes:
      i === 0
        ? spec.change_log
        : i === 1
          ? '• Performance improvements\n• Minor bug fixes reported by users'
          : '• Stability fixes\n• Updated translations',
    change_log: i === 0 ? spec.change_log : null,
    download_url: `https://github.com/openappstore/${spec.app_slug}/releases/download/v${v}/${spec.app_slug}-${v}.apk`,
    file_size: 6 + Math.floor(Math.random() * 40),
    is_auto_update: true,
    force_update: i === 0 && spec.app_slug === 'reel-cutter',
    release_date: new Date(Date.now() - i * 34 * 864e5).toISOString(),
  }))
  await ins('app_versions', rows)
  createdVersions += rows.length
}
console.log(`app_versions: ${createdVersions} created`)

/* ── 4b. Demo users (app_reviews.user_id is NOT NULL) ───────────────────── */
const USERS = [
  { email: 'aarav.mehta@example.com', full_name: 'Aarav Mehta', username: 'aaravm' },
  { email: 'sofia.lindqvist@example.com', full_name: 'Sofia Lindqvist', username: 'sofial' },
  { email: 'daniel.okafor@example.com', full_name: 'Daniel Okafor', username: 'danielo' },
  { email: 'mei.tanaka@example.com', full_name: 'Mei Tanaka', username: 'meit' },
  { email: 'lucas.ferreira@example.com', full_name: 'Lucas Ferreira', username: 'lucasf' },
]

async function adminUsers() {
  const r = await fetch(`${URL_}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
  if (!r.ok) return []
  const j = await r.json().catch(() => ({}))
  return j.users || []
}

const existingUsers = await adminUsers()
const userIds = []
for (const u of USERS) {
  let found = existingUsers.find((x) => x.email === u.email)
  if (!found) {
    const r = await fetch(`${URL_}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: u.email,
        password: `Demo!${u.username}2026`,
        email_confirm: true,
        user_metadata: { full_name: u.full_name, username: u.username },
      }),
    })
    const t = await r.text()
    if (!r.ok) {
      console.log(`  user ${u.email} skipped: ${t.slice(0, 120)}`)
      continue
    }
    found = JSON.parse(t)
  }
  userIds.push({ id: found.id, ...u })

  const prof = await sel('user_profiles', `select=id&user_id=eq.${found.id}&limit=1`)
  if (!prof.length) {
    try {
      await ins('user_profiles', {
        user_id: found.id,
        username: u.username,
        full_name: u.full_name,
        avatar_url: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(u.full_name)}`,
        bio: 'Open App Store user.',
        account_type: 'user',
      })
    } catch (e) {
      console.log(`  profile skipped: ${String(e.message).slice(0, 100)}`)
    }
  }
}
console.log(`users: ${userIds.length} ready`)

/* ── 5. Reviews ─────────────────────────────────────────────────────────── */
const REVIEW_POOL = [
  [5, 'Exactly what I needed', 'Does one thing and does it properly. No ads, no nagging, no account. Installed on all my devices.'],
  [5, 'Replaced three other apps', 'I deleted three competing apps after a week with this. The offline support alone is worth it.'],
  [4, 'Great, with one gap', 'Really polished. I would love a tablet layout — on a 12" screen everything is stretched. Otherwise excellent.'],
  [5, 'Fast and tiny', 'Under 20 MB and it opens instantly on a five-year-old phone. That is rare now.'],
  [4, 'Solid update', 'The latest release fixed the crash I was seeing. Support replied to my email in a day.'],
  [3, 'Good but needs sync', 'Works well on one device. I want optional sync between my phone and laptop — I understand the privacy stance though.'],
  [5, 'Developer actually listens', 'Reported a bug, got a fix in the next release with a note in the changelog. Buying the paid tier to support this.'],
  [4, 'Worth the price', 'Paid version is honest — no subscription, no feature held hostage. Would recommend.'],
]

let createdReviews = 0
for (const { row } of appRows) {
  const existing = await sel('app_reviews', `select=id&app_id=eq.${row.id}&limit=1`)
  if (existing.length) continue
  const n = 3 + Math.floor(Math.random() * 3)
  const picks = [...REVIEW_POOL].sort(() => Math.random() - 0.5).slice(0, n)
  const rows = picks.map(([rating, title, text], i) => ({
    app_id: row.id,
    user_id: userIds[i % userIds.length].id,
    rating,
    title,
    review_text: text,
    helpful_count: Math.floor(Math.random() * 90),
    created_at: new Date(Date.now() - (i * 9 + 2) * 864e5).toISOString(),
  }))
  try {
    await ins('app_reviews', rows)
    createdReviews += rows.length
  } catch (e) {
    console.log(`  reviews skipped for ${row.app_slug}: ${String(e.message).slice(0, 120)}`)
    break
  }
}
console.log(`app_reviews: ${createdReviews} created`)

/* ── 6. Download log ────────────────────────────────────────────────────── */
let createdDownloads = 0
for (const { row, spec } of appRows.slice(0, 6)) {
  const existing = await sel('app_downloads', `select=id&app_id=eq.${row.id}&limit=1`)
  if (existing.length) continue
  const rows = Array.from({ length: 5 }, (_, i) => ({
    app_id: row.id,
    user_id: userIds[i % userIds.length]?.id || null,
    device_info: ['Android 15 / Pixel 8', 'Android 14 / Galaxy S23', 'Windows 11 / Chrome', 'macOS 15 / Safari', 'Android 13 / Redmi Note 12'][i],
    downloaded_at: new Date(Date.now() - i * 6 * 36e5).toISOString(),
  }))
  try {
    await ins('app_downloads', rows)
    createdDownloads += rows.length
  } catch (e) {
    console.log(`  downloads skipped: ${String(e.message).slice(0, 120)}`)
    break
  }
}
console.log(`app_downloads: ${createdDownloads} created`)

/* ── 6b. User libraries (installed apps) ────────────────────────────────── */
let createdInstalls = 0
for (const u of userIds) {
  const existing = await sel('user_installed_apps', `select=id&user_id=eq.${u.id}&limit=1`)
  if (existing.length) continue
  const picks = [...appRows].sort(() => Math.random() - 0.5).slice(0, 3 + Math.floor(Math.random() * 3))
  const rows = picks.map(({ row, spec }, i) => ({
    user_id: u.id,
    app_id: row.id,
    version_installed: spec.latest_version,
    installed_at: new Date(Date.now() - (i * 14 + 3) * 864e5).toISOString(),
    last_opened: new Date(Date.now() - i * 7 * 36e5).toISOString(),
  }))
  try {
    await ins('user_installed_apps', rows)
    createdInstalls += rows.length
  } catch (e) {
    console.log(`  installs skipped: ${String(e.message).slice(0, 120)}`)
    break
  }
}
console.log(`user_installed_apps: ${createdInstalls} created`)

/* ── 7. Developer stats rollup ──────────────────────────────────────────── */
for (const name of Object.keys(devByName)) {
  const d = devByName[name]
  const apps = await sel('apps', `select=total_downloads&developer_id=eq.${d.id}`)
  const total = apps.reduce((s, a) => s + (a.total_downloads || 0), 0)
  await fetch(`${URL_}/rest/v1/developers?id=eq.${d.id}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ apps_count: apps.length, total_downloads: total }),
  })
}
console.log('developer rollups updated')

console.log('\nSeed complete.')
