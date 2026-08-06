/**
 * Node.js entry point for Replit deployment.
 *
 * The Hono app was written for Cloudflare Workers where environment variables
 * arrive as c.env (the second argument to fetch()). @hono/node-server forwards
 * whatever we pass as the second arg to app.fetch, so passing process.env here
 * makes every c.env.SUPABASE_URL / c.env.SUPABASE_ANON_KEY reference work
 * identically on Node.js.
 *
 * Public values (SUPABASE_URL, SUPABASE_ANON_KEY, STORE_ID) are loaded from
 * env.public.json so they don't need to be re-declared as secrets.
 * SUPABASE_SERVICE_ROLE_KEY must be set as a Replit Secret for 2FA to work.
 *
 * Static files under /static/ are served from public/static/ — Cloudflare Pages
 * handles this automatically in production; here we do it via serveStatic.
 */

import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import workerApp from './src/index.js'

// Read the public, non-secret defaults so we don't have to duplicate them per host.
//
// These used to be read out of wrangler.jsonc's "vars" block, but that block had
// to go: a vars entry plus a Cloudflare Pages secret of the same name makes the
// Pages deploy fail with "Binding name '<NAME>' already in use". They now live in
// env.public.json, which is Cloudflare-agnostic.
let publicVars = {}
try {
  const parsed = JSON.parse(readFileSync('./env.public.json', 'utf8'))
  // Drop the _comment documentation key so it never reaches the app as an env var.
  publicVars = Object.fromEntries(Object.entries(parsed).filter(([k]) => !k.startsWith('_')))
} catch {
  // Not fatal — rely solely on process.env if the file can't be read.
}

// Merge: process.env values take priority (secrets override committed defaults).
// Filter out undefined/empty process.env entries so a blank var can't shadow a
// working default with `undefined` (which surfaces as "Invalid URL: undefined/...").
const fromProcess = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined && v !== '')
)
const env = { ...publicVars, ...fromProcess }

for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'STORE_ID']) {
  if (!env[key]) console.warn(`[env] WARNING: ${key} is not set — API routes will fail.`)
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[env] WARNING: SUPABASE_SERVICE_ROLE_KEY is not set — 2FA and admin routes will fail.')
}

// Wrap the Cloudflare Workers app in a Node.js-compatible Hono instance.
// 1. Serve /static/* from public/static/ (Cloudflare Pages does this automatically).
// 2. Forward everything else to the worker app, injecting env as c.env.
const root = new Hono()

root.use('/static/*', serveStatic({ root: './public' }))

root.all('*', (c) => workerApp.fetch(c.req.raw, env))

const port = Number(process.env.PORT ?? 5000)

serve({
  fetch: root.fetch,
  port,
  hostname: '0.0.0.0'
})

console.log(`Open Appstore running on http://0.0.0.0:${port}`)
