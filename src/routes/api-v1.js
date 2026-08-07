/**
 * Developer API v1 — the surface described in DEVELOPER_API_REFERENCE.md.
 *
 * Mounted at /api/v1. Every route is authenticated with a `dev_…` API key:
 *     Authorization: Bearer dev_xxxxxxxx
 *
 * Response envelope is uniform so clients can branch on one field:
 *     success: { "success": true, "data": … , "meta"?: … }
 *     failure: { "success": false, "error": { "code", "message", "details"? } }
 *
 * Every handler resolves the caller's *own* developer row and scopes each query
 * to it, so one developer can never read or mutate another's apps even by
 * guessing UUIDs. That check lives in `requireKey`, not in individual handlers,
 * so a new route cannot accidentally omit it.
 */

import { Hono } from "hono";
import { sbAdminSelect, sbWrite, sbAdminWrite, hasServiceRole } from "../lib/supabase.js";
import { authenticateKey, touchKey } from "../lib/apikey.js";
import { consume, applyHeaders, TIERS } from "../lib/ratelimit.js";
import { normalizeImageUrl, normalizeImageList, normalizeDownloadUrl } from "../lib/media.js";
import { APP_SELECT_WITH_DEV, toAppView, CATEGORIES } from "../lib/types.js";

const v1 = new Hono();

/* ── error codes (the documented table) ─────────────────────────────────── */

export const ERRORS = {
  missing_api_key: { status: 401, message: "No API key supplied. Send Authorization: Bearer dev_…" },
  invalid_api_key: { status: 401, message: "The API key is invalid." },
  revoked_api_key: { status: 401, message: "This API key has been revoked." },
  no_developer_profile: { status: 403, message: "This account has no developer profile yet." },
  forbidden: { status: 403, message: "You do not have access to this resource." },
  not_found: { status: 404, message: "The requested resource does not exist." },
  validation_failed: { status: 422, message: "One or more fields are invalid." },
  conflict: { status: 409, message: "The request conflicts with the current state." },
  rate_limited: { status: 429, message: "Rate limit exceeded. Retry after the reset window." },
  method_not_allowed: { status: 405, message: "That method is not supported on this endpoint." },
  internal_error: { status: 500, message: "Something went wrong on our side." }
};

function fail(c, code, message, details) {
  const spec = ERRORS[code] || ERRORS.internal_error;
  const body = { success: false, error: { code, message: message || spec.message } };
  if (details !== undefined) body.error.details = details;
  return c.json(body, spec.status);
}

function ok(c, data, meta) {
  const body = { success: true, data };
  if (meta !== undefined) body.meta = meta;
  return c.json(body);
}

/* ── auth + rate-limit middleware ───────────────────────────────────────── */

/**
 * Resolve the API key, the owning developer profile, and the rate-limit budget.
 * Returns a Response on failure so handlers can `if (x instanceof Response)`.
 */
async function requireKey(c) {
  const header = c.req.header("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  const key = m ? m[1].trim() : c.req.header("X-API-Key");
  if (!key) return fail(c, "missing_api_key");

  const auth = await authenticateKey(c.env, key);
  if (auth.error) return fail(c, auth.code || "invalid_api_key", auth.error);

  // The developer row is the tenant boundary for every query below.
  //
  // A database trigger auto-creates a placeholder `developers` row on signup, so
  // an account can legitimately end up with more than one row (placeholder +
  // the one the console wrote). Ordering by created_at makes the choice
  // deterministic — without it, `limit=1` picks an arbitrary row and the same
  // key can resolve to different tenants across requests.
  const { data } = await sbAdminSelect(
    c.env,
    "developers",
    `select=*&user_id=eq.${auth.userId}&order=created_at.asc&limit=1`
  );
  const developer = (data || [])[0] || null;
  if (!developer) return fail(c, "no_developer_profile");

  // Verified studios get the higher published quota.
  const tier = developer.verified ? "verified" : "free";
  const rl = consume(`k:${auth.keyId}`, tier);
  applyHeaders(c, rl);
  if (!rl.allowed) {
    c.header("Retry-After", String(rl.retryAfter));
    return fail(c, "rate_limited", `Rate limit of ${rl.limit} requests/hour exceeded.`, {
      limit: rl.limit,
      reset: rl.reset,
      retry_after: rl.retryAfter
    });
  }

  // Bookkeeping only — never blocks or fails the request.
  c.executionCtx?.waitUntil?.(touchKey(c.env, auth.userId, auth.keyId));

  return { userId: auth.userId, keyId: auth.keyId, developer, tier, email: auth.email };
}

/** Confirm an app belongs to the calling developer. Returns row or null. */
async function ownedApp(c, ctx, appId, select = "*") {
  // Accept either the uuid primary key or the public app_slug.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId);
  const field = isUuid ? "id" : "app_slug";
  const { data } = await sbAdminSelect(
    c.env,
    "apps",
    `select=${select}&${field}=eq.${encodeURIComponent(appId)}&developer_id=eq.${ctx.developer.id}&limit=1`
  );
  return (data || [])[0] || null;
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

function clampLimit(raw, def = 20, max = 100) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, 1), max);
}

