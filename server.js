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
 * wrangler.jsonc so they don't need to be re-declared as secrets.
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

// Read public vars from wrangler.jsonc so we don't have to duplicate them.
// Strip JS-style comments before parsing (wrangler uses JSONC).
let wranglerVars = {}
try {
  const raw = readFileSync('./wrangler.jsonc', 'utf8')
  const stripped = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  wranglerVars = JSON.parse(stripped).vars ?? {}
} catch {
  // Not fatal — rely solely on process.env if wrangler.jsonc can't be read.
}

// Merge: process.env values take priority (secrets override committed defaults).
const env = { ...wranglerVars, ...process.env }

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
