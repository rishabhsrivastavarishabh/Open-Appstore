/**
 * Developer app media & release endpoints: screenshots, binary metadata,
 * publishing, and analytics.
 *
 * ── An important limitation, stated up front ──────────────────────────────────
 * The spec asks for `multipart/form-data` uploads of icons, screenshots and
 * APK/AAB files up to 500 MB. Cloudflare Workers cannot do that: there is no
 * writable filesystem, and no object store is bound to this project. Accepting a
 * 500 MB body would also blow straight past the Worker request limits.
 *
 * So these endpoints register media by URL and record verified metadata about
 * it. The size and content type are not taken on trust from the client — the
 * server issues a HEAD request against the URL and records what the host
 * actually reports, which is strictly better than a form field a client can lie
 * about. (The existing data proves the point: one stored row claimed `54` for a
 * 56 MB file.)
 *
 * If real uploads are wanted, the fix is an R2 bucket plus presigned PUTs; that
 * is a deliberate infrastructure decision, not something to fake here.
 */
import { Hono } from "hono";
import { sbSelect, sbAdminSelect, sbAdminWrite, sbAuth, bearer } from "../lib/supabase.js";
import { fail } from "../lib/apierror.js";
import { normalizeImageUrl, normalizeDownloadUrl } from "../lib/media.js";
import { probeDownloadSize, formatBytes, classifyDownload } from "../lib/appsize.js";

const meta = new Hono();


/** Authenticate, then confirm the caller owns the app named in the path. */
async function requireOwnedApp(c, idParam = "id") {
  const token = bearer(c.req.header("Authorization"));
  if (!token) return { err: fail(c, 401, "Authentication token missing or invalid.", "unauthorized") };
  const { data: user, error } = await sbAuth(c.env, "user", { token });
  if (error || !user?.id) return { err: fail(c, 401, "Authentication token missing or invalid.", "unauthorized") };
  const { data: devs } = await sbSelect(c.env, "developers", "select=id&user_id=eq." + user.id + "&limit=1", token);
  const developer = (devs || [])[0];
  if (!developer) return { err: fail(c, 403, "This account does not have a developer profile.", "forbidden") };

  const key = c.req.param(idParam);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
  const q = new URLSearchParams({ select: "id,app_slug,app_name,status,developer_id,download_url,google_drive_link", limit: "1" });
  if (isUuid) q.set("or", "(id.eq." + key + ",app_id.eq." + key + ")");
  else q.set("app_slug", "eq." + key);
  // Service role: a draft is invisible to the anon key, so the developer could
  // not read back their own unpublished app. Ownership is enforced immediately
  // below, before anything is returned.
  const { data: apps } = await sbAdminSelect(c.env, "apps", q.toString());
  const app = (apps || [])[0];
  if (!app) return { err: fail(c, 404, "App not found.", "not_found") };
  // 404 rather than 403 for someone else's app: a 403 would confirm the app
  // exists, which is information the caller is not entitled to.
  if (app.developer_id !== developer.id) return { err: fail(c, 404, "App not found.", "not_found") };
  return { user, developer, app, token };
}

/* ------------------------------------------------------------- screenshots */

meta.get("/developer/apps/:id/screenshots", async (c) => {
  const ctx = await requireOwnedApp(c);
  if (ctx.err) return ctx.err;
  const { data, error } = await sbAdminSelect(
    c.env,
    "app_screenshots",
    "select=id,image_url,order_position,uploaded_at&app_id=eq." + ctx.app.id + "&order=order_position.asc&limit=50"
  );
  if (error) return fail(c, 500, "Could not load screenshots.");
  return c.json({ screenshots: data || [], count: (data || []).length });
});

meta.post("/developer/apps/:id/screenshots", async (c) => {
  const ctx = await requireOwnedApp(c);
  if (ctx.err) return ctx.err;
  let body;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, "Expected a JSON body with an image_url or urls array.", "invalid_request");
  }
  const raw = Array.isArray(body?.urls) ? body.urls : body?.image_url ? [body.image_url] : [];
  if (!raw.length) return fail(c, 400, "At least one image URL is required.", "invalid_request");
  // Google Drive share links are rewritten to a form that actually renders in an
  // <img>; a raw /file/d/ link does not.
  const urls = raw.map((u) => normalizeImageUrl(String(u || "").trim())).filter((u) => u && /^https?:\/\//i.test(u));
  if (!urls.length) return fail(c, 400, "None of those look like image URLs.", "invalid_request");

  const { data: existing } = await sbAdminSelect(
    c.env,
    "app_screenshots",
    "select=order_position&app_id=eq." + ctx.app.id + "&order=order_position.desc&limit=1"
  );
  let next = ((existing || [])[0]?.order_position ?? -1) + 1;
  const { data: current } = await sbAdminSelect(c.env, "app_screenshots", "select=id&app_id=eq." + ctx.app.id + "&limit=50");
  const room = 8 - (current || []).length; // spec caps a listing at 8 screenshots
  if (room <= 0) return fail(c, 409, "This app already has the maximum of 8 screenshots.", "conflict");

  const rows = urls.slice(0, room).map((u) => ({
    app_id: ctx.app.id,
    image_url: u,
    order_position: next++,
    uploaded_at: new Date().toISOString()
  }));
  const { data, error } = await sbAdminWrite(c.env, "app_screenshots", "POST", rows);
  if (error) return fail(c, 500, "Could not save the screenshots.");
  return c.json(
    {
      screenshot_urls: (data || []).map((r) => r.image_url),
      count: (data || []).length,
      skipped: urls.length - rows.length
    },
    201
  );
});