/* ── meta ───────────────────────────────────────────────────────────────── */

/** GET /api/v1 — service descriptor. Public: helps clients discover the API. */
v1.get("/", (c) => {
  const origin = new URL(c.req.url).origin;
  return ok(c, {
    name: "Open Appstore Developer API",
    version: "1.0.0",
    base_url: `${origin}/api/v1`,
    authentication: "Authorization: Bearer dev_…",
    rate_limits: { free: `${TIERS.free}/hour`, verified: `${TIERS.verified}/hour` },
    documentation: `${origin}/developer/docs`,
    endpoints: [
      "GET    /api/v1/apps",
      "POST   /api/v1/apps",
      "GET    /api/v1/apps/{id}",
      "PUT    /api/v1/apps/{id}",
      "DELETE /api/v1/apps/{id}",
      "POST   /api/v1/apps/{id}/publish",
      "POST   /api/v1/apps/{id}/unpublish",
      "GET    /api/v1/apps/{id}/analytics",
      "GET    /api/v1/apps/{id}/reviews",
      "POST   /api/v1/apps/{id}/reviews/{review_id}/respond",
      "GET    /api/v1/apps/{id}/versions",
      "POST   /api/v1/apps/{id}/versions",
      "GET    /api/v1/developer/profile",
      "PUT    /api/v1/developer/profile",
      "GET    /api/v1/developer/stats"
    ]
  });
});

/** GET /api/v1/whoami — cheapest possible "is my key working?" probe. */
v1.get("/whoami", async (c) => {
  const ctx = await requireKey(c);
  if (ctx instanceof Response) return ctx;
  return ok(c, {
    developer_id: ctx.developer.id,
    developer_name: ctx.developer.developer_name || ctx.developer.company_name,
    email: ctx.email,
    verified: !!ctx.developer.verified,
    tier: ctx.tier,
    rate_limit: TIERS[ctx.tier],
    key_id: ctx.keyId
  });
});

/* ── apps ───────────────────────────────────────────────────────────────── */

/** GET /api/v1/apps — list my apps. Query: limit, offset, status, category, search, sort */
v1.get("/apps", async (c) => {
  const ctx = await requireKey(c);
  if (ctx instanceof Response) return ctx;

  const q = c.req.query();
  const limit = clampLimit(q.limit);
  const offset = Math.max(0, Number.parseInt(q.offset ?? "0", 10) || 0);

  const parts = [`select=${APP_SELECT_WITH_DEV}`, `developer_id=eq.${ctx.developer.id}`];
  if (q.status) parts.push(`status=eq.${encodeURIComponent(q.status)}`);
  if (q.category) parts.push(`category=eq.${encodeURIComponent(q.category)}`);
  if (q.search) parts.push(`app_name=ilike.*${encodeURIComponent(q.search)}*`);

  const sort =
    { newest: "created_at.desc", oldest: "created_at.asc", name: "app_name.asc", downloads: "total_downloads.desc.nullslast", rating: "rating.desc.nullslast" }[
      q.sort
    ] || "created_at.desc";
  parts.push(`order=${sort}`, `limit=${limit}`, `offset=${offset}`);

  const { data, error, count } = await sbAdminSelect(c.env, "apps", parts.join("&"), { count: true });
  if (error) return fail(c, "internal_error", error);

  return ok(
    c,
    (data || []).map(toAppView),
    { limit, offset, total: count ?? (data || []).length, has_more: count != null ? offset + limit < count : false }
  );
});

