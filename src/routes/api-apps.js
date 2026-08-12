import { Hono } from "hono";
import {
  sbSelect,
  sbWrite,
  sbAdminWrite,
  sbAuth,
  hasServiceRole,
  bearer
} from "../lib/supabase.js";
import {
  APP_SELECT_WITH_DEV,
  DEV_SELECT,
  REVIEW_SELECT,
  ORDER,
  CATEGORIES,
  toAppView
} from "../lib/types.js";
import { normalizeDownloadUrl, linkHost, isDriveUrl } from "../lib/media.js";
import QRCode from "qrcode";
import { fail } from "../lib/apierror.js";
const api = new Hono();

/**
 * Resolve a slug *or* uuid to the app row.
 *
 * The public URL carries a slug; internal references carry a uuid; and some
 * rows have a separate legacy `app_id` string. Every endpoint that takes an
 * app identifier goes through here so all three keep working everywhere,
 * rather than only on the one route that happened to implement it.
 */
async function findApp(env, key, select = APP_SELECT_WITH_DEV) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
  const params = new URLSearchParams({ select, limit: "1" });
  if (isUuid) params.set("or", `(id.eq.${key},app_id.eq.${key})`);
  else params.set("app_slug", `eq.${key}`);
  const { data, error } = await sbSelect(env, "apps", params.toString());
  if (error) return { row: null, error };
  return { row: (data || [])[0] || null, error: null };
}

/** Ordering clauses for the review list, keyed by the spec's `sort` values. */
const REVIEW_ORDER = {
  newest: "created_at.desc",
  oldest: "created_at.asc",
  highest: "rating.desc,created_at.desc",
  lowest: "rating.asc,created_at.desc",
  helpful: "helpful_count.desc.nullslast,created_at.desc"
};

/**
 * Fetch one page of reviews plus the total, so the client can render
 * "showing 20 of 143" and decide whether to offer a "load more" button.
 *
 * The total comes from a `count=exact` header rather than a second query:
 * PostgREST aggregate functions are disabled on this project (`select=count()`
 * returns PGRST123), so the Content-Range count is the only way to get it in
 * one round trip.
 */
async function reviewPage(env, appId, { limit, offset, sort, rating }) {
  const params = new URLSearchParams({
    select: REVIEW_SELECT,
    app_id: `eq.${appId}`,
    order: REVIEW_ORDER[sort] || REVIEW_ORDER.newest,
    limit: String(limit),
    offset: String(offset)
  });
  if (rating) params.set("rating", `eq.${rating}`);
  const { data, error, count } = await sbSelect(env, "app_reviews", params.toString(), void 0, {
    count: true
  });
  const reviews = data || [];
  const total = Number.isFinite(count) ? count : reviews.length + offset;
  return {
    error,
    reviews,
    pagination: {
      total,
      limit,
      offset,
      // Computed from the total rather than from `reviews.length === limit`,
      // which reports a phantom extra page when the last page is exactly full.
      has_more: offset + reviews.length < total
    }
  };
}

/** Parse and clamp the review list query string. */
function reviewQuery(c) {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "20", 10) || 20, 1), 100);
  const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);
  const sort = String(c.req.query("sort") || "newest").toLowerCase();
  const ratingRaw = parseInt(c.req.query("rating") || "0", 10) || 0;
  return {
    limit,
    offset,
    sort: REVIEW_ORDER[sort] ? sort : "newest",
    rating: ratingRaw >= 1 && ratingRaw <= 5 ? ratingRaw : 0
  };
}

/**
 * Tally the 1-5 star distribution.
 *
 * Done in JS over the bare rating column because PostgREST aggregates are
 * disabled here. Capped at 1000 rows: beyond that the shape of the histogram
 * is already settled, and pulling more would cost more than the bar chart is
 * worth.
 */
function ratingBreakdown(rows) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let n = 0;
  for (const r of rows || []) {
    const v = Number(r.rating || 0);
    if (v >= 1 && v <= 5) {
      counts[v] += 1;
      sum += v;
      n += 1;
    }
  }
  return {
    counts,
    total: n,
    average: n ? Math.round((sum / n) * 10) / 10 : 0
  };
}

/** Columns we read out of app_versions. */
const VERSION_SELECT = "id,app_id,version_number,release_notes,download_url,file_size,release_date,created_at";

