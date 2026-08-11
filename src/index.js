import { Hono } from "hono";
import { cors } from "hono/cors";
import { raw } from "hono/html";
import apiApps from "./routes/api-apps.js";
import apiAuth from "./routes/api-auth.js";
import apiDeveloper from "./routes/api-developer.js";
import apiV1 from "./routes/api-v1.js";
import apiAi from "./routes/api-ai.js";
import { sbSelect } from "./lib/supabase.js";
import { normalizeImageUrl } from "./lib/media.js";
import { resolveAppSize, classifyDownload } from "./lib/appsize.js";
import {
  APP_SELECT_WITH_DEV,
  DEV_SELECT,
  REVIEW_SELECT,
  ORDER,
  CATEGORIES,
  toAppView
} from "./lib/types.js";
import { layout, esc, setSiteVerification, setRequestUrl } from "./views/layout.js";
import {
  websiteLd,
  breadcrumbLd,
  appLd,
  itemListLd,
  collectionLd,
  webPageLd,
  organizationLd,
  robotsTxt,
  sitemapXml
} from "./lib/seo.js";
import { notFoundArt } from "./views/components.js";
import {
  homePage,
  browsePage,
  categoriesPage,
  chartsPage,
  appDetailPage,
  developersPage,
  developerProfilePage,
  legalPage
} from "./views/store.js";
import {
  devDashboardPage,
  devAppsPage,
  devSubmitPage,
  devProfilePage,
  devSecurityPage,
  devApiKeysPage,
  devDocsPage,
  authPage,
  authCallbackPage
} from "./views/developer.js";
import { enabledProviders } from "./lib/oauth.js";

/** Android application id of the companion Open Appstore client. */
const PACKAGE_NAME = "com.app.store";
const app = new Hono();
// Publish the Search Console token into the view layer once per request.
// Bindings only exist inside a request in Workers, so this cannot be done at
// module scope.
app.use("*", async (c, next) => {
  setSiteVerification(c.env.GOOGLE_SITE_VERIFICATION || "");
  // Canonical/og:url need the absolute request origin, which only exists inside
  // a request. Set here so every layout() call gets it without passing it in.
  setRequestUrl(c.req.url);
  await next();
});

/**
 * Search Console's HTML-file verification method.
 *
 * Google asks you to host googleXXXX.html containing one line of text. Served
 * from a route rather than a static file so the token stays in an environment
 * variable instead of being committed to the repo. Only responds when the
 * requested filename matches the configured token, so it cannot be used to
 * confirm arbitrary guesses.
 */
app.get("/google:token{[A-Za-z0-9_-]+\\.html}", (c) => {
  const configured = String(c.env.GOOGLE_SITE_VERIFICATION_FILE || "").trim();
  const asked = `google${c.req.param("token")}`;
  if (!configured || asked !== configured) return c.notFound();
  return c.text(`google-site-verification: ${configured}`);
});