/** GET /api/v1/apps/{id} — one of my apps. */
v1.get("/apps/:id", async (c) => {
  const ctx = await requireKey(c);
  if (ctx instanceof Response) return ctx;
  const row = await ownedApp(c, ctx, c.req.param("id"), APP_SELECT_WITH_DEV);
  if (!row) return fail(c, "not_found", "No app with that id belongs to you.");
  return ok(c, toAppView(row));
});

/** Shared field validation for create/update. Returns { patch } or { errors }. */
function buildAppPatch(body, { creating }) {
  const errors = {};
  const patch = {};

  if (creating || body.app_name !== undefined) {
    const name = String(body.app_name ?? body.name ?? "").trim();
    if (!name) errors.app_name = "App name is required.";
    else if (name.length > 100) errors.app_name = "App name must be 100 characters or fewer.";
    else patch.app_name = name;
  }
  if (creating || body.description !== undefined) {
    const d = String(body.description ?? "").trim();
    if (!d) errors.description = "Description is required.";
    else if (d.length > 4000) errors.description = "Description must be 4000 characters or fewer.";
    else patch.description = d;
  }
  if (body.category !== undefined) {
    const cat = String(body.category);
    // Unknown categories are rejected rather than silently coerced, so a typo
    // surfaces as a 422 instead of an app filed under "Other".
    if (cat && !CATEGORIES.includes(cat) && cat !== "Other") {
      errors.category = `Unknown category. One of: ${CATEGORIES.join(", ")}`;
    } else patch.category = cat || "Other";
  }
  if (body.version !== undefined) {
    const v = String(body.version).trim();
    if (v && !/^\d+(\.\d+){0,3}([-+][A-Za-z0-9.]+)?$/.test(v)) {
      errors.version = "Use a numeric version such as 1.2.0";
    } else if (v) {
      patch.current_version = v;
      patch.latest_version = v;
    }
  }
  if (body.price !== undefined || body.is_free !== undefined) {
    const isFree = body.is_free !== false && body.is_free !== "false";
    const price = Number(body.price ?? 0);
    if (!isFree && (!Number.isFinite(price) || price < 0)) errors.price = "Price must be a non-negative number.";
    else {
      patch.is_free = isFree;
      patch.price = isFree ? 0 : price;
    }
  }
  if (body.icon_url !== undefined) patch.icon_url = normalizeImageUrl(body.icon_url, 512) || null;
  if (body.download_url !== undefined) patch.download_url = normalizeDownloadUrl(body.download_url) || null;
  if (body.screenshots !== undefined) {
    if (!Array.isArray(body.screenshots)) errors.screenshots = "Screenshots must be an array of URLs.";
    else {
      const shots = normalizeImageList(body.screenshots, 1600);
      patch.screenshots = shots.length ? shots : null;
    }
  }
  for (const [src, dest] of [
    ["website", "website"],
    ["website_link", "website_link"],
    ["google_drive_link", "google_drive_link"],
    ["privacy_policy_link", "privacy_policy_link"],
    ["change_log", "change_log"],
    ["min_version", "min_version"]
  ]) {
    if (body[src] !== undefined) patch[dest] = body[src] || null;
  }
  if (body.support_email !== undefined) patch.email = body.support_email || null;
  if (body.auto_update !== undefined) patch.auto_update = body.auto_update !== false && body.auto_update !== "false";
  if (body.version_code !== undefined && body.version_code !== "") {
    const n = Number(body.version_code);
    if (!Number.isInteger(n) || n < 1) errors.version_code = "version_code must be a positive integer.";
    else patch.latest_version_code = n;
  }
  if (body.status !== undefined) {
    const s = String(body.status);
    if (!["draft", "published"].includes(s)) errors.status = 'status must be "draft" or "published".';
    else patch.status = s;
  }

  return Object.keys(errors).length ? { errors } : { patch };
}

