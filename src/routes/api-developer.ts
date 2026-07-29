import { Hono } from 'hono'
import { sbAuth, sbSelect, sbWrite, bearer, type Env } from '../lib/supabase'
import { APP_SELECT_WITH_DEV, toAppView, type AppRow } from '../lib/types'

const dev = new Hono<{ Bindings: Env }>()

type Ctx = { userId: string; developer: any | null; token: string }

async function requireDev(c: any): Promise<Ctx | Response> {
  const token = bearer(c.req.header('Authorization'))
  if (!token) return c.json({ success: false, error: 'Sign in first' }, 401)
  const { data: user, error } = await sbAuth<any>(c.env, 'user', { token })
  if (error || !user?.id) return c.json({ success: false, error: error || 'Invalid session' }, 401)
  const { data } = await sbSelect<any[]>(c.env, 'developers', `select=*&user_id=eq.${user.id}&limit=1`, token)
  return { userId: user.id, developer: (data || [])[0] || null, token }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
}

/** GET /api/developer/apps — my apps (all statuses) */
dev.get('/developer/apps', async (c) => {
  const ctx = await requireDev(c)
  if (ctx instanceof Response) return ctx
  if (!ctx.developer) return c.json({ success: true, apps: [], developer: null, needs_profile: true })

  const { data, error } = await sbSelect<AppRow[]>(
    c.env,
    'apps',
    `select=${APP_SELECT_WITH_DEV}&developer_id=eq.${ctx.developer.id}&order=created_at.desc&limit=200`,
    ctx.token
  )
  if (error) return c.json({ success: false, error }, 500)
  const apps = (data || []).map(toAppView)
  const totals = apps.reduce(
    (acc, a) => {
      acc.downloads += a.downloads
      acc.published += a.status === 'published' ? 1 : 0
      acc.drafts += a.status !== 'published' ? 1 : 0
      if (a.rating > 0) {
        acc.ratingSum += a.rating
        acc.ratedCount += 1
      }
      return acc
    },
    { downloads: 0, published: 0, drafts: 0, ratingSum: 0, ratedCount: 0 }
  )
  return c.json({
    success: true,
    developer: ctx.developer,
    apps,
    stats: {
      total_apps: apps.length,
      published: totals.published,
      drafts: totals.drafts,
      total_downloads: totals.downloads,
      avg_rating: totals.ratedCount ? Number((totals.ratingSum / totals.ratedCount).toFixed(2)) : 0,
    },
  })
})

/** POST /api/developer/apps — create app */
dev.post('/developer/apps', async (c) => {
  const ctx = await requireDev(c)
  if (ctx instanceof Response) return ctx
  if (!ctx.developer)
    return c.json({ success: false, error: 'Create your developer profile first', needs_profile: true }, 400)

  const body = await c.req.json().catch(() => ({}) as any)
  const app_name = String(body.app_name || '').trim()
  if (!app_name) return c.json({ success: false, error: 'App name is required' }, 400)
  if (!String(body.description || '').trim()) return c.json({ success: false, error: 'Description is required' }, 400)

  let slug = slugify(body.app_slug || app_name) || `app-${Date.now()}`
  const { data: clash } = await sbSelect<any[]>(c.env, 'apps', `select=id&app_slug=eq.${slug}&limit=1`, ctx.token)
  if ((clash || []).length) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`

  const isFree = body.is_free !== false && body.is_free !== 'false'
  const payload = {
    app_name,
    app_slug: slug,
    description: String(body.description),
    icon_url: body.icon_url || null,
    screenshots: Array.isArray(body.screenshots) && body.screenshots.length ? body.screenshots : null,
    category: body.category || 'Other',
    current_version: body.version || '1.0.0',
    latest_version: body.version || '1.0.0',
    download_url: body.download_url || null,
    website: body.website || null,
    support_email: body.support_email || ctx.developer.email || null,
    is_free: isFree,
    price: isFree ? 0 : Number(body.price || 0),
    status: body.status === 'published' ? 'published' : 'draft',
    developer_id: ctx.developer.id,
    store_id: ctx.developer.store_id || null,
  }

  const { data, error, status } = await sbWrite<any[]>(c.env, 'apps', 'POST', payload, '', ctx.token)
  if (error) {
    return c.json(
      {
        success: false,
        error,
        hint: error.includes('row-level security')
          ? 'Add an RLS INSERT policy on apps: WITH CHECK (developer_id IN (SELECT id FROM developers WHERE user_id = auth.uid())).'
          : undefined,
      },
      (status as any) || 400
    )
  }
  return c.json({ success: true, app: (data || [])[0] || null })
})

/** PATCH /api/developer/apps/:id — update own app */
dev.patch('/developer/apps/:id', async (c) => {
  const ctx = await requireDev(c)
  if (ctx instanceof Response) return ctx
  if (!ctx.developer) return c.json({ success: false, error: 'No developer profile' }, 400)

  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}) as any)
  const patch: Record<string, unknown> = {}
  const allow = [
    'app_name',
    'description',
    'icon_url',
    'category',
    'download_url',
    'website',
    'support_email',
    'status',
  ]
  allow.forEach((k) => {
    if (body[k] !== undefined) patch[k] = body[k] === '' ? null : body[k]
  })
  if (body.version) {
    patch.current_version = body.version
    patch.latest_version = body.version
  }
  if (body.is_free !== undefined) {
    const isFree = body.is_free !== false && body.is_free !== 'false'
    patch.is_free = isFree
    patch.price = isFree ? 0 : Number(body.price || 0)
  }
  if (Array.isArray(body.screenshots)) patch.screenshots = body.screenshots.length ? body.screenshots : null
  if (!Object.keys(patch).length) return c.json({ success: false, error: 'Nothing to update' }, 400)

  const { data, error, status } = await sbWrite<any[]>(
    c.env,
    'apps',
    'PATCH',
    patch,
    `id=eq.${id}&developer_id=eq.${ctx.developer.id}`,
    ctx.token
  )
  if (error) return c.json({ success: false, error }, (status as any) || 400)
  if (!(data || []).length)
    return c.json({ success: false, error: 'App not found, or your role cannot update it (RLS)' }, 403)
  return c.json({ success: true, app: (data || [])[0] })
})

/** DELETE /api/developer/apps/:id */
dev.delete('/developer/apps/:id', async (c) => {
  const ctx = await requireDev(c)
  if (ctx instanceof Response) return ctx
  if (!ctx.developer) return c.json({ success: false, error: 'No developer profile' }, 400)
  const id = c.req.param('id')
  const { error, status } = await sbWrite(
    c.env,
    'apps',
    'DELETE',
    undefined,
    `id=eq.${id}&developer_id=eq.${ctx.developer.id}`,
    ctx.token
  )
  if (error) return c.json({ success: false, error }, (status as any) || 400)
  return c.json({ success: true })
})

export default dev
