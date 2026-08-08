#!/usr/bin/env node
/**
 * Push the production Cloudflare Pages secrets for this project from .dev.vars.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * There are two footguns in the Pages secret API, and both have bitten this
 * project. This script is the safe path around them.
 *
 *  1. `wrangler pages secret put X` REPLACES the whole `env_vars` map, silently
 *     deleting every other binding.
 *
 *  2. The obvious workaround -- GET the project, merge one key into the
 *     returned `env_vars`, PATCH it back -- is ALSO destructive, and much more
 *     insidious. Cloudflare returns `secret_text` entries with their `value`
 *     STRIPPED (`{"type":"secret_text"}` and nothing else). Echoing that map
 *     back therefore writes EMPTY STRINGS over every pre-existing secret. The
 *     API answers `"success": true`, and a verification that only compares key
 *     NAMES sees all six keys present and reports everything fine -- while
 *     production is actually broken. That is exactly how SUPABASE_URL got
 *     blanked and every data API started failing with `Invalid URL: /rest/v1/...`.
 *
 * The rule this script enforces: ALWAYS send every secret with an explicit
 * real value read from .dev.vars, and never reuse a GET-derived map as PATCH
 * input. Then verify by round-tripping the live site, not by counting keys.
 *
 * Usage:
 *   node scripts/cf-secrets.mjs            # show what would be sent
 *   node scripts/cf-secrets.mjs --push     # actually write them
 *
 * Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
 * Secrets only take effect on the NEXT deployment, so deploy afterwards.
 */
import { readFileSync } from 'node:fs'

const PROJECT = 'openappstore'

/** Every secret the Worker reads. Keep in sync with src/ usage. */
const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STORE_ID',
  'OPENROUTER_API_KEY',
  'AUTH_CHALLENGE_SECRET',
]

/** Optional: only pushed when present locally. */
const OPTIONAL = ['GOOGLE_SITE_VERIFICATION', 'GOOGLE_SITE_VERIFICATION_FILE']

function readDevVars(path = new URL('../.dev.vars', import.meta.url)) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    const i = line.indexOf('=')
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

const vars = readDevVars()
const missing = REQUIRED.filter((k) => !vars[k])
if (missing.length) {
  console.error('Refusing to push -- these are missing from .dev.vars:', missing.join(', '))
  console.error('Pushing without them would blank the live values.')
  process.exit(1)
}

const keys = [...REQUIRED, ...OPTIONAL.filter((k) => vars[k])]
const envVars = Object.fromEntries(
  keys.map((k) => [k, { type: 'secret_text', value: vars[k] }]),
)

console.log(`Secrets for ${PROJECT} (production):`)
for (const k of keys) console.log(`   ${k.padEnd(30)} ${vars[k].length} chars`)

if (!process.argv.includes('--push')) {
  console.log('\nDry run. Re-run with --push to write these, then deploy.')
  process.exit(0)
}

const acct = process.env.CLOUDFLARE_ACCOUNT_ID
const token = process.env.CLOUDFLARE_API_TOKEN
if (!acct || !token) {
  console.error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set.')
  process.exit(1)
}

const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${acct}/pages/projects/${PROJECT}`,
  {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    // Every entry carries a real value -- no GET-derived placeholders.
    body: JSON.stringify({ deployment_configs: { production: { env_vars: envVars } } }),
  },
)
const body = await res.json()
if (!body.success) {
  console.error('\nPATCH failed:', JSON.stringify(body.errors))
  process.exit(1)
}

console.log(`\nPushed ${keys.length} secrets.`)
console.log('Secrets apply on the NEXT deployment. Run:')
console.log('   npm run build && npx wrangler pages deploy dist --project-name ' + PROJECT + ' --branch main')
console.log('Then verify against the live site (a key-name count proves nothing):')
console.log('   curl -s https://openappstore.pages.dev/api/apps?limit=1')