/** POST /api/v1/apps — create an app. */
v1.post("/apps", async (c) => {
  const ctx = await requireKey(c);
  if (ctx instanceof Response) return ctx;

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return fail(c, "validation_failed", "Request body must be a JSON object.");

  const built = buildAppPatch(body, { creating: true });
  if (built.errors) return fail(c, "validation_failed", undefined, built.errors);

  let slug = slugify(body.app_slug || built.patch.app_name) || `app-${Date.now()}`;
  const { data: clash } = await sbAdminSelect(c.env, "apps", `select=id&app_slug=eq.${slug}&limit=1`);
  if ((clash || []).length) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  // Attach to the configured storefront, falling back to whichever exists.
  const wanted = c.env.STORE_ID;
  const sq = wanted ? `select=id&store_id=eq.${encodeURIComponent(wanted)}&limit=1` : "select=id&limit=1";
  let { data: stores } = await sbAdminSelect(c.env, "app_stores", sq);
  if (!(stores || []).length) ({ data: stores } = await sbAdminSelect(c.env, "app_stores", "select=id&limit=1"));

  const payload = {
    app_id: `app_${slug.replace(/-/g, "_")}_${Math.random().toString(36).slice(2, 7)}`,
    app_slug: slug,
    current_version: "1.0.0",
    latest_version: "1.0.0",
    latest_version_code: 1,
    is_free: true,
    price: 0,
    rating: 0,
    total_downloads: 0,
    total_reviews: 0,
    status: "draft",
    auto_update: true,
    update_available: false,
    email: ctx.developer.email || null,
    ...built.patch,
    developer_id: ctx.developer.id,
    store_id: (stores || [])[0]?.id ?? null
  };

  const write = hasServiceRole(c.env)
    ? await sbAdminWrite(c.env, "apps", "POST", payload)
    : await sbWrite(c.env, "apps", "POST", payload);
  if (write.error) return fail(c, "internal_error", write.error);

  const created = (write.data || [])[0] || null;
  if (created?.id) {
    // Seed the release history so the changelog is never empty.
    await recordVersion(c, created.id, {
      version: payload.latest_version,
      release_notes: body.release_notes || "Initial release.",
      download_url: payload.download_url
    });
  }
  c.status(201);
  return ok(c, created ? toAppView(created) : null);
});

/** PUT /api/v1/apps/{id} — update an app. PATCH behaves identically. */
async function updateApp(c) {
  const ctx = await requireKey(c);
  if (ctx instanceof Response) return ctx;

  const existing = await ownedApp(c, ctx, c.req.param("id"), "id,latest_version");
  if (!existing) return fail(c, "not_found", "No app with that id belongs to you.");

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return fail(c, "validation_failed", "Request body must be a JSON object.");

  const built = buildAppPatch(body, { creating: false });
  if (built.errors) return fail(c, "validation_failed", undefined, built.errors);
  if (!Object.keys(built.patch).length) return fail(c, "validation_failed", "No recognised fields to update.");

  built.patch.updated_at = new Date().toISOString();
  const write = hasServiceRole(c.env)
    ? await sbAdminWrite(c.env, "apps", "PATCH", built.patch, `id=eq.${existing.id}&developer_id=eq.${ctx.developer.id}`)
    : await sbWrite(c.env, "apps", "PATCH", built.patch, `id=eq.${existing.id}&developer_id=eq.${ctx.developer.id}`);
  if (write.error) return fail(c, "internal_error", write.error);

  const row = (write.data || [])[0];
  if (!row) return fail(c, "forbidden", "The update was rejected by row-level security.");

  // A new version number in an update still earns a changelog entry.
  if (body.version && body.version !== existing.latest_version) {
    await recordVersion(c, existing.id, {
      version: body.version,
      release_notes: body.release_notes,
      download_url: body.download_url
    });
  }
  return ok(c, toAppView(row));
}

v1.put("/apps/:id", updateApp);
v1.patch("/apps/:id", updateApp);

/** DELETE /api/v1/apps/{id} */
v1.delete("/apps/:id", async (c) => {
  const ctx = await requireKey(c);
  if (ctx instanceof Response) return ctx;
  const existing = await ownedApp(c, ctx, c.req.param("id"), "id");
  if (!existing) return fail(c, "not_found", "No app with that id belongs to you.");

  const write = hasServiceRole(c.env)
    ? await sbAdminWrite(c.env, "apps", "DELETE", undefined, `id=eq.${existing.id}&developer_id=eq.${ctx.developer.id}`)
    : await sbWrite(c.env, "apps", "DELETE", undefined, `id=eq.${existing.id}&developer_id=eq.${ctx.developer.id}`);
  if (write.error) return fail(c, "internal_error", write.error);
  return ok(c, { id: existing.id, deleted: true });
});

