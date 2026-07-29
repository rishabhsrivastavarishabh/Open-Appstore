import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { raw } from 'hono/html'
import apiApps from './routes/api-apps'
import apiAuth from './routes/api-auth'
import apiDeveloper from './routes/api-developer'
import { sbSelect, type Env } from './lib/supabase'
import { APP_SELECT_WITH_DEV, CATEGORIES, toAppView, type AppRow, type AppView } from './lib/types'
import { layout, esc } from './views/layout'
import {
  homePage,
  browsePage,
  categoriesPage,
  chartsPage,
  appDetailPage,
  developersPage,
  developerProfilePage,
  legalPage,
} from './views/store'
import {
  devDashboardPage,
  devAppsPage,
  devSubmitPage,
  devProfilePage,
  devDocsPage,
  authPage,
} from './views/developer'

const app = new Hono<{ Bindings: Env }>()

app.use('/api/*', cors())

/* ---------------- API ---------------- */
app.route('/api', apiApps)
app.route('/api', apiAuth)
app.route('/api', apiDeveloper)

app.get('/api/health', (c) =>
  c.json({ success: true, service: 'open-app-store', time: new Date().toISOString() })
)

/* ---------------- PWA / SEO assets ---------------- */
app.get('/manifest.webmanifest', (c) => {
  c.header('Content-Type', 'application/manifest+json; charset=utf-8')
  c.header('Cache-Control', 'public, max-age=3600')
  return c.body(
    JSON.stringify({
      name: 'Open App Store',
      short_name: 'Open Store',
      description: 'Discover, review and publish apps — an open app marketplace with a built-in developer console.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#1668e3',
      orientation: 'portrait-primary',
      categories: ['shopping', 'productivity', 'developer'],
      icons: [
        { src: '/static/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/static/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/static/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: '/static/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
      shortcuts: [
        { name: 'Browse apps', url: '/browse' },
        { name: 'Top charts', url: '/charts' },
        { name: 'Developer console', url: '/developer' },
      ],
    })
  )
})

app.get('/robots.txt', (c) => {
  c.header('Content-Type', 'text/plain; charset=utf-8')
  return c.body(`User-agent: *\nAllow: /\nDisallow: /developer/\nSitemap: ${new URL(c.req.url).origin}/sitemap.xml\n`)
})

/* ---------------- Helpers ---------------- */
async function fetchApps(env: Env, query: string): Promise<AppView[]> {
  const { data } = await sbSelect<AppRow[]>(env, 'apps', query)
  return (data || []).map(toAppView)
}

async function fetchCategories(env: Env): Promise<{ name: string; count: number }[]> {
  const { data } = await sbSelect<AppRow[]>(env, 'apps', 'select=category&status=eq.published&limit=1000')
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
  return list
}

/* ==================== STORE PAGES ==================== */

/** HOME */
app.get('/', async (c) => {
  const base = `select=${APP_SELECT_WITH_DEV}&status=eq.published`
  const [all, categories] = await Promise.all([
    fetchApps(c.env, `${base}&order=downloads.desc.nullslast&limit=60`),
    fetchCategories(c.env),
  ])

  const featured = all.filter((a) => a.is_featured)
  const newest = [...all].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  )
  const topRated = [...all].filter((a) => a.rating > 0).sort((a, b) => b.rating - a.rating)
  const downloads = all.reduce((s, a) => s + a.downloads, 0)
  const rated = all.filter((a) => a.rating > 0)
  const avg = rated.length ? rated.reduce((s, a) => s + a.rating, 0) / rated.length : 0
  const { data: devs } = await sbSelect<{ id: string }[]>(c.env, 'developers', 'select=id&limit=500')

  return c.html(
    layout({
      title: 'Discover apps',
      description:
        'Open App Store — discover, browse and download apps from independent developers. Publish your own app in minutes.',
      active: 'home',
      body: homePage({
        apps: all,
        featured,
        newest,
        topRated,
        categories,
        stats: {
          total_apps: all.length,
          total_downloads: downloads,
          avg_rating: avg,
          developers: (devs || []).length,
        },
      }),
      bootstrap: { page: 'home' },
    })
  )
})

/** BROWSE / SEARCH */
app.get('/apps', async (c) => {
  const search = (c.req.query('search') || '').trim()
  const category = c.req.query('category') || 'All'
  const sort = c.req.query('sort') || 'popular'
  const price = c.req.query('price') || 'all'

  const params = new URLSearchParams()
  params.set('select', APP_SELECT_WITH_DEV)
  params.set('status', 'eq.published')
  params.set('limit', '100')
  if (category && category !== 'All') params.set('category', `eq.${category}`)
  if (price === 'free') params.set('is_free', 'is.true')
  if (price === 'paid') params.set('is_free', 'is.false')
  if (search) {
    const safe = search.replace(/[,()*]/g, ' ')
    params.set('or', `(app_name.ilike.*${safe}*,description.ilike.*${safe}*,category.ilike.*${safe}*)`)
  }
  params.set(
    'order',
    sort === 'newest'
      ? 'created_at.desc.nullslast'
      : sort === 'rated'
        ? 'rating.desc.nullslast'
        : sort === 'name'
          ? 'app_name.asc'
          : 'downloads.desc.nullslast'
  )

  const [apps, categories] = await Promise.all([fetchApps(c.env, params.toString()), fetchCategories(c.env)])

  return c.html(
    layout({
      title: search ? `Search: ${search}` : category !== 'All' ? `${category} apps` : 'Browse apps',
      description: `Browse ${apps.length} apps on Open App Store.`,
      active: 'apps',
      body: browsePage({ apps, categories, search, category, sort, price }),
      bootstrap: { page: 'browse', search, category, sort, price },
    })
  )
})

/** CATEGORIES */
app.get('/categories', async (c) => {
  const categories = await fetchCategories(c.env)
  return c.html(
    layout({
      title: 'Categories',
      description: 'Browse apps by category on Open App Store.',
      active: 'categories',
      body: categoriesPage(categories),
      bootstrap: { page: 'categories' },
    })
  )
})

/** TOP CHARTS */
app.get('/top-charts', async (c) => {
  const base = `select=${APP_SELECT_WITH_DEV}&status=eq.published`
  const [popular, topRated, newest, free] = await Promise.all([
    fetchApps(c.env, `${base}&order=downloads.desc.nullslast&limit=50`),
    fetchApps(c.env, `${base}&rating=gt.0&order=rating.desc.nullslast&limit=50`),
    fetchApps(c.env, `${base}&order=created_at.desc.nullslast&limit=50`),
    fetchApps(c.env, `${base}&is_free=is.true&order=downloads.desc.nullslast&limit=50`),
  ])
  return c.html(
    layout({
      title: 'Top charts',
      description: 'Most downloaded, top rated and newest apps on Open App Store.',
      active: 'charts',
      body: chartsPage({ popular, topRated, newest, free }),
      bootstrap: { page: 'charts' },
    })
  )
})

/** APP DETAIL */
app.get('/app/:slug', async (c) => {
  const slug = c.req.param('slug')
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)
  const q = new URLSearchParams({ select: APP_SELECT_WITH_DEV, limit: '1' })
  if (isUuid) q.set('id', `eq.${slug}`)
  else q.set('app_slug', `eq.${slug}`)

  const { data } = await sbSelect<AppRow[]>(c.env, 'apps', q.toString())
  const row = (data || [])[0]
  if (!row) return notFound(c)

  const app_ = toAppView(row)
  const [devRes, moreRes, similarRes, reviewsRes] = await Promise.all([
    app_.developer_id
      ? sbSelect<any[]>(
          c.env,
          'developers',
          `select=id,developer_name,company_name,description,website,email,logo_url,avatar_url,verified&id=eq.${app_.developer_id}&limit=1`
        )
      : Promise.resolve({ data: [] } as any),
    app_.developer_id
      ? sbSelect<AppRow[]>(
          c.env,
          'apps',
          `select=${APP_SELECT_WITH_DEV}&developer_id=eq.${app_.developer_id}&status=eq.published&id=neq.${app_.id}&limit=6`
        )
      : Promise.resolve({ data: [] } as any),
    sbSelect<AppRow[]>(
      c.env,
      'apps',
      `select=${APP_SELECT_WITH_DEV}&category=eq.${encodeURIComponent(app_.category)}&status=eq.published&id=neq.${app_.id}&order=downloads.desc.nullslast&limit=6`
    ),
    sbSelect<any[]>(
      c.env,
      'app_reviews',
      `select=id,rating,title,review_text,helpful_count,created_at&app_id=eq.${app_.id}&order=created_at.desc&limit=20`
    ),
  ])

  return c.html(
    layout({
      title: app_.name,
      description: app_.short_description || `${app_.name} on Open App Store`,
      ogImage: app_.icon_url || undefined,
      active: 'apps',
      body: appDetailPage({
        app: app_,
        developer: (devRes.data || [])[0] || null,
        more: (moreRes.data || []).map(toAppView),
        similar: (similarRes.data || []).map(toAppView),
        reviews: reviewsRes.data || [],
      }),
      bootstrap: { page: 'app', appId: app_.id, slug: app_.slug },
    })
  )
})