meta.delete("/developer/apps/:id/screenshots/:shotId", async (c) => {
  const ctx = await requireOwnedApp(c);
  if (ctx.err) return ctx.err;
  const { data, error } = await sbAdminWrite(
    c.env,
    "app_screenshots",
    "DELETE",
    void 0,
    "id=eq." + c.req.param("shotId") + "&app_id=eq." + ctx.app.id
  );
  if (error) return fail(c, 500, "Could not remove the screenshot.");
  if (!(data || []).length) return fail(c, 404, "Screenshot not found.", "not_found");
  return c.json({ success: true });
});

/** Reorder by supplying the ids in the order wanted. */
meta.put("/developer/apps/:id/screenshots/order", async (c) => {
  const ctx = await requireOwnedApp(c);
  if (ctx.err) return ctx.err;
  let body;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, "Expected a JSON body with an ids array.", "invalid_request");
  }
  const ids = Array.isArray(body?.ids) ? body.ids : [];
  if (!ids.length) return fail(c, 400, "An ids array is required.", "invalid_request");
  const { data: owned } = await sbAdminSelect(c.env, "app_screenshots", "select=id&app_id=eq." + ctx.app.id + "&limit=50");
  const ownedIds = new Set((owned || []).map((r) => r.id));
  // Reject the whole request if any id is foreign, rather than silently
  // reordering a subset and reporting success.
  for (const id of ids) if (!ownedIds.has(id)) return fail(c, 400, "One of those screenshots does not belong to this app.", "invalid_request");
  let pos = 0;
  for (const id of ids) {
    await sbAdminWrite(c.env, "app_screenshots", "PATCH", { order_position: pos++, updated_at: new Date().toISOString() }, "id=eq." + id);
  }
  return c.json({ success: true, count: ids.length });
});

/* ------------------------------------------------------------- app binaries */

meta.get("/developer/apps/:id/files", async (c) => {
  const ctx = await requireOwnedApp(c);
  if (ctx.err) return ctx.err;
  const { data, error } = await sbAdminSelect(
    c.env,
    "app_files",
    "select=id,file_url,file_type,file_size,file_hash,is_current,uploaded_at,download_count,version_id&app_id=eq." + ctx.app.id + "&order=uploaded_at.desc&limit=50"
  );
  if (error) return fail(c, 500, "Could not load app files.");
  return c.json({
    files: (data || []).map((f) => ({ ...f, file_size_label: formatBytes(f.file_size) }))
  });
});

/**
 * Register a binary by URL. The server HEAD-probes the URL and records the size
 * and type the host actually reports; a client-supplied size is ignored.
 */
meta.post("/developer/apps/:id/files", async (c) => {
  const ctx = await requireOwnedApp(c);
  if (ctx.err) return ctx.err;
  let body;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, "Expected a JSON body with a file_url.", "invalid_request");
  }
  const url = normalizeDownloadUrl(String(body?.file_url || "").trim());
  if (!url || !/^https?:\/\//i.test(url)) return fail(c, 400, "A valid file_url is required.", "invalid_request");

  const kind = classifyDownload(url);
  const probed = await probeDownloadSize(url, { timeoutMs: 6000 });
  if (!probed && body?.require_reachable !== false) {
    // Refusing here is the useful behaviour: a listing whose download 404s is
    // worse than a listing that was never created.
    return fail(
      c,
      422,
      "That URL did not return a downloadable file. Check the link is public and direct, then try again.",
      "invalid_request"
    );
  }

  if (body?.is_current !== false) {
    await sbAdminWrite(c.env, "app_files", "PATCH", { is_current: false }, "app_id=eq." + ctx.app.id + "&is_current=is.true");
  }
  const row = {
    app_id: ctx.app.id,
    file_url: url,
    file_type: (kind.kind || "other").toUpperCase(),
    file_size: probed || null,
    file_hash: String(body?.file_hash || "").slice(0, 128) || null,
    uploaded_by: ctx.developer.id,
    uploaded_at: new Date().toISOString(),
    is_current: body?.is_current !== false,
    version_id: body?.version_id || null,
    download_count: 0
  };
  const { data, error } = await sbAdminWrite(c.env, "app_files", "POST", row);
  if (error) return fail(c, 500, "Could not register the file.");
  const saved = (data || [])[0] || {};
  return c.json(
    {
      id: saved.id,
      file_url: url,
      file_type: row.file_type,
      file_size: probed || null,
      file_size_label: formatBytes(probed),
      platform: kind.platform,
      detected: !!probed
    },
    201
  );
});