/** POST /api/v1/apps/{id}/publish and /unpublish */
for (const [suffix, status] of [["publish", "published"], ["unpublish", "draft"]]) {
  v1.post(`/apps/:id/${suffix}`, async (c) => {
    const ctx = await requireKey(c);
    if (ctx instanceof Response) return ctx;
    const existing = await ownedApp(c, ctx, c.req.param("id"), "id,status,app_name,description,download_url");
    if (!existing) return fail(c, "not_found", "No app with that id belongs to you.");
    if (existing.status === status) return fail(c, "conflict", `This app is already ${status}.`);

    // Publishing an incomplete listing would put a broken card in the store, so
    // the required fields are checked here rather than at render time.
    if (status === "published") {
      const missing = [];
      if (!existing.app_name) missing.push("app_name");
      if (!existing.description) missing.push("description");
      if (!existing.download_url) missing.push("download_url");
      if (missing.length) {
        return fail(c, "validation_failed", "Complete these fields before publishing.", { missing });
      }
    }

    const patch = { status, updated_at: new Date().toISOString() };
    const write = hasServiceRole(c.env)
      ? await sbAdminWrite(c.env, "apps", "PATCH", patch, `id=eq.${existing.id}&developer_id=eq.${ctx.developer.id}`)
      : await sbWrite(c.env, "apps", "PATCH", patch, `id=eq.${existing.id}&developer_id=eq.${ctx.developer.id}`);
    if (write.error) return fail(c, "internal_error", write.error);
    return ok(c, { id: existing.id, status });
  });
}

/* ── analytics ──────────────────────────────────────────────────────────── */

/**
 * GET /api/v1/apps/{id}/analytics — downloads over time plus rating summary.
 * Query: period=7d|30d|90d|all (default 30d)
 */
v1.get("/apps/:id/analytics", async (c) => {
  const ctx = await requireKey(c);
  if (ctx instanceof Response) return ctx;
  const app = await ownedApp(c, ctx, c.req.param("id"), "id,app_name,total_downloads,total_reviews,rating,created_at");
  if (!app) return fail(c, "not_found", "No app with that id belongs to you.");

  const period = ["7d", "30d", "90d", "all"].includes(c.req.query("period")) ? c.req.query("period") : "30d";
  const days = { "7d": 7, "30d": 30, "90d": 90 }[period] || null;
  const since = days ? new Date(Date.now() - days * 86400000) : null;

  const dlQuery = [
    "select=downloaded_at,device_info",
    `app_id=eq.${app.id}`,
    "order=downloaded_at.desc",
    "limit=10000"
  ];
  if (since) dlQuery.push(`downloaded_at=gte.${since.toISOString()}`);
  const { data: downloads } = await sbAdminSelect(c.env, "app_downloads", dlQuery.join("&"));

  // Bucket by calendar day, and pre-fill every day in the window so a client
  // charting the series does not have to guess at gaps.
  const byDay = new Map();
  if (days) {
    for (let i = days - 1; i >= 0; i--) {
      byDay.set(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10), 0);
    }
  }
  const platforms = new Map();
  for (const row of downloads || []) {
    const day = String(row.downloaded_at || "").slice(0, 10);
    if (day) byDay.set(day, (byDay.get(day) || 0) + 1);
    const info = String(row.device_info || "").toLowerCase();
    const plat = info.includes("android")
      ? "Android"
      : info.includes("iphone") || info.includes("ios")
        ? "iOS"
        : info.includes("win")
          ? "Windows"
          : info.includes("mac")
            ? "macOS"
            : info.includes("linux")
              ? "Linux"
              : "Other";
    platforms.set(plat, (platforms.get(plat) || 0) + 1);
  }

  const { data: reviews } = await sbAdminSelect(
    c.env,
    "app_reviews",
    `select=rating&app_id=eq.${app.id}&limit=5000`
  );
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of reviews || []) {
    const n = Math.round(Number(r.rating) || 0);
    if (dist[n] !== undefined) dist[n] += 1;
  }

  const series = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, downloads: count }));
  const windowTotal = series.reduce((s, p) => s + p.downloads, 0);

  return ok(c, {
    app_id: app.id,
    app_name: app.app_name,
    period,
    downloads: {
      // Lifetime counter from the app row; the series is window-scoped.
      total: Number(app.total_downloads || 0),
      in_period: windowTotal,
      daily_average: series.length ? Number((windowTotal / series.length).toFixed(2)) : 0,
      timeseries: series
    },
    ratings: {
      average: Number(app.rating || 0),
      total: Number(app.total_reviews || 0),
      distribution: dist
    },
    platforms: [...platforms.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  });
});

/* ── reviews ────────────────────────────────────────────────────────────── */