/** DEVELOPERS DIRECTORY */
app.get('/developers', async (c) => {
  const { data } = await sbSelect<any[]>(
    c.env,
    'developers',
    'select=id,developer_name,company_name,description,website,logo_url,avatar_url,verified,created_at&order=created_at.desc&limit=100'
  )
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
  const devs = (data || []).map((d) => ({
    ...d,
    apps_count: agg[d.id]?.apps || 0,
    total_downloads: agg[d.id]?.downloads || 0,
  }))
  return c.html(
    layout({
      title: 'Developers',
      description: 'Studios and independent developers publishing on Open App Store.',
      active: 'developers',
      body: developersPage(devs),
      bootstrap: { page: 'developers' },
    })
  )
})

/** PUBLIC DEVELOPER PROFILE */
app.get('/developer-profile/:id', async (c) => {
  const id = c.req.param('id')
  const { data } = await sbSelect<any[]>(
    c.env,
    'developers',
    `select=id,developer_name,company_name,description,website,email,logo_url,avatar_url,verified,created_at&id=eq.${id}&limit=1`
  )
  const developer = (data || [])[0]
  if (!developer) return notFound(c)
  const apps = await fetchApps(
    c.env,
    `select=${APP_SELECT_WITH_DEV}&developer_id=eq.${id}&status=eq.published&order=downloads.desc.nullslast&limit=100`
  )
  return c.html(
    layout({
      title: developer.developer_name,
      description: developer.description || `Apps by ${developer.developer_name} on Open App Store.`,
      active: 'developers',
      body: developerProfilePage({ developer, apps }),
      bootstrap: { page: 'developer-profile', developerId: id },
    })
  )
})

