import { Hono } from 'hono'
import { sbSelect, sbWrite, bearer, type Env } from '../lib/supabase'
import { APP_SELECT_WITH_DEV, CATEGORIES, toAppView, type AppRow } from '../lib/types'

const api = new Hono<{ Bindings: Env }>()

/** GET /api/apps  — list published apps with filters */
api.get('/apps', async (c) => {
  const env = c.env
  const limit = Math.min(parseInt(c.req.query('limit') || '60', 10) || 60, 100)
  const offset = parseInt(c.req.query('offset') || '0', 10) || 0
  const category = c.req.query('category')
  const search = (c.req.query('search') || '').trim()
  const sort = c.req.query('sort') || 'popular'
  const featured = c.req.query('featured')

  const params = new URLSearchParams()
  params.set('select', APP_SELECT_WITH_DEV)
  params.set('status', 'eq.published')
  params.set('limit', String(limit))
  params.set('offset', String(offset))

  if (category && category !== 'All') params.set('category', `eq.${category}`)
  if (featured === 'true') params.set('is_featured', 'eq.true')
  if (search) {
    const safe = search.replace(/[,()*]/g, ' ')
    params.set('or', `(app_name.ilike.*${safe}*,description.ilike.*${safe}*,category.ilike.*${safe}*)`)
  }

  const order =
    sort === 'newest'
      ? 'created_at.desc.nullslast'
      : sort === 'rated'
        ? 'rating.desc.nullslast'
        : sort === 'name'
          ? 'app_name.asc'
          : 'downloads.desc.nullslast'
  params.set('order', order)

  const { data, error, status } = await sbSelect<AppRow[]>(env, 'apps', params.toString())
  if (error) return c.json({ success: false, error, apps: [] }, (status as any) || 500)

  const apps = (data || []).map(toAppView)
  return c.json({ success: true, apps, total: apps.length, limit, offset })
})

/** GET /api/apps/stats */
api.get('/apps/stats', async (c) => {
  const params = new URLSearchParams({
    select: 'category,downloads,rating,is_free,total_ratings',
    status: 'eq.published',
    limit: '1000',
  })
  const { data, error } = await sbSelect<AppRow[]>(c.env, 'apps', params.toString())
  if (error) return c.json({ success: false, error }, 500)
  const rows = data || []
  const downloads = rows.reduce((s, r) => s + Number(r.downloads || 0), 0)
  const rated = rows.filter((r) => Number(r.rating || 0) > 0)
  const avg = rated.length ? rated.reduce((s, r) => s + Number(r.rating || 0), 0) / rated.length : 0
  const byCategory: Record<string, number> = {}
  rows.forEach((r) => {
    const k = r.category || 'Other'
    byCategory[k] = (byCategory[k] || 0) + 1
  })
  const { data: devs } = await sbSelect<{ id: string }[]>(c.env, 'developers', 'select=id&limit=1000')
  return c.json({
    success: true,
    stats: {
      total_apps: rows.length,
      total_downloads: downloads,
      avg_rating: Number(avg.toFixed(2)),
      free_apps: rows.filter((r) => r.is_free !== false).length,
      developers: (devs || []).length,
      categories: byCategory,
    },
  })
})

/** GET /api/apps/:idOrSlug */
api.get('/apps/:key', async (c) => {
  const key = c.req.param('key')
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  const params = new URLSearchParams({ select: APP_SELECT_WITH_DEV, limit: '1' })
  if (isUuid) params.set('or', `(id.eq.${key},app_id.eq.${key})`)
  else params.set('app_slug', `eq.${key}`)

  const { data, error } = await sbSelect<AppRow[]>(c.env, 'apps', params.toString())
  if (error) return c.json({ success: false, error }, 500)
  const row = (data || [])[0]
  if (!row) return c.json({ success: false, error: 'App not found' }, 404)

  const app = toAppView(row)

  // developer profile + sibling apps + reviews (best effort)
  const [devRes, siblingRes, reviewRes] = await Promise.all([
    app.developer_id
      ? sbSelect<any[]>(
          c.env,
          'developers',
          `select=id,developer_name,company_name,description,website,logo_url,avatar_url,verified,created_at&id=eq.${app.developer_id}&limit=1`
        )
      : Promise.resolve({ data: [], error: null, status: 200 } as any),
    app.developer_id
      ? sbSelect<AppRow[]>(
          c.env,
          'apps',
          `select=${APP_SELECT_WITH_DEV}&developer_id=eq.${app.developer_id}&status=eq.published&id=neq.${app.id}&limit=8`
        )
      : Promise.resolve({ data: [], error: null, status: 200 } as any),
    sbSelect<any[]>(
      c.env,
      'app_reviews',
      `select=id,rating,title,review_text,helpful_count,created_at&app_id=eq.${app.id}&order=created_at.desc&limit=20`
    ),
  ])

  // similar apps in same category
  const { data: similar } = await sbSelect<AppRow[]>(
    c.env,
    'apps',
    `select=${APP_SELECT_WITH_DEV}&category=eq.${encodeURIComponent(app.category)}&status=eq.published&id=neq.${app.id}&order=downloads.desc.nullslast&limit=8`
  )

  return c.json({
    success: true,
    app,
    developer: (devRes.data || [])[0] || null,
    more_from_developer: (siblingRes.data || []).map(toAppView),
    similar: (similar || []).map(toAppView),
    reviews: reviewRes.data || [],
  })
})

