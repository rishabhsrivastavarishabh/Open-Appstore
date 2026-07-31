import { Hono } from "hono";
import {
  sbSelect,
  sbWrite,
  sbAdminWrite,
  sbAuth,
  hasServiceRole,
  bearer
} from "../lib/supabase";
import {
  APP_SELECT_WITH_DEV,
  DEV_SELECT,
  REVIEW_SELECT,
  ORDER,
  CATEGORIES,
  toAppView
} from "../lib/types";
import { normalizeDownloadUrl, linkHost, isDriveUrl } from "../lib/media.js";
const api = new Hono();

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
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
  const params = new URLSearchParams({ select: APP_SELECT_WITH_DEV, limit: "1" });
  if (isUuid) params.set("or", `(id.eq.${key},app_id.eq.${key})`);
  else params.set("app_slug", `eq.${key}`);
  const { data, error } = await sbSelect(c.env, "apps", params.toString());
  if (error) return c.json({ success: false, error }, 500);
  const row = (data || [])[0];
  if (!row) return c.json({ success: false, error: "App not found" }, 404);
  const app = toAppView(row);
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
    sbSelect(
      c.env,
      "app_reviews",
      `select=${REVIEW_SELECT}&app_id=eq.${app.id}&order=created_at.desc&limit=20`
    )
  ]);
  const [{ data: similar }, versionRes] = await Promise.all([
    sbSelect(
      c.env,
      "apps",
      `select=${APP_SELECT_WITH_DEV}&category=eq.${encodeURIComponent(app.category)}&status=eq.published&id=neq.${app.id}&order=${ORDER.popular}&limit=8`
    ),
    sbSelect(
      c.env,
      "app_versions",
      `select=${VERSION_SELECT}&app_id=eq.${app.id}&order=release_date.desc.nullslast&limit=20`
    )
  ]);
  return c.json({
    success: true,
    app,
    developer: (devRes.data || [])[0] || null,
    more_from_developer: (siblingRes.data || []).map(toAppView),
    similar: (similar || []).map(toAppView),
    reviews: reviewRes.data || [],
    versions: (versionRes.data || []).map(toVersionView)
  });
});

/** GET /api/apps/:id/versions — public release history for one app. */
api.get("/apps/:id/versions", async (c) => {
  const id = c.req.param("id");
  const { data, error } = await sbSelect(
    c.env,
    "app_versions",
    `select=${VERSION_SELECT}&app_id=eq.${id}&order=release_date.desc.nullslast&limit=50`
  );
  if (error) return c.json({ success: false, error, versions: [] }, 500);
  return c.json({ success: true, versions: (data || []).map(toVersionView) });
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
  const id = c.req.param("id");
  const { data } = await sbSelect(c.env, "apps", `select=id,total_downloads,download_url,website&id=eq.${id}&limit=1`);
  const row = (data || [])[0];
  if (!row) return c.json({ success: false, error: "App not found" }, 404);
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
api.get("/apps/:id/reviews", async (c) => {
  const id = c.req.param("id");
  const { data, error } = await sbSelect(
    c.env,
    "app_reviews",
    `select=${REVIEW_SELECT}&app_id=eq.${id}&order=created_at.desc&limit=50`
  );
  if (error) return c.json({ success: false, error, reviews: [] }, 500);
  return c.json({ success: true, reviews: data || [] });
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