/** GET /api/v1/apps/{id}/reviews — Query: limit, offset, rating */
v1.get("/apps/:id/reviews", async (c) => {
  const ctx = await requireKey(c);
  if (ctx instanceof Response) return ctx;
  const app = await ownedApp(c, ctx, c.req.param("id"), "id");
  if (!app) return fail(c, "not_found", "No app with that id belongs to you.");

  const limit = clampLimit(c.req.query("limit"));
  const offset = Math.max(0, Number.parseInt(c.req.query("offset") ?? "0", 10) || 0);
  const parts = [
    "select=id,app_id,user_id,rating,title,review_text,helpful_count,created_at,updated_at",
    `app_id=eq.${app.id}`,
    "order=created_at.desc",
    `limit=${limit}`,
    `offset=${offset}`
  ];
  const rating = c.req.query("rating");
  if (rating) parts.push(`rating=eq.${encodeURIComponent(rating)}`);

  const { data, error, count } = await sbAdminSelect(c.env, "app_reviews", parts.join("&"), { count: true });
  if (error) return fail(c, "internal_error", error);

  return ok(
    c,
    (data || []).map((r) => ({
      id: r.id,
      rating: Number(r.rating || 0),
      title: r.title,
      // The developer reply is stored appended to review_text behind a marker,
      // so it must be stripped here — otherwise the reviewer's own words come
      // back with the reply glued onto the end.
      body: stripResponse(r.review_text).trim(),
      helpful_count: Number(r.helpful_count || 0),
      // A developer reply is stored as a marker appended to review_text, since
      // there is no replies table; see respond() below.
      response: extractResponse(r.review_text),
      created_at: r.created_at,
      updated_at: r.updated_at
    })),
    { limit, offset, total: count ?? (data || []).length }
  );
});

const RESPONSE_MARK = "\n\n[developer_response]:";

function extractResponse(text) {
  const s = String(text || "");
  const i = s.indexOf(RESPONSE_MARK);
  if (i < 0) return null;
  const rest = s.slice(i + RESPONSE_MARK.length).trim();
  const nl = rest.indexOf("\n");
  const iso = (nl < 0 ? rest : rest.slice(0, nl)).trim();
  const bodyText = nl < 0 ? "" : rest.slice(nl + 1).trim();
  return { body: bodyText, responded_at: /^\d{4}-\d\d-\d\dT/.test(iso) ? iso : null };
}

function stripResponse(text) {
  const s = String(text || "");
  const i = s.indexOf(RESPONSE_MARK);
  return i < 0 ? s : s.slice(0, i);
}

/**
 * POST /api/v1/apps/{id}/reviews/{review_id}/respond
 *
 * There is no `review_responses` table and DDL is not reachable over PostgREST,
 * so the reply is appended to the review row behind a machine-readable marker
 * and split back out on read. `migrations/0002_developer_api_keys.sql` contains
 * the proper table for anyone who can run SQL; this route keeps working either
 * way because reads go through extractResponse().
 */
v1.post("/apps/:id/reviews/:reviewId/respond", async (c) => {
  const ctx = await requireKey(c);
  if (ctx instanceof Response) return ctx;
  const app = await ownedApp(c, ctx, c.req.param("id"), "id");
  if (!app) return fail(c, "not_found", "No app with that id belongs to you.");

  const body = await c.req.json().catch(() => null);
  const text = String(body?.response ?? body?.body ?? "").trim();
  if (!text) return fail(c, "validation_failed", undefined, { response: "A response body is required." });
  if (text.length > 1000) return fail(c, "validation_failed", undefined, { response: "Keep responses under 1000 characters." });

  const reviewId = c.req.param("reviewId");
  const { data: rows } = await sbAdminSelect(
    c.env,
    "app_reviews",
    `select=id,review_text&id=eq.${encodeURIComponent(reviewId)}&app_id=eq.${app.id}&limit=1`
  );
  const review = (rows || [])[0];
  if (!review) return fail(c, "not_found", "No review with that id exists on this app.");

  const merged = `${stripResponse(review.review_text)}${RESPONSE_MARK} ${new Date().toISOString()}\n${text}`;
  const write = hasServiceRole(c.env)
    ? await sbAdminWrite(c.env, "app_reviews", "PATCH", { review_text: merged, updated_at: new Date().toISOString() }, `id=eq.${review.id}`)
    : await sbWrite(c.env, "app_reviews", "PATCH", { review_text: merged }, `id=eq.${review.id}`);
  if (write.error) return fail(c, "internal_error", write.error);

  return ok(c, { review_id: review.id, response: text, responded_at: new Date().toISOString() });
});