/** Shape one app_versions row for the client, rewriting share links. */
function toVersionView(row) {
  return {
    id: row.id,
    version: row.version_number,
    release_notes: row.release_notes || "",
    download_url: normalizeDownloadUrl(row.download_url),
    download_host: linkHost(row.download_url),
    is_drive: isDriveUrl(row.download_url),
    file_size: row.file_size ? Number(row.file_size) : null,
    released_at: row.release_date || row.created_at || null
  };
}
api.get("/apps", async (c) => {
  const env = c.env;
  const limit = Math.min(parseInt(c.req.query("limit") || "60", 10) || 60, 100);
  const offset = parseInt(c.req.query("offset") || "0", 10) || 0;
  const category = c.req.query("category");
  const search = (c.req.query("search") || "").trim();
  const sort = c.req.query("sort") || "popular";
  const featured = c.req.query("featured");
  const params = new URLSearchParams();
  params.set("select", APP_SELECT_WITH_DEV);
  params.set("status", "eq.published");
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (category && category !== "All") params.set("category", `eq.${category}`);
  if (search) {
    const safe = search.replace(/[,()*]/g, " ");
    params.set("or", `(app_name.ilike.*${safe}*,description.ilike.*${safe}*,category.ilike.*${safe}*)`);
  }
  const order = sort === "newest" ? ORDER.newest : sort === "rated" ? ORDER.rating : sort === "name" ? ORDER.name : ORDER.popular;
  params.set("order", order);
  const { data, error, status, count } = await sbSelect(env, "apps", params.toString(), void 0, { count: true });
  if (error) return c.json({ success: false, error, apps: [] }, status || 500);
  let apps = (data || []).map(toAppView);
  if (featured === "true") apps = apps.filter((a) => a.is_featured);
  const total = count === null || count === void 0 ? apps.length : count;
  return c.json({
    success: true,
    apps,
    total,
    count: apps.length,
    limit,
    offset,
    has_more: offset + apps.length < total
  });
});
api.get("/apps/stats", async (c) => {
  const params = new URLSearchParams({
    select: "category,total_downloads,total_reviews,rating,is_free",
    status: "eq.published",
    limit: "1000"
  });
  const { data, error } = await sbSelect(c.env, "apps", params.toString());
  if (error) return c.json({ success: false, error }, 500);
  const rows = data || [];
  const downloads = rows.reduce((s, r) => s + Number(r.total_downloads || 0), 0);
  const rated = rows.filter((r) => Number(r.rating || 0) > 0);
  const avg = rated.length ? rated.reduce((s, r) => s + Number(r.rating || 0), 0) / rated.length : 0;
  const byCategory = {};
  rows.forEach((r) => {
    const k = r.category || "Other";
    byCategory[k] = (byCategory[k] || 0) + 1;
  });
  const { data: devs } = await sbSelect(c.env, "developers", "select=id&limit=1000");
  return c.json({
    success: true,
    stats: {
      total_apps: rows.length,
      total_downloads: downloads,
      avg_rating: Number(avg.toFixed(2)),
      free_apps: rows.filter((r) => r.is_free !== false).length,
      developers: (devs || []).length,
      categories: byCategory
    }
  });
});
api.get("/apps/:key", async (c) => {
  const key = c.req.param("key");
  const { row, error } = await findApp(c.env, key);
  if (error) return fail(c, 500, "Could not load the app.");
  if (!row) return fail(c, 404, "App not found.");
  const app = toAppView(row);

  // ?fields=basic — the header block only. Used by the Android client's list
  // prefetch and by link-preview generation, which do not need reviews,
  // versions or three separate recommendation lists. Skipping those saves six
  // round trips per request.
  if (String(c.req.query("fields") || "").toLowerCase() === "basic") {
    c.header("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
    return c.json({ success: true, app, fields: "basic" });
  }

  const reviewQ = reviewQuery(c);
  const [devRes, siblingRes, reviewRes] = await Promise.all([
    app.developer_id ? sbSelect(
      c.env,
      "developers",
      `select=${DEV_SELECT}&id=eq.${app.developer_id}&limit=1`
    ) : Promise.resolve({ data: [], error: null, status: 200 }),
    app.developer_id ? sbSelect(
      c.env,
      "apps",
      `select=${APP_SELECT_WITH_DEV}&developer_id=eq.${app.developer_id}&status=eq.published&id=neq.${app.id}&limit=8`
    ) : Promise.resolve({ data: [], error: null, status: 200 }),
    reviewPage(c.env, app.id, reviewQ)
  ]);
  const [{ data: similar }, versionRes, allRatings] = await Promise.all([
    sbSelect(
      c.env,
      "apps",
      `select=${APP_SELECT_WITH_DEV}&category=eq.${encodeURIComponent(app.category)}&status=eq.published&id=neq.${app.id}&order=${ORDER.popular}&limit=8`
    ),
    sbSelect(
      c.env,
      "app_versions",
      `select=${VERSION_SELECT}&app_id=eq.${app.id}&order=release_date.desc.nullslast&limit=20`
    ),
    sbSelect(c.env, "app_reviews", `select=rating&app_id=eq.${app.id}&limit=1000`)
  ]);
  return c.json({
    success: true,
    app,
    developer: (devRes.data || [])[0] || null,
    more_from_developer: (siblingRes.data || []).map(toAppView),
    similar: (similar || []).map(toAppView),
    reviews: reviewRes.reviews,
    reviews_pagination: reviewRes.pagination,
    rating_breakdown: ratingBreakdown(allRatings.data),
    versions: (versionRes.data || []).map(toVersionView)
  });
});

/** GET /api/apps/:id/versions — public release history for one app. */
api.get("/apps/:id/versions", async (c) => {
  const key = c.req.param("id");
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50", 10) || 50, 1), 100);
  const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);
  const { row, error: findErr } = await findApp(c.env, key, "id,current_version,latest_version");
  if (findErr) return fail(c, 500, "Could not load the release history.");
  if (!row) return fail(c, 404, "App not found.");
  const { data, error, count } = await sbSelect(
    c.env,
    "app_versions",
    `select=${VERSION_SELECT}&app_id=eq.${row.id}&order=release_date.desc.nullslast&limit=${limit}&offset=${offset}`,
    void 0,
    { count: true }
  );
  if (error) return fail(c, 500, "Could not load the release history.");
  const versions = (data || []).map(toVersionView);
  const total = Number.isFinite(count) ? count : versions.length + offset;
  c.header("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=600");
  return c.json({
    success: true,
    versions,
    current_version: row.latest_version || row.current_version || null,
    pagination: { total, limit, offset, has_more: offset + versions.length < total }
  });
});
api.get("/categories", async (c) => {
  const { data } = await sbSelect(
    c.env,
    "apps",
    "select=category&status=eq.published&limit=1000"
  );
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
  return c.json({ success: true, categories: list });
});
api.get("/developers", async (c) => {
  const { data, error } = await sbSelect(
    c.env,
    "developers",
    `select=${DEV_SELECT}&order=created_at.desc&limit=100`
  );
  if (error) return c.json({ success: false, error }, 500);
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
  const developers = (data || []).map((d) => ({
    ...d,
    apps_count: agg[d.id]?.apps || 0,
    total_downloads: agg[d.id]?.downloads || 0
  }));
  return c.json({ success: true, developers });
});
api.get("/developers/:id", async (c) => {
  const id = c.req.param("id");
  const { data, error } = await sbSelect(
    c.env,
    "developers",
    `select=${DEV_SELECT}&id=eq.${id}&limit=1`
  );
  if (error) return c.json({ success: false, error }, 500);
  const dev = (data || [])[0];
  if (!dev) return c.json({ success: false, error: "Developer not found" }, 404);
  const { data: apps } = await sbSelect(
    c.env,
    "apps",
    `select=${APP_SELECT_WITH_DEV}&developer_id=eq.${id}&status=eq.published&order=${ORDER.popular}&limit=100`
  );
  return c.json({ success: true, developer: dev, apps: (apps || []).map(toAppView) });
});
api.post("/apps/:id/download", async (c) => {
  const key = c.req.param("id");
  const { row, error: findErr } = await findApp(
    c.env,
    key,
    "id,total_downloads,download_url,website,file_size"
  );
  if (findErr) return fail(c, 500, "Could not start the download.");
  if (!row) return fail(c, 404, "App not found.");
  const id = row.id;
  const token = bearer(c.req.header("Authorization"));
  const next = Number(row.total_downloads || 0) + 1;
  const inc = hasServiceRole(c.env) ? await sbAdminWrite(c.env, "apps", "PATCH", { total_downloads: next }, `id=eq.${id}`) : await sbWrite(c.env, "apps", "PATCH", { total_downloads: next }, `id=eq.${id}`, token);
  logDownload(c, id, token).catch(() => {
  });
  return c.json({
    success: true,
    url: normalizeDownloadUrl(row.download_url) || row.website || null,
    total_downloads: inc.error ? void 0 : next,
    counted: !inc.error
  });
});