/* ------------------------------------------------------------ publish state */

meta.post("/developer/apps/:id/publish", async (c) => {
  const ctx = await requireOwnedApp(c);
  if (ctx.err) return ctx.err;
  let body = {};
  try {
    body = (await c.req.json()) || {};
  } catch {
    body = {};
  }
  if (body.terms_accepted === false || body.privacy_accepted === false) {
    return fail(c, 400, "You must accept the terms and privacy policy to publish.", "invalid_request");
  }
  if (ctx.app.status === "published") return fail(c, 409, "This app is already published.", "conflict");
  // A published listing with no download is a dead end for every visitor.
  if (!ctx.app.download_url && !ctx.app.google_drive_link) {
    return fail(c, 422, "Add a download link before publishing.", "invalid_request");
  }
  const now = new Date().toISOString();
  const { data, error } = await sbAdminWrite(
    c.env,
    "apps",
    "PATCH",
    { status: "published", updated_at: now },
    "id=eq." + ctx.app.id + "&developer_id=eq." + ctx.developer.id
  );
  if (error) return fail(c, 500, "Could not publish the app.");
  const row = (data || [])[0] || {};
  return c.json({ app_id: row.id || ctx.app.id, app_slug: row.app_slug || ctx.app.app_slug, status: "published", published_at: now });
});

meta.post("/developer/apps/:id/unpublish", async (c) => {
  const ctx = await requireOwnedApp(c);
  if (ctx.err) return ctx.err;
  if (ctx.app.status !== "published") return fail(c, 409, "This app is not published.", "conflict");
  const { error } = await sbAdminWrite(
    c.env,
    "apps",
    "PATCH",
    { status: "draft", updated_at: new Date().toISOString() },
    "id=eq." + ctx.app.id + "&developer_id=eq." + ctx.developer.id
  );
  if (error) return fail(c, 500, "Could not unpublish the app.");
  return c.json({ app_id: ctx.app.id, status: "draft" });
});

/* ---------------------------------------------------------------- analytics */

/**
 * Analytics from real recorded data only.
 *
 * `app_analytics_daily` is currently empty, so rather than invent a plausible
 * chart this derives what genuinely exists — download rows, review rows — and
 * reports `daily_data: []` with `has_data: false` when there is nothing. A
 * dashboard showing fabricated numbers is worse than one that admits it has
 * none.
 */
meta.get("/developer/apps/:id/analytics", async (c) => {
  const ctx = await requireOwnedApp(c);
  if (ctx.err) return ctx.err;
  const to = String(c.req.query("date_to") || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const fromQ = String(c.req.query("date_from") || "").slice(0, 10);
  const from = fromQ || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

  const [dailyRes, appRes, dlRes, revRes] = await Promise.all([
    sbAdminSelect(
      c.env,
      "app_analytics_daily",
      "select=date,downloads,unique_users,sessions,crashes,crash_rate,avg_rating,new_reviews&app_id=eq." +
        ctx.app.id +
        "&date=gte." + from + "&date=lte." + to + "&order=date.asc&limit=400"
    ),
    sbAdminSelect(c.env, "apps", "select=total_downloads,rating,total_reviews&id=eq." + ctx.app.id + "&limit=1"),
    sbAdminSelect(c.env, "app_downloads", "select=downloaded_at&app_id=eq." + ctx.app.id + "&limit=5000"),
    sbAdminSelect(c.env, "app_reviews", "select=rating,created_at&app_id=eq." + ctx.app.id + "&limit=5000")
  ]);

  const daily = dailyRes.data || [];
  const appRow = (appRes.data || [])[0] || {};
  const downloads = dlRes.data || [];
  const reviews = revRes.data || [];

  // Tally download rows per day in JS: PostgREST aggregate functions are
  // disabled on this project (PGRST123).
  const perDay = new Map();
  for (const d of downloads) {
    const day = String(d.downloaded_at || "").slice(0, 10);
    if (!day || day < from || day > to) continue;
    perDay.set(day, (perDay.get(day) || 0) + 1);
  }
  const derived = [...perDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, n]) => ({ date, downloads: n }));

  const ratingSum = reviews.reduce((n, r) => n + (Number(r.rating) || 0), 0);
  return c.json({
    range: { date_from: from, date_to: to },
    total_downloads: Number(appRow.total_downloads || 0),
    recorded_download_events: downloads.length,
    total_reviews: reviews.length || Number(appRow.total_reviews || 0),
    avg_rating: reviews.length ? Number((ratingSum / reviews.length).toFixed(2)) : Number(appRow.rating || 0),
    crashes: daily.reduce((n, d) => n + Number(d.crashes || 0), 0),
    daily_data: daily.length ? daily : derived,
    // Told plainly so a client renders an empty state instead of a flat line
    // that looks like real zero-traffic data.
    has_data: daily.length > 0 || derived.length > 0,
    source: daily.length ? "app_analytics_daily" : derived.length ? "app_downloads" : "none"
  });
});

export default meta;