/* ── versions ───────────────────────────────────────────────────────────── */

async function recordVersion(c, appId, body) {
  const payload = {
    app_id: appId,
    version_number: String(body.version),
    release_notes: body.release_notes || null,
    change_log: body.release_notes || null,
    download_url: normalizeDownloadUrl(body.download_url) || null,
    drive_link: body.drive_link ? normalizeDownloadUrl(body.drive_link) : null,
    is_auto_update: body.is_auto_update !== false && body.is_auto_update !== "false",
    force_update: body.force_update === true || body.force_update === "true",
    file_size: body.file_size ? Math.max(1, Math.round(Number(body.file_size))) : null,
    release_date: new Date().toISOString()
  };
  const res = hasServiceRole(c.env)
    ? await sbAdminWrite(c.env, "app_versions", "POST", payload)
    : await sbWrite(c.env, "app_versions", "POST", payload);
  return res.error ? null : (res.data || [])[0] || null;
}

/** GET /api/v1/apps/{id}/versions */
v1.get("/apps/:id/versions", async (c) => {
  const ctx = await requireKey(c);
  if (ctx instanceof Response) return ctx;
  const app = await ownedApp(c, ctx, c.req.param("id"), "id");
  if (!app) return fail(c, "not_found", "No app with that id belongs to you.");

  const { data, error } = await sbAdminSelect(
    c.env,
    "app_versions",
    `select=id,version_number,release_notes,download_url,drive_link,file_size,force_update,is_auto_update,release_date,created_at&app_id=eq.${app.id}&order=release_date.desc.nullslast&limit=200`
  );
  if (error) return fail(c, "internal_error", error);
  return ok(c, data || [], { total: (data || []).length });
});

/** POST /api/v1/apps/{id}/versions — ship a release. */
v1.post("/apps/:id/versions", async (c) => {
  const ctx = await requireKey(c);
  if (ctx instanceof Response) return ctx;
  const app = await ownedApp(c, ctx, c.req.param("id"), "id,latest_version,download_url,latest_version_code");
  if (!app) return fail(c, "not_found", "No app with that id belongs to you.");

  const body = await c.req.json().catch(() => null);
  const version = String(body?.version ?? "").trim();
  if (!version) return fail(c, "validation_failed", undefined, { version: "A version number is required." });
  if (!/^\d+(\.\d+){0,3}([-+][A-Za-z0-9.]+)?$/.test(version)) {
    return fail(c, "validation_failed", undefined, { version: "Use a numeric version such as 1.2.0" });
  }
  if (app.latest_version === version) {
    return fail(c, "conflict", `Version ${version} is already the latest release.`);
  }

  const patch = {
    latest_version: version,
    current_version: version,
    update_available: true,
    latest_version_code: body.version_code ? Number(body.version_code) : Number(app.latest_version_code || 0) + 1,
    updated_at: new Date().toISOString()
  };
  if (body.release_notes) patch.change_log = body.release_notes;
  if (body.min_version) patch.min_version = body.min_version;
  if (body.download_url) patch.download_url = normalizeDownloadUrl(body.download_url);
  if (body.drive_link) patch.google_drive_link = body.drive_link;

  const write = hasServiceRole(c.env)
    ? await sbAdminWrite(c.env, "apps", "PATCH", patch, `id=eq.${app.id}&developer_id=eq.${ctx.developer.id}`)
    : await sbWrite(c.env, "apps", "PATCH", patch, `id=eq.${app.id}&developer_id=eq.${ctx.developer.id}`);
  if (write.error) return fail(c, "internal_error", write.error);

  const versionRow = await recordVersion(c, app.id, {
    version,
    release_notes: body.release_notes,
    download_url: body.download_url || app.download_url,
    drive_link: body.drive_link,
    file_size: body.file_size,
    force_update: body.force_update,
    is_auto_update: body.is_auto_update
  });

  c.status(201);
  return ok(c, {
    version: versionRow || { version_number: version },
    previous_version: app.latest_version || null,
    app: (write.data || [])[0] ? toAppView((write.data || [])[0]) : null
  });
});

/* ── developer profile + stats ──────────────────────────────────────────── */