/* ==================== DEVELOPER CONSOLE ==================== */
app.get('/developer', (c) =>
  c.html(
    layout({
      title: 'Developer dashboard',
      description: 'Publish and manage your apps on Open App Store.',
      mode: 'developer',
      active: 'dash',
      body: devDashboardPage(),
      bootstrap: { page: 'dev-dashboard' },
    })
  )
)

app.get('/developer/apps', (c) =>
  c.html(
    layout({
      title: 'My apps',
      mode: 'developer',
      active: 'myapps',
      body: devAppsPage(),
      bootstrap: { page: 'dev-apps' },
    })
  )
)

app.get('/developer/submit', (c) =>
  c.html(
    layout({
      title: 'Submit an app',
      mode: 'developer',
      active: 'submit',
      body: devSubmitPage(),
      bootstrap: { page: 'dev-submit' },
    })
  )
)

app.get('/developer/profile', (c) =>
  c.html(
    layout({
      title: 'Developer profile',
      mode: 'developer',
      active: 'profile',
      body: devProfilePage(),
      bootstrap: { page: 'dev-profile' },
    })
  )
)

app.get('/developer/docs', (c) => {
  const url = new URL(c.req.url)
  return c.html(
    layout({
      title: 'API documentation',
      mode: 'developer',
      active: 'docs',
      body: devDocsPage(url.origin),
      bootstrap: { page: 'dev-docs' },
    })
  )
})

/* ==================== AUTH ==================== */
for (const [path, mode] of [
  ['/auth/login', 'login'],
  ['/auth/signup', 'signup'],
  ['/auth/reset', 'reset'],
] as const) {
  app.get(path, (c) =>
    c.html(
      layout({
        title: mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password',
        body: authPage(mode),
        bodyClass: 'body-auth',
        bootstrap: { page: `auth-${mode}`, next: c.req.query('next') || '' },
      })
    )
  )
}