app.use("/api/*", cors());
// The versioned developer API is mounted first: it owns every path under
// /api/v1 (including its own JSON 404 fallback), so it must match before the
// unversioned routers get a chance to.
app.route("/api/v1", apiV1);
app.route("/api", apiAi);
app.route("/api", apiApps);
app.route("/api", apiAuth);
app.route("/api", apiDeveloper);
app.get(
  "/api/health",
  (c) => c.json({ success: true, service: "open-appstore", time: (/* @__PURE__ */ new Date()).toISOString() })
);
// Served at both paths: the spec name and the /manifest.json alias that some
// crawlers and Android WebView shells probe for.
app.on("GET", ["/manifest.webmanifest", "/manifest.json"], (c) => {
  c.header("Content-Type", "application/manifest+json; charset=utf-8");
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(
    JSON.stringify({
      id: "/",
      name: "Open Appstore",
      short_name: "Open Appstore",
      description: "Discover, review and publish apps \u2014 an open app marketplace with a built-in developer console.",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#1668e3",
      orientation: "portrait-primary",
      categories: ["shopping", "productivity", "developer"],
      icons: [
        { src: "/static/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/static/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/static/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        { src: "/static/favicon.svg", sizes: "any", type: "image/svg+xml" }
      ],
      shortcuts: [
        { name: "Browse apps", url: "/apps" },
        { name: "Top charts", url: "/top-charts" },
        { name: "Developer console", url: "/developer" }
      ],
      prefer_related_applications: false,
      related_applications: [
        { platform: "play", id: PACKAGE_NAME, url: `https://play.google.com/store/apps/details?id=${PACKAGE_NAME}` }
      ]
    })
  );
});
/*
 * robots.txt
 *
 * Generated rather than served as a static file so the Sitemap: line always
 * carries the CURRENT origin -- a hardcoded one would point preview
 * deployments at production and confuse crawling of both.
 */
app.get("/robots.txt", (c) => {
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(robotsTxt(new URL(c.req.url).origin));
});

/**
 * XML sitemap, generated live from published apps, categories and developers.
 *
 * Live generation means a newly published app is discoverable on the next crawl
 * with no build step or manual resubmission. Search Console reads this file
 * directly once the property is verified.
 */
app.get("/sitemap.xml", async (c) => {
  const origin = new URL(c.req.url).origin;
  const [appsRes, devsRes] = await Promise.all([
    sbSelect(
      c.env,
      "apps",
      "select=app_slug,app_name,category,updated_at,created_at,icon_url&status=eq.published&order=total_downloads.desc&limit=1000"
    ),
    sbSelect(c.env, "developers", "select=id,updated_at,created_at&limit=500")
  ]);
  const apps = appsRes.data || [];
  const now = new Date().toISOString();

  const entries = [
    { path: "/", lastmod: now, changefreq: "daily", priority: "1.0" },
    { path: "/apps", lastmod: now, changefreq: "daily", priority: "0.9" },
    { path: "/top-charts", lastmod: now, changefreq: "daily", priority: "0.9" },
    { path: "/categories", lastmod: now, changefreq: "weekly", priority: "0.8" },
    { path: "/developers", lastmod: now, changefreq: "weekly", priority: "0.7" },
    { path: "/about", changefreq: "monthly", priority: "0.5" },
    { path: "/legal/privacy", changefreq: "yearly", priority: "0.3" },
    { path: "/legal/terms", changefreq: "yearly", priority: "0.3" },
    { path: "/legal/guidelines", changefreq: "yearly", priority: "0.4" }
  ];

  // Category listings. Only categories that actually HAVE published apps are
  // listed: a URL that renders an empty result set is a soft-404 to Google and
  // drags down the crawl quality of everything around it.
  const seen = new Set();
  apps.forEach((a) => {
    const cat = a.category || "Other";
    if (seen.has(cat)) return;
    seen.add(cat);
    entries.push({
      path: `/apps?category=${encodeURIComponent(cat)}`,
      changefreq: "weekly",
      priority: "0.6"
    });
  });

  // App detail pages, each with its icon declared via the image extension.
  apps.forEach((a) => {
    if (!a.app_slug) return;
    const icon = normalizeImageUrl(a.icon_url, 512);
    entries.push({
      path: `/app/${encodeURIComponent(a.app_slug)}`,
      lastmod: a.updated_at || a.created_at,
      changefreq: "weekly",
      priority: "0.8",
      ...(icon ? { image: icon, imageTitle: a.app_name || a.app_slug } : {})
    });
  });

  // Public developer profiles.
  (devsRes.data || []).forEach((d) => {
    if (!d.id) return;
    entries.push({
      path: `/developer-profile/${d.id}`,
      lastmod: d.updated_at || d.created_at,
      changefreq: "monthly",
      priority: "0.5"
    });
  });

  c.header("Content-Type", "application/xml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(sitemapXml(origin, entries));
});
async function fetchApps(env, query) {
  const { data } = await sbSelect(env, "apps", query);
  return (data || []).map(toAppView);
}
async function fetchCategories(env) {
  const { data } = await sbSelect(env, "apps", "select=category&status=eq.published&limit=1000");
  const counts = {};
  (data || []).forEach((r) => {
    const k = r.category || "Other";
    counts[k] = (counts[k] || 0) + 1;
  });
  const list = [.../* @__PURE__ */ new Set([...CATEGORIES, ...Object.keys(counts)])].map((name) => ({
    name,
    count: counts[name] || 0
  }));
  list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return list;
}
app.get("/", async (c) => {
  const base = `select=${APP_SELECT_WITH_DEV}&status=eq.published`;
  const [all, categories] = await Promise.all([
    fetchApps(c.env, `${base}&order=${ORDER.popular}&limit=60`),
    fetchCategories(c.env)
  ]);
  const featured = all.filter((a) => a.is_featured);
  const newest = [...all].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
  const topRated = [...all].filter((a) => a.rating > 0).sort((a, b) => b.rating - a.rating);
  const downloads = all.reduce((s, a) => s + a.downloads, 0);
  const rated = all.filter((a) => a.rating > 0);
  const avg = rated.length ? rated.reduce((s, a) => s + a.rating, 0) / rated.length : 0;
  const { data: devs } = await sbSelect(c.env, "developers", "select=id&limit=500");
  return c.html(
    layout({
      title: "Discover apps",
      description: "Open Appstore \u2014 discover, browse and download apps from independent developers. Publish your own app in minutes.",
      active: "home",
      // WebSite + SearchAction is what can earn a sitelinks search box; the
      // ItemList tells Google the popular apps on this page are real entities
      // worth following.
      jsonLd: [
        websiteLd(new URL(c.req.url).origin),
        itemListLd(new URL(c.req.url).origin, "Popular apps on Open Appstore", all, 20)
      ],
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
          developers: (devs || []).length
        }
      }),
      bootstrap: { page: "home" }
    })
  );
});
app.get("/apps", async (c) => {
  const search = (c.req.query("search") || "").trim();
  const category = c.req.query("category") || "All";
  const sort = c.req.query("sort") || "popular";
  const price = c.req.query("price") || "all";
  const params = new URLSearchParams();
  params.set("select", APP_SELECT_WITH_DEV);
  params.set("status", "eq.published");
  params.set("limit", "100");
  if (category && category !== "All") params.set("category", `eq.${category}`);
  if (price === "free") params.set("is_free", "is.true");
  if (price === "paid") params.set("is_free", "is.false");
  if (search) {
    const safe = search.replace(/[,()*]/g, " ");
    params.set("or", `(app_name.ilike.*${safe}*,description.ilike.*${safe}*,category.ilike.*${safe}*)`);
  }
  params.set(
    "order",
    sort === "newest" ? ORDER.newest : sort === "rated" ? ORDER.rating : sort === "name" ? ORDER.name : ORDER.popular
  );
  const [apps, categories] = await Promise.all([fetchApps(c.env, params.toString()), fetchCategories(c.env)]);
  return c.html(
    layout({
      title: search ? `Search: ${search}` : category !== "All" ? `${category} apps` : "Browse apps",
      description: search
        ? `Search results for \u201c${search}\u201d on Open Appstore.`
        : category !== "All"
          ? `Browse ${apps.length} ${category} apps on Open Appstore \u2014 ratings, downloads and screenshots for every listing.`
          : `Browse all ${apps.length} apps on Open Appstore \u2014 filter by category, price and rating.`,
      active: "apps",
      // Search-result URLs are infinite in number and near-duplicates of the
      // plain listing; indexing them burns crawl budget that should go to app
      // pages. Category pages ARE indexable (they are in sitemap.xml).
      noindex: Boolean(search),
      jsonLd: [
        breadcrumbLd(new URL(c.req.url).origin, [
          { name: "Home", path: "/" },
          { name: "Browse apps", path: "/apps" },
          ...(category !== "All"
            ? [{ name: category, path: `/apps?category=${encodeURIComponent(category)}` }]
            : [])
        ]),
        itemListLd(
          new URL(c.req.url).origin,
          category !== "All" ? `${category} apps` : "All apps on Open Appstore",
          apps,
          30
        )
      ],
      body: browsePage({ apps, categories, search, category, sort, price }),
      bootstrap: { page: "browse", search, category, sort, price }
    })
  );
});
app.get("/categories", async (c) => {
  const categories = await fetchCategories(c.env);
  return c.html(
    layout({
      title: "Categories",
      description: `Browse apps by category on Open Appstore \u2014 ${categories.filter((x) => x.count > 0).length} live categories across games, productivity, tools and more.`,
      active: "categories",
      jsonLd: [
        collectionLd(
          new URL(c.req.url).origin,
          "/categories",
          "App categories",
          "Every app category available on Open Appstore."
        ),
        breadcrumbLd(new URL(c.req.url).origin, [
          { name: "Home", path: "/" },
          { name: "Categories", path: "/categories" }
        ])
      ],
      body: categoriesPage(categories),
      bootstrap: { page: "categories" }
    })
  );
});
app.get("/top-charts", async (c) => {
  const base = `select=${APP_SELECT_WITH_DEV}&status=eq.published`;
  const [popular, topRated, newest, free] = await Promise.all([
    fetchApps(c.env, `${base}&order=${ORDER.popular}&limit=50`),
    fetchApps(c.env, `${base}&rating=gt.0&order=${ORDER.rating}&limit=50`),
    fetchApps(c.env, `${base}&order=${ORDER.newest}&limit=50`),
    fetchApps(c.env, `${base}&is_free=is.true&order=${ORDER.popular}&limit=50`)
  ]);
  return c.html(
    layout({
      title: "Top charts",
      description: "Most downloaded, top rated and newest apps on Open Appstore \u2014 updated continuously from real download and review counts.",
      active: "charts",
      jsonLd: [
        breadcrumbLd(new URL(c.req.url).origin, [
          { name: "Home", path: "/" },
          { name: "Top charts", path: "/top-charts" }
        ]),
        itemListLd(new URL(c.req.url).origin, "Most downloaded apps", popular, 25)
      ],
      body: chartsPage({ popular, topRated, newest, free }),
      bootstrap: { page: "charts" }
    })
  );
});
app.get("/app/:slug", async (c) => {
  const slug = c.req.param("slug");
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
  const q = new URLSearchParams({ select: APP_SELECT_WITH_DEV, limit: "1" });
  if (isUuid) q.set("id", `eq.${slug}`);
  else q.set("app_slug", `eq.${slug}`);
  const { data } = await sbSelect(c.env, "apps", q.toString());
  const row = (data || [])[0];
  if (!row)
    return notFound(c, {
      title: "App not found",
      heading: "No app found",
      message: `We couldn't find an app at "${slug}". It may have been unpublished, renamed, or the link is wrong.`
    });
  const app_ = toAppView(row);
  const [devRes, moreRes, similarRes, reviewsRes, versionsRes, allRatingsRes] = await Promise.all([
    app_.developer_id ? sbSelect(
      c.env,
      "developers",
      `select=${DEV_SELECT}&id=eq.${app_.developer_id}&limit=1`
    ) : Promise.resolve({ data: [] }),
    app_.developer_id ? sbSelect(
      c.env,
      "apps",
      `select=${APP_SELECT_WITH_DEV}&developer_id=eq.${app_.developer_id}&status=eq.published&id=neq.${app_.id}&limit=6`
    ) : Promise.resolve({ data: [] }),
    sbSelect(
      c.env,
      "apps",
      `select=${APP_SELECT_WITH_DEV}&category=eq.${encodeURIComponent(app_.category)}&status=eq.published&id=neq.${app_.id}&order=${ORDER.popular}&limit=6`
    ),
    sbSelect(
      c.env,
      "app_reviews",
      `select=${REVIEW_SELECT}&app_id=eq.${app_.id}&order=created_at.desc&limit=20`
    ),
    sbSelect(
      c.env,
      "app_versions",
      `select=id,version_number,release_notes,download_url,file_size,release_date,created_at&app_id=eq.${app_.id}&order=release_date.desc.nullslast&limit=20`
    ),
    // Every rating, not just the 20 reviews we render. PostgREST refuses
    // aggregate functions on this project (PGRST123), so we pull the single
    // `rating` column — a few bytes per row — and tally it here. Capped so a
    // runaway-popular app can never blow the response up.
    sbSelect(c.env, "app_reviews", `select=rating&app_id=eq.${app_.id}&limit=5000`)
  ]);
  const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of allRatingsRes.data || []) {
    const n = Math.round(Number(r.rating) || 0);
    if (n >= 1 && n <= 5) ratingCounts[n] += 1;
  }
  // A listing changes rarely but is hit often. 60s at the edge with a 5-minute
  // stale window keeps repeat views near-instant while a publish still lands
  // quickly. Deliberately NOT longer: developers expect their edit to show up.
  c.header("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
  // Size is measured from the actual file rather than trusting the listing —
  // the recorded values are frequently absent and sometimes plain wrong.
  const primaryDownload = app_.download_url || app_.drive_url || null;
  const sizeInfo = await resolveAppSize(c.env, {
    versions: versionsRes.data || [],
    downloadUrl: primaryDownload
  });
  const downloadKind = classifyDownload(primaryDownload);
  return c.html(
    layout({
      title: app_.name,
      // A description that names the developer, category and version gives the
      // snippet real substance instead of repeating the title.
      description: app_.short_description
        ? `${app_.short_description}`
        : `Download ${app_.name}${(devRes.data || [])[0]?.name ? ` by ${(devRes.data || [])[0].name}` : ""} \u2014 ${app_.category} app, version ${app_.version}, on Open Appstore.`,
      ogImage: app_.icon_url || void 0,
      // og:type product is what unlocks the richer preview card on social
      // platforms for something that has a price and availability.
      ogType: "product",
      active: "apps",
      jsonLd: [
        appLd(new URL(c.req.url).origin, app_, (devRes.data || [])[0] || null),
        breadcrumbLd(new URL(c.req.url).origin, [
          { name: "Home", path: "/" },
          { name: "Browse apps", path: "/apps" },
          { name: app_.category, path: `/apps?category=${encodeURIComponent(app_.category)}` },
          { name: app_.name, path: `/app/${app_.slug || app_.id}` }
        ])
      ],
      body: appDetailPage({
        origin: new URL(c.req.url).origin,
        packageName: PACKAGE_NAME,
        app: app_,
        developer: (devRes.data || [])[0] || null,
        more: (moreRes.data || []).map(toAppView),
        similar: (similarRes.data || []).map(toAppView),
        reviews: reviewsRes.data || [],
        versions: versionsRes.data || [],
        ratingCounts,
        sizeInfo,
        downloadKind
      }),
      bootstrap: { page: "app", appId: app_.id, slug: app_.slug }
    })
  );
});
app.get("/developers", async (c) => {
  const { data } = await sbSelect(
    c.env,
    "developers",
    `select=${DEV_SELECT}&order=created_at.desc&limit=100`
  );
  const { data: apps } = await sbSelect(
    c.env,
    "apps",
    "select=developer_id,total_downloads&status=eq.published&limit=1000"
  );
  const agg = {};
  (apps || []).forEach((a) => {
    const k = a.developer_id || "";
    if (!agg[k]) agg[k] = { apps: 0, downloads: 0 };
    agg[k].apps += 1;
    agg[k].downloads += Number(a.total_downloads || 0);
  });
  const devs = (data || []).map((d) => ({
    ...d,
    apps_count: agg[d.id]?.apps || 0,
    total_downloads: agg[d.id]?.downloads || 0
  }));
  return c.html(
    layout({
      title: "Developers",
      description: `Studios and independent developers publishing on Open Appstore \u2014 ${devs.length} profiles with their published apps and download totals.`,
      active: "developers",
      jsonLd: [
        collectionLd(
          new URL(c.req.url).origin,
          "/developers",
          "Developers on Open Appstore",
          "Studios and independent developers publishing on Open Appstore."
        ),
        breadcrumbLd(new URL(c.req.url).origin, [
          { name: "Home", path: "/" },
          { name: "Developers", path: "/developers" }
        ])
      ],
      body: developersPage(devs),
      bootstrap: { page: "developers" }
    })
  );
});
app.get("/developer-profile/:id", async (c) => {
  const id = c.req.param("id");
  const { data } = await sbSelect(
    c.env,
    "developers",
    `select=${DEV_SELECT}&id=eq.${id}&limit=1`
  );
  const developer = (data || [])[0];
  if (!developer)
    return notFound(c, {
      title: "Developer not found",
      heading: "No developer found",
      message: "That developer profile doesn't exist or is no longer listed."
    });
  const apps = await fetchApps(
    c.env,
    `select=${APP_SELECT_WITH_DEV}&developer_id=eq.${id}&status=eq.published&order=${ORDER.popular}&limit=100`
  );
  return c.html(
    layout({
      title: developer.developer_name,
      description: developer.description || `Apps by ${developer.developer_name} on Open Appstore \u2014 ${apps.length} published ${apps.length === 1 ? "app" : "apps"}.`,
      // `avatar_url` is the real column on `developers` (verified against
      // DEV_SELECT in lib/types.js) -- there is no logo_url.
      ogImage: developer.avatar_url || void 0,
      ogType: "profile",
      active: "developers",
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: developer.developer_name,
          url: `${new URL(c.req.url).origin}/developer-profile/${developer.id}`,
          ...(developer.description ? { description: developer.description } : {}),
          ...(developer.avatar_url ? { logo: developer.avatar_url } : {}),
          ...(developer.website ? { sameAs: [developer.website] } : {})
        },
        itemListLd(new URL(c.req.url).origin, `Apps by ${developer.developer_name}`, apps, 30),
        breadcrumbLd(new URL(c.req.url).origin, [
          { name: "Home", path: "/" },
          { name: "Developers", path: "/developers" },
          { name: developer.developer_name, path: `/developer-profile/${developer.id}` }
        ])
      ],
      body: developerProfilePage({ developer, apps }),
      bootstrap: { page: "developer-profile", developerId: id }
    })
  );
});
app.get(
  "/developer",
  (c) => c.html(
    layout({
      title: "Developer dashboard",
      description: "Publish and manage your apps on Open Appstore.",
      mode: "developer",
      active: "dash",
      body: devDashboardPage(),
      bootstrap: { page: "dev-dashboard" }
    })
  )
);
app.get(
  "/developer/apps",
  (c) => c.html(
    layout({
      title: "My apps",
      mode: "developer",
      active: "myapps",
      body: devAppsPage(),
      bootstrap: { page: "dev-apps" }
    })
  )
);
app.get(
  "/developer/submit",
  (c) => c.html(
    layout({
      title: "Submit an app",
      mode: "developer",
      active: "submit",
      body: devSubmitPage(),
      bootstrap: { page: "dev-submit" }
    })
  )
);
app.get(
  "/developer/profile",
  (c) => c.html(
    layout({
      title: "Developer profile",
      mode: "developer",
      active: "profile",
      body: devProfilePage(),
      bootstrap: { page: "dev-profile" }
    })
  )
);
app.get("/developer/docs", (c) => {
  const url = new URL(c.req.url);
  return c.html(
    layout({
      title: "API documentation",
      mode: "developer",
      active: "docs",
      body: devDocsPage(url.origin),
      bootstrap: { page: "dev-docs" }
    })
  );
});
app.get(
  "/developer/api-keys",
  (c) => c.html(
    layout({
      title: "API keys",
      mode: "developer",
      active: "apikeys",
      body: devApiKeysPage(),
      bootstrap: { page: "dev-api-keys" }
    })
  )
);
app.get(
  "/developer/security",
  (c) => c.html(
    layout({
      title: "Security",
      mode: "developer",
      active: "security",
      body: devSecurityPage(),
      bootstrap: { page: "dev-security" }
    })
  )
);
app.get(
  "/auth/callback",
  (c) => c.html(
    layout({
      title: "Signing you in",
      body: authCallbackPage(),
      bodyClass: "body-auth",
      bootstrap: {
        page: "auth-callback",
        next: c.req.query("next") || "/developer",
        provider: c.req.query("provider") || ""
      }
    })
  )
);
/*
 * Auth page routes.
 *
 * The canonical paths are /auth/*. The /developer/* and alternate spellings are
 * aliases serving the SAME page, because they were linked from elsewhere (and
 * requested by name) but previously 404'd. Publishing one account system under
 * several URLs is deliberate: this store has a single identity per person, and
 * "developer" is a role that account gains after registering a studio profile,
 * not a separate credential store. Two parallel login systems would mean two
 * password resets and two 2FA enrolments for the same human.
 *
 * All of these are noindex via NOINDEX_PREFIXES ("/auth", "/developer"), so the
 * duplicate URLs cannot create a duplicate-content problem in Search Console.
 */