/**
 * Append an analytics row for this download. Entirely best-effort: the counter
 * on the app row is the source of truth, so a missing app_downloads table (or a
 * policy that forbids the insert) must never break the user's download.
 */
async function logDownload(c, appId, token) {
  const payload = {
    app_id: appId,
    device_info: (c.req.header("User-Agent") || "").slice(0, 500),
    downloaded_at: new Date().toISOString()
  };
  if (token) {
    const { data: user } = await sbAuth(c.env, "user", { token });
    if (user?.id) payload.user_id = user.id;
  }
  if (hasServiceRole(c.env)) await sbAdminWrite(c.env, "app_downloads", "POST", payload);
  else await sbWrite(c.env, "app_downloads", "POST", payload, "", token);
}
/**
 * GET /api/apps/:id/reviews
 *
 * Supports ?limit &offset &sort=newest|oldest|highest|lowest|helpful &rating=1..5.
 * Accepts a slug as well as an id so the detail page can page through reviews
 * using the same identifier that is already in the address bar.
 */
api.get("/apps/:id/reviews", async (c) => {
  const key = c.req.param("id");
  const q = reviewQuery(c);
  const { row, error: findErr } = await findApp(c.env, key, "id");
  if (findErr) return fail(c, 500, "Could not load reviews.");
  if (!row) return fail(c, 404, "App not found.");

  const [page, all] = await Promise.all([
    reviewPage(c.env, row.id, q),
    // The breakdown describes the whole app, so it must ignore the ?rating
    // filter — otherwise filtering to 5 stars would claim every review is 5.
    sbSelect(c.env, "app_reviews", `select=rating&app_id=eq.${row.id}&limit=1000`)
  ]);
  if (page.error) return fail(c, 500, "Could not load reviews.");

  return c.json({
    success: true,
    reviews: page.reviews,
    pagination: page.pagination,
    // Flattened duplicates of pagination for the shape the spec documents.
    total: page.pagination.total,
    has_more: page.pagination.has_more,
    rating_breakdown: ratingBreakdown(all.data),
    applied: { sort: q.sort, rating: q.rating || null }
  });
});