/** GET /api/categories */
api.get('/categories', async (c) => {
  const { data } = await sbSelect<AppRow[]>(
    c.env,
    'apps',
    'select=category&status=eq.published&limit=1000'
  )
  const counts: Record<string, number> = {}
  ;(data || []).forEach((r) => {
    const k = r.category || 'Other'
    counts[k] = (counts[k] || 0) + 1
  })
  const list = [...new Set([...CATEGORIES, ...Object.keys(counts)])].map((name) => ({
    name,
    count: counts[name] || 0,
  }))
  list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return c.json({ success: true, categories: list })
})

/** GET /api/developers — public directory */
api.get('/developers', async (c) => {
  const { data, error } = await sbSelect<any[]>(
    c.env,
    'developers',
    'select=id,developer_name,company_name,description,website,logo_url,avatar_url,verified,created_at&order=created_at.desc&limit=100'
  )
  if (error) return c.json({ success: false, error }, 500)
  const { data: apps } = await sbSelect<AppRow[]>(
    c.env,
    'apps',
    'select=developer_id,downloads&status=eq.published&limit=1000'
  )
  const agg: Record<string, { apps: number; downloads: number }> = {}
  ;(apps || []).forEach((a) => {
    const k = a.developer_id || ''
    if (!agg[k]) agg[k] = { apps: 0, downloads: 0 }
    agg[k].apps += 1
    agg[k].downloads += Number(a.downloads || 0)
  })
  const developers = (data || []).map((d) => ({
    ...d,
    apps_count: agg[d.id]?.apps || 0,
    total_downloads: agg[d.id]?.downloads || 0,
  }))
  return c.json({ success: true, developers })
})

/** GET /api/developers/:id — public profile with apps */
api.get('/developers/:id', async (c) => {
  const id = c.req.param('id')
  const { data, error } = await sbSelect<any[]>(
    c.env,
    'developers',
    `select=id,developer_name,company_name,description,website,email,logo_url,avatar_url,verified,created_at&id=eq.${id}&limit=1`
  )
  if (error) return c.json({ success: false, error }, 500)
  const dev = (data || [])[0]
  if (!dev) return c.json({ success: false, error: 'Developer not found' }, 404)
  const { data: apps } = await sbSelect<AppRow[]>(
    c.env,
    'apps',
    `select=${APP_SELECT_WITH_DEV}&developer_id=eq.${id}&status=eq.published&order=downloads.desc.nullslast&limit=100`
  )
  return c.json({ success: true, developer: dev, apps: (apps || []).map(toAppView) })
})

/** POST /api/apps/:id/download — count a download (best effort, needs auth policy) */
api.post('/apps/:id/download', async (c) => {
  const id = c.req.param('id')
  const { data } = await sbSelect<AppRow[]>(c.env, 'apps', `select=id,downloads,download_url,website&id=eq.${id}&limit=1`)
  const row = (data || [])[0]
  if (!row) return c.json({ success: false, error: 'App not found' }, 404)
  const token = bearer(c.req.header('Authorization'))
  // Try to increment; RLS may reject for anonymous users — that's fine.
  await sbWrite(c.env, 'apps', 'PATCH', { downloads: Number(row.downloads || 0) + 1 }, `id=eq.${id}`, token)
  return c.json({ success: true, url: row.download_url || row.website || null })
})

/** GET /api/apps/:id/reviews */
api.get('/apps/:id/reviews', async (c) => {
  const id = c.req.param('id')
  const { data, error } = await sbSelect<any[]>(
    c.env,
    'app_reviews',
    `select=id,rating,title,review_text,helpful_count,created_at&app_id=eq.${id}&order=created_at.desc&limit=50`
  )
  if (error) return c.json({ success: false, error, reviews: [] }, 500)
  return c.json({ success: true, reviews: data || [] })
})

/** POST /api/apps/:id/reviews — requires auth token */
api.post('/apps/:id/reviews', async (c) => {
  const token = bearer(c.req.header('Authorization'))
  if (!token) return c.json({ success: false, error: 'Sign in to write a review' }, 401)
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}) as any)
  const rating = Math.max(1, Math.min(5, parseInt(String(body.rating || 0), 10) || 0))
  if (!rating) return c.json({ success: false, error: 'Rating (1-5) is required' }, 400)

  const { data, error, status } = await sbWrite<any[]>(
    c.env,
    'app_reviews',
    'POST',
    {
      app_id: id,
      rating,
      title: body.title || null,
      review_text: body.review_text || null,
    },
    '',
    token
  )
  if (error) return c.json({ success: false, error }, (status as any) || 400)
  return c.json({ success: true, review: (data || [])[0] || null })
})

export default api