for (const [path, mode] of [
  ["/auth/login", "login"],
  ["/auth/signup", "signup"],
  ["/auth/reset", "reset"],
  // Aliases — same pages, alternate URLs.
  ["/auth/signin", "login"],
  ["/auth/register", "signup"],
  ["/auth/forgot-password", "reset"],
  ["/developer/signin", "login"],
  ["/developer/login", "login"],
  ["/developer/register", "signup"],
  ["/developer/signup", "signup"],
  ["/developer/forgot-password", "reset"]
]) {
  app.get(path, async (c) => {
    // Awaited so the social buttons are in the first-paint HTML rather than
    // popping in later. enabledProviders() is cached per isolate, so this is a
    // network round-trip only on a cold isolate.
    const providers = await enabledProviders(c.env);
    return c.html(
      layout({
        title: mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : "Reset password",
        body: authPage(mode, providers),
        bodyClass: "body-auth",
        bootstrap: { page: `auth-${mode}`, next: c.req.query("next") || "", providers }
      })
    );
  });
}
/**
 * /about — company and contact page.
 *
 * Uses the same prose shell as the legal pages so the typography and print
 * behaviour stay consistent. The contact address is the real support inbox
 * (appstore@openflip.in) and is also emitted as structured data via
 * organizationLd, so search engines can attach it to the Organization entity
 * rather than treating it as loose page text.
 */