/**
 * GET /api/apps/:id/related
 *
 * Curated relations first (app_related_apps, highest score first), then filled
 * out with same-category apps. Curation is respected where an operator has
 * bothered to record it, and the endpoint still returns something useful where
 * they have not — that table is currently empty.
 */
api.get("/apps/:id/related", async (c) => {
  const key = c.req.param("id");
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "8", 10) || 8, 1), 24);
  const { row, error: findErr } = await findApp(c.env, key, "id,category,developer_id");
  if (findErr) return fail(c, 500, "Could not load related apps.");
  if (!row) return fail(c, 404, "App not found.");

  const out = [];
  const seen = new Set([row.id]);
  const push = (list, source) => {
    for (const a of list || []) {
      if (out.length >= limit) return;
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({ ...toAppView(a), relation_source: source });
    }
  };

  const { data: curated } = await sbSelect(
    c.env,
    "app_related_apps",
    `select=related_app_id,relation_type,score&app_id=eq.${row.id}&order=score.desc.nullslast&limit=${limit}`
  );
  const curatedIds = (curated || []).map((r) => r.related_app_id).filter(Boolean);
  if (curatedIds.length) {
    const { data: rows } = await sbSelect(
      c.env,
      "apps",
      `select=${APP_SELECT_WITH_DEV}&id=in.(${curatedIds.join(",")})&status=eq.published`
    );
    // Restore the curated ordering, which `in.()` does not preserve.
    const byId = new Map((rows || []).map((r) => [r.id, r]));
    push(curatedIds.map((id) => byId.get(id)).filter(Boolean), "curated");
  }

  if (out.length < limit && row.category) {
    const { data: sameCat } = await sbSelect(
      c.env,
      "apps",
      `select=${APP_SELECT_WITH_DEV}&category=eq.${encodeURIComponent(row.category)}&status=eq.published&id=neq.${row.id}&order=${ORDER.popular}&limit=${limit}`
    );
    push(sameCat, "same_category");
  }

  if (out.length < limit && row.developer_id) {
    const { data: sameDev } = await sbSelect(
      c.env,
      "apps",
      `select=${APP_SELECT_WITH_DEV}&developer_id=eq.${row.developer_id}&status=eq.published&id=neq.${row.id}&limit=${limit}`
    );
    push(sameDev, "same_developer");
  }

  c.header("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=600");
  return c.json({ success: true, related: out, count: out.length });
});