/** GET /api/v1/developer/profile */
v1.get("/developer/profile", async (c) => {
  const ctx = await requireKey(c);
  if (ctx instanceof Response) return ctx;
  const d = ctx.developer;
  return ok(c, {
    id: d.id,
    developer_name: d.developer_name,
    company_name: d.company_name,
    description: d.description,
    website: d.website,
    email: d.email,
    avatar_url: d.avatar_url,
    verified: !!d.verified,
    verified_at: d.verified_at,
    tier: ctx.tier,
    rate_limit: TIERS[ctx.tier],
    created_at: d.created_at,
    updated_at: d.updated_at
  });
});

/** PUT /api/v1/developer/profile */
v1.on(["PUT", "PATCH"], "/developer/profile", async (c) => {
  const ctx = await requireKey(c);
  if (ctx instanceof Response) return ctx;
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return fail(c, "validation_failed", "Request body must be a JSON object.");

  const patch = {};
  const errors = {};
  if (body.developer_name !== undefined) {
    const n = String(body.developer_name).trim();
    if (!n) errors.developer_name = "Developer name cannot be empty.";
    else patch.developer_name = n.slice(0, 100);
  }
  for (const f of ["company_name", "description", "website", "email", "avatar_url"]) {
    if (body[f] !== undefined) patch[f] = body[f] || null;
  }
  if (patch.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(patch.email)) errors.email = "Enter a valid email address.";
  if (patch.avatar_url) patch.avatar_url = normalizeImageUrl(patch.avatar_url, 512);

  if (Object.keys(errors).length) return fail(c, "validation_failed", undefined, errors);
  // `verified` is deliberately not writable: a studio must not be able to grant
  // itself the verified badge or the higher rate-limit tier.
  if (!Object.keys(patch).length) return fail(c, "validation_failed", "No recognised fields to update.");

  patch.updated_at = new Date().toISOString();
  const write = hasServiceRole(c.env)
    ? await sbAdminWrite(c.env, "developers", "PATCH", patch, `id=eq.${ctx.developer.id}`)
    : await sbWrite(c.env, "developers", "PATCH", patch, `id=eq.${ctx.developer.id}`);
  if (write.error) return fail(c, "internal_error", write.error);
  return ok(c, (write.data || [])[0] || null);
});

/** GET /api/v1/developer/stats — portfolio rollup. */
v1.get("/developer/stats", async (c) => {
  const ctx = await requireKey(c);
  if (ctx instanceof Response) return ctx;

  const { data: apps, error } = await sbAdminSelect(
    c.env,
    "apps",
    `select=id,app_name,app_slug,status,rating,total_reviews,total_downloads,category,created_at&developer_id=eq.${ctx.developer.id}&limit=500`
  );
  if (error) return fail(c, "internal_error", error);

  const list = apps || [];
  let downloads = 0;
  let reviews = 0;
  let ratingSum = 0;
  let rated = 0;
  const byCategory = new Map();
  for (const a of list) {
    downloads += Number(a.total_downloads || 0);
    reviews += Number(a.total_reviews || 0);
    if (Number(a.rating) > 0) {
      ratingSum += Number(a.rating);
      rated += 1;
    }
    const cat = a.category || "Other";
    byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
  }

  const top = [...list]
    .sort((a, b) => Number(b.total_downloads || 0) - Number(a.total_downloads || 0))
    .slice(0, 5)
    .map((a) => ({
      id: a.id,
      name: a.app_name,
      slug: a.app_slug,
      downloads: Number(a.total_downloads || 0),
      rating: Number(a.rating || 0)
    }));

  return ok(c, {
    developer_id: ctx.developer.id,
    developer_name: ctx.developer.developer_name || ctx.developer.company_name,
    verified: !!ctx.developer.verified,
    apps: {
      total: list.length,
      published: list.filter((a) => a.status === "published").length,
      draft: list.filter((a) => a.status !== "published").length
    },
    downloads: { total: downloads },
    reviews: { total: reviews, average_rating: rated ? Number((ratingSum / rated).toFixed(2)) : 0 },
    categories: [...byCategory.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    top_apps: top,
    rate_limit: { tier: ctx.tier, limit: TIERS[ctx.tier], window: "1 hour" }
  });
});

/* ── fallback ───────────────────────────────────────────────────────────── */

// Anything under /api/v1 that matched no route gets the documented JSON error
// shape rather than the HTML 404 page, so a client parsing JSON never chokes.
v1.all("*", (c) => fail(c, "not_found", `No such endpoint: ${c.req.method} ${new URL(c.req.url).pathname}`));

export default v1;