app.get(
  "/about",
  (c) => {
    const origin = new URL(c.req.url).origin;
    return c.html(
      layout({
        title: "About",
        description:
          "About Open Appstore \u2014 an independent app store where developers publish directly to users. Learn who runs it, how it works, and how to get in touch.",
        jsonLd: [
          webPageLd(origin, "/about", "About Open Appstore", "Who runs Open Appstore, how it works, and how to contact us."),
          organizationLd(origin),
          breadcrumbLd(origin, [
            { name: "Home", path: "/" },
            { name: "About", path: "/about" }
          ])
        ],
        body: legalPage("About Open Appstore", [
          {
            h: "What Open Appstore is",
            p: [
              "Open Appstore is an independent app store. Developers publish their apps directly to the catalogue, and visitors can browse, search and download without an account.",
              "Every listing is submitted by the developer who owns it. We do not repackage, re-sign or mirror apps from anywhere else \u2014 what you download is the file the developer uploaded."
            ]
          },
          {
            h: "Who runs it",
            p: [
              "Open Appstore is operated by Open Media Intelligence. The store, the developer console and the review system are built and maintained by the same small team.",
              "The catalogue is deliberately curated rather than automated: listings are checked against our developer guidelines before they go live."
            ]
          },
          {
            h: "Sarath, our AI app guide",
            p: [
              "Sarath is the AI assistant built into the store. It answers questions in plain language \u2014 \u201cI need a photo editor\u201d, \u201ccompare these two apps\u201d \u2014 and recommends listings from the live catalogue.",
              "Sarath only ever answers from apps that are actually published here. It is not a general-purpose chatbot, and it cannot recommend apps that do not exist in the catalogue."
            ]
          },
          {
            h: "Publishing your app",
            p: [
              "Anyone can register as a developer and publish. Create an account, complete your studio profile, then submit a listing with your app details, icon and download link.",
              "Releases are versioned, so you can ship updates and keep a visible changelog for your users."
            ]
          },
          {
            h: "Contact us",
            p: [
              "For support, listing questions, takedown requests or press enquiries, email appstore@openflip.in and we will get back to you.",
              "For privacy or data requests specifically, see our Privacy Policy \u2014 it explains what we store and how to have it removed."
            ]
          }
        ])
      })
    );
  }
);
app.get(
  "/legal/privacy",
  (c) => c.html(
    layout({
      title: "Privacy Policy",
      description: "How Open Appstore collects, uses and stores your data \u2014 account details, app listing metadata, and the processors involved.",
      jsonLd: webPageLd(
        new URL(c.req.url).origin,
        "/legal/privacy",
        "Privacy Policy",
        "How Open Appstore collects, uses and stores your data."
      ),
      body: legalPage("Privacy Policy", [
        {
          h: "What we collect",
          p: [
            "When you create an account we store your email address and, if you register as a developer, the studio details you provide (name, company, website, contact email, logo URL).",
            "For published apps we store the listing metadata you submit, together with aggregate download counts and user ratings."
          ]
        },
        {
          h: "How we use it",
          p: [
            "Account data is used solely to authenticate you and to attribute app listings to the correct developer.",
            "Aggregate download and rating counts are shown publicly on listings and charts. Individual reviews are shown with their rating and text."
          ]
        },
        {
          h: "Storage & processors",
          p: [
            "Authentication and application data are stored in Supabase (PostgreSQL). Page delivery runs on Cloudflare\u2019s edge network.",
            "We do not sell personal data and we do not run third-party advertising trackers on this site."
          ]
        },
        {
          h: "Your rights",
          p: [
            "You can update or delete your developer profile and app listings at any time from the developer console.",
            "To request full account deletion, contact the store operator from the email address associated with your account."
          ]
        }
      ])
    })
  )
);
app.get(
  "/legal/terms",
  (c) => c.html(
    layout({
      title: "Terms of Service",
      description: "The terms covering use of Open Appstore \u2014 browsing, publishing apps, downloads and account responsibilities.",
      jsonLd: webPageLd(
        new URL(c.req.url).origin,
        "/legal/terms",
        "Terms of Service",
        "The terms covering use of Open Appstore."
      ),
      body: legalPage("Terms of Service", [
        {
          h: "Using the store",
          p: [
            "Browsing the catalogue is open to everyone. Creating an account is required to publish apps or post reviews.",
            "You are responsible for keeping your account credentials secure."
          ]
        },
        {
          h: "Publishing apps",
          p: [
            "You must own or have the right to distribute anything you publish, including icons, screenshots and binaries.",
            "Listings must accurately describe the app. Malware, misleading listings and infringing content are removed without notice."
          ]
        },
        {
          h: "Downloads",
          p: [
            "Download links point to resources hosted by the developer. Verify anything you install; the store does not scan third-party binaries.",
            "Paid listings display the developer\u2019s stated price; payment handling is arranged by the developer."
          ]
        },
        {
          h: "Liability",
          p: [
            'The store is provided on an "as is" basis without warranties of any kind.',
            "Developers remain solely responsible for their apps and any support obligations attached to them."
          ]
        }
      ])
    })
  )
);
app.get(
  "/legal/guidelines",
  (c) => c.html(
    layout({
      title: "Developer Guidelines",
      description: "Listing quality rules for publishing on Open Appstore \u2014 icons, screenshots, descriptions, versioning and what gets rejected.",
      jsonLd: webPageLd(
        new URL(c.req.url).origin,
        "/legal/guidelines",
        "Developer Guidelines",
        "Listing quality rules for publishing on Open Appstore."
      ),
      body: legalPage("Developer Guidelines", [
        {
          h: "Listing quality",
          p: [
            "Use a square icon of at least 512\xD7512 pixels. Avoid text-heavy icons \u2014 they become unreadable at small sizes.",
            "Write a description that opens with the single clearest benefit, then list features as bullet points. Markdown headings and lists are rendered on your listing page."
          ]
        },
        {
          h: "Versioning",
          p: [
            "Use semantic versioning (MAJOR.MINOR.PATCH). Bump the version whenever you replace the download artefact.",
            "Keep the download URL stable and always pointing to the current release."
          ]
        },
        {
          h: "Categories",
          p: [
            "Choose the single category that best fits your app\u2019s primary purpose. Listings placed in unrelated categories may be reclassified."
          ]
        },
        {
          h: "Prohibited content",
          p: [
            "No malware, spyware, cryptominers or apps that collect data without disclosure.",
            "No content that infringes copyright or trademarks, and no impersonation of other developers or brands."
          ]
        }
      ])
    })
  )
);
function notFound(c, opts = {}) {
  const heading = opts.heading || "We couldn't find that page";
  const message = opts.message || "The app or page you're looking for may have been unpublished or moved.";
  return c.html(
    layout({
      title: opts.title || "Not found",
      // A 404 body must never be indexed. The 404 status alone usually keeps it
      // out, but an unpublished app URL that still has inbound links is exactly
      // the case where the explicit directive matters.
      noindex: true,
      body: raw(`
<section class="error-page error-page-art">
  ${notFoundArt("notfound-art notfound-art-lg")}
  <span class="error-code">404</span>
  <h1>${esc(heading)}</h1>
  <p>${esc(message)}</p>
  <div class="gate-actions">
    <a class="btn btn-primary" href="/"><i class="fa-solid fa-house"></i> Back to store</a>
    <a class="btn btn-outline" href="/apps"><i class="fa-solid fa-grip"></i> Browse apps</a>
  </div>
</section>`)
    }),
    404
  );
}
app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ success: false, error: "Endpoint not found" }, 404);
  return notFound(c);
});
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  if (c.req.path.startsWith("/api/"))
    return c.json({ success: false, error: err.message || "Internal error" }, 500);
  return c.html(
    layout({
      title: "Something went wrong",
      body: raw(`
<section class="error-page">
  <span class="error-code">500</span>
  <h1>Something went wrong</h1>
  <p>${esc(err.message || "Unexpected error")}</p>
  <a class="btn btn-primary" href="/"><i class="fa-solid fa-house"></i> Back to store</a>
</section>`)
    }),
    500
  );
});
var index_default = app;
export {
  index_default as default
};