/**
 * POST /api/apps/:id/share
 *
 * Returns the canonical share URL, per-network intent links, and a QR code.
 *
 * The QR is rendered on the server as an SVG data URI so that a caller which is
 * not a browser (the Android client, an email template) gets something it can
 * display without running our canvas script. The browser keeps using the
 * client-side renderer in qr-render.js, so the share dialog still opens
 * instantly and works offline.
 */
api.post("/apps/:id/share", async (c) => {
  const key = c.req.param("id");
  const { row, error: findErr } = await findApp(c.env, key, "id,app_name,app_slug,description,icon_url");
  if (findErr) return fail(c, 500, "Could not build the share link.");
  if (!row) return fail(c, 404, "App not found.");

  const body = await c.req.json().catch(() => ({}));
  const origin = new URL(c.req.url).origin;
  const slug = row.app_slug || row.id;
  const shareUrl = `${origin}/app/${encodeURIComponent(slug)}`;
  const title = row.app_name || "App";
  const text = `${title} on Open Appstore`;
  const enc = encodeURIComponent;

  let qrCode = null;
  try {
    const svg = await QRCode.toString(shareUrl, {
      type: "svg",
      margin: 1,
      width: 240,
      errorCorrectionLevel: "M",
      color: { dark: "#0b1020ff", light: "#ffffffff" }
    });
    // Base64 rather than percent-encoding: an SVG data URI containing raw '#'
    // characters truncates in some clients at the first fragment marker.
    qrCode = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  } catch {
    qrCode = null; // a share link without a QR is still a usable share link
  }

  // Best-effort attribution of where shares come from. Never blocks the reply.
  const channel = String(body.channel || body.platform || "").slice(0, 40) || null;

  return c.json({
    success: true,
    share_url: shareUrl,
    title,
    text,
    qr_code: qrCode,
    channel,
    links: {
      whatsapp: `https://wa.me/?text=${enc(`${text} ${shareUrl}`)}`,
      telegram: `https://t.me/share/url?url=${enc(shareUrl)}&text=${enc(text)}`,
      twitter: `https://twitter.com/intent/tweet?url=${enc(shareUrl)}&text=${enc(text)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(shareUrl)}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(shareUrl)}`,
      reddit: `https://www.reddit.com/submit?url=${enc(shareUrl)}&title=${enc(title)}`,
      email: `mailto:?subject=${enc(text)}&body=${enc(shareUrl)}`,
      copy: shareUrl
    }
  });
});
api.post("/apps/:id/reviews", async (c) => {
  const token = bearer(c.req.header("Authorization"));
  if (!token) return c.json({ success: false, error: "Sign in to write a review" }, 401);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const rating = Math.max(1, Math.min(5, parseInt(String(body.rating || 0), 10) || 0));
  if (!rating) return c.json({ success: false, error: "Rating (1-5) is required" }, 400);
  const payload = {
    app_id: id,
    rating,
    title: body.title || null,
    review_text: body.review_text || null
  };
  let { data, error, status } = await sbWrite(c.env, "app_reviews", "POST", payload, "", token);
  if (error && hasServiceRole(c.env)) {
    const { data: user } = await sbAuth(c.env, "user", { token });
    const admin = await sbAdminWrite(c.env, "app_reviews", "POST", {
      ...payload,
      user_id: user?.id ?? null
    });
    data = admin.data;
    error = admin.error;
    status = admin.status;
  }
  if (error) {
    return c.json(
      {
        success: false,
        error,
        hint: error.includes("row-level security") ? "Add an RLS INSERT policy on app_reviews: WITH CHECK (user_id = auth.uid())." : void 0
      },
      status || 400
    );
  }
  if (hasServiceRole(c.env)) {
    const { data: all } = await sbSelect(
      c.env,
      "app_reviews",
      `select=rating&app_id=eq.${id}&limit=1000`
    );
    const nums = (all || []).map((r) => Number(r.rating || 0)).filter((n) => n > 0);
    if (nums.length) {
      const avg = Math.round(nums.reduce((s, n) => s + n, 0) / nums.length * 10) / 10;
      await sbAdminWrite(c.env, "apps", "PATCH", { rating: avg, total_reviews: nums.length }, `id=eq.${id}`);
    }
  }
  return c.json({ success: true, review: (data || [])[0] || null });
});
var api_apps_default = api;
export {
  api_apps_default as default
};