/* ==================== LEGAL ==================== */
app.get('/legal/privacy', (c) =>
  c.html(
    layout({
      title: 'Privacy Policy',
      body: legalPage('Privacy Policy', [
        {
          h: 'What we collect',
          p: [
            'When you create an account we store your email address and, if you register as a developer, the studio details you provide (name, company, website, contact email, logo URL).',
            'For published apps we store the listing metadata you submit, together with aggregate download counts and user ratings.',
          ],
        },
        {
          h: 'How we use it',
          p: [
            'Account data is used solely to authenticate you and to attribute app listings to the correct developer.',
            'Aggregate download and rating counts are shown publicly on listings and charts. Individual reviews are shown with their rating and text.',
          ],
        },
        {
          h: 'Storage & processors',
          p: [
            'Authentication and application data are stored in Supabase (PostgreSQL). Page delivery runs on Cloudflare\u2019s edge network.',
            'We do not sell personal data and we do not run third-party advertising trackers on this site.',
          ],
        },
        {
          h: 'Your rights',
          p: [
            'You can update or delete your developer profile and app listings at any time from the developer console.',
            'To request full account deletion, contact the store operator from the email address associated with your account.',
          ],
        },
      ]),
    })
  )
)

app.get('/legal/terms', (c) =>
  c.html(
    layout({
      title: 'Terms of Service',
      body: legalPage('Terms of Service', [
        {
          h: 'Using the store',
          p: [
            'Browsing the catalogue is open to everyone. Creating an account is required to publish apps or post reviews.',
            'You are responsible for keeping your account credentials secure.',
          ],
        },
        {
          h: 'Publishing apps',
          p: [
            'You must own or have the right to distribute anything you publish, including icons, screenshots and binaries.',
            'Listings must accurately describe the app. Malware, misleading listings and infringing content are removed without notice.',
          ],
        },
        {
          h: 'Downloads',
          p: [
            'Download links point to resources hosted by the developer. Verify anything you install; the store does not scan third-party binaries.',
            'Paid listings display the developer\u2019s stated price; payment handling is arranged by the developer.',
          ],
        },
        {
          h: 'Liability',
          p: [
            'The store is provided on an "as is" basis without warranties of any kind.',
            'Developers remain solely responsible for their apps and any support obligations attached to them.',
          ],
        },
      ]),
    })
  )
)

app.get('/legal/guidelines', (c) =>
  c.html(
    layout({
      title: 'Developer Guidelines',
      body: legalPage('Developer Guidelines', [
        {
          h: 'Listing quality',
          p: [
            'Use a square icon of at least 512×512 pixels. Avoid text-heavy icons — they become unreadable at small sizes.',
            'Write a description that opens with the single clearest benefit, then list features as bullet points. Markdown headings and lists are rendered on your listing page.',
          ],
        },
        {
          h: 'Versioning',
          p: [
            'Use semantic versioning (MAJOR.MINOR.PATCH). Bump the version whenever you replace the download artefact.',
            'Keep the download URL stable and always pointing to the current release.',
          ],
        },
        {
          h: 'Categories',
          p: [
            'Choose the single category that best fits your app\u2019s primary purpose. Listings placed in unrelated categories may be reclassified.',
          ],
        },
        {
          h: 'Prohibited content',
          p: [
            'No malware, spyware, cryptominers or apps that collect data without disclosure.',
            'No content that infringes copyright or trademarks, and no impersonation of other developers or brands.',
          ],
        },
      ]),
    })
  )
)

/* ==================== 404 ==================== */
function notFound(c: any) {
  return c.html(
    layout({
      title: 'Not found',
      body: raw(`
<section class="error-page">
  <span class="error-code">404</span>
  <h1>We couldn't find that page</h1>
  <p>The app or page you're looking for may have been unpublished or moved.</p>
  <div class="gate-actions">
    <a class="btn btn-primary" href="/"><i class="fa-solid fa-house"></i> Back to store</a>
    <a class="btn btn-outline" href="/apps"><i class="fa-solid fa-grip"></i> Browse apps</a>
  </div>
</section>`),
    }),
    404
  )
}

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ success: false, error: 'Endpoint not found' }, 404)
  return notFound(c)
})

app.onError((err, c) => {
  console.error('Unhandled error:', err)
  if (c.req.path.startsWith('/api/'))
    return c.json({ success: false, error: err.message || 'Internal error' }, 500)
  return c.html(
    layout({
      title: 'Something went wrong',
      body: raw(`
<section class="error-page">
  <span class="error-code">500</span>
  <h1>Something went wrong</h1>
  <p>${esc(err.message || 'Unexpected error')}</p>
  <a class="btn btn-primary" href="/"><i class="fa-solid fa-house"></i> Back to store</a>
</section>`),
    }),
    500
  )
})

export default app
