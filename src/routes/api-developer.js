import { Hono } from "hono";
import { sbAuth, sbSelect, sbWrite, sbAdminWrite, hasServiceRole, bearer } from "../lib/supabase.js";
import { normalizeImageUrl, normalizeImageList, normalizeDownloadUrl } from "../lib/media.js";
import { APP_SELECT_WITH_DEV, toAppView } from "../lib/types.js";
const dev = new Hono();
async function requireDev(c) {
  const token = bearer(c.req.header("Authorization"));
  if (!token) return c.json({ success: false, error: "Sign in first" }, 401);
  const { data: user, error } = await sbAuth(c.env, "user", { token });
  if (error || !user?.id) return c.json({ success: false, error: error || "Invalid session" }, 401);
  const { data } = await sbSelect(c.env, "developers", `select=*&user_id=eq.${user.id}&limit=1`, token);
  return { userId: user.id, developer: (data || [])[0] || null, token };
}
async function resolveStoreId(c, token) {
  const wanted = c.env.STORE_ID;
  const q = wanted ? `select=id&store_id=eq.${encodeURIComponent(wanted)}&limit=1` : "select=id&limit=1";
  const { data } = await sbSelect(c.env, "app_stores", q, token);
  if ((data || []).length) return data[0].id;
  const { data: any1 } = await sbSelect(c.env, "app_stores", "select=id&limit=1", token);
  return (any1 || [])[0]?.id ?? null;
}
function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 60);
}
dev.get("/developer/apps", async (c) => {
  const ctx = await requireDev(c);
  if (ctx instanceof Response) return ctx;
  if (!ctx.developer) return c.json({ success: true, apps: [], developer: null, needs_profile: true });
  const { data, error } = await sbSelect(
    c.env,
    "apps",
    `select=${APP_SELECT_WITH_DEV}&developer_id=eq.${ctx.developer.id}&order=created_at.desc&limit=200`,
    ctx.token
  );
  if (error) return c.json({ success: false, error }, 500);
  const apps = (data || []).map(toAppView);
  const totals = apps.reduce(
    (acc, a) => {
      acc.downloads += a.downloads;
      acc.published += a.status === "published" ? 1 : 0;
      acc.drafts += a.status !== "published" ? 1 : 0;
      if (a.rating > 0) {
        acc.ratingSum += a.rating;
        acc.ratedCount += 1;
      }
      return acc;
    },
    { downloads: 0, published: 0, drafts: 0, ratingSum: 0, ratedCount: 0 }
  );
  return c.json({
    success: true,
    developer: ctx.developer,
    apps,
    stats: {
      total_apps: apps.length,
      published: totals.published,
      drafts: totals.drafts,
      total_downloads: totals.downloads,
      avg_rating: totals.ratedCount ? Number((totals.ratingSum / totals.ratedCount).toFixed(2)) : 0
    }
  });
});
dev.post("/developer/apps", async (c) => {
  const ctx = await requireDev(c);
  if (ctx instanceof Response) return ctx;
  if (!ctx.developer)
    return c.json({ success: false, error: "Create your developer profile first", needs_profile: true }, 400);
  const body = await c.req.json().catch(() => ({}));
  const app_name = String(body.app_name || "").trim();
  if (!app_name) return c.json({ success: false, error: "App name is required" }, 400);
  if (!String(body.description || "").trim()) return c.json({ success: false, error: "Description is required" }, 400);
  let slug = slugify(body.app_slug || app_name) || `app-${Date.now()}`;
  const { data: clash } = await sbSelect(c.env, "apps", `select=id&app_slug=eq.${slug}&limit=1`, ctx.token);
  if ((clash || []).length) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const isFree = body.is_free !== false && body.is_free !== "false";
  const storeId = await resolveStoreId(c, ctx.token);
  const payload = {
    app_id: `app_${slug.replace(/-/g, "_")}_${Math.random().toString(36).slice(2, 7)}`,
    app_name,
    app_slug: slug,
    description: String(body.description),
    icon_url: normalizeImageUrl(body.icon_url, 512),
    screenshots: normalizeImageList(body.screenshots, 1600).length ? normalizeImageList(body.screenshots, 1600) : null,
    category: body.category || "Other",
    current_version: body.version || "1.0.0",
    latest_version: body.version || "1.0.0",
    download_url: normalizeDownloadUrl(body.download_url),
    website: body.website_link || body.website || null,
    website_link: body.website_link || body.website || null,
    google_drive_link: body.google_drive_link || null,
    privacy_policy_link: body.privacy_policy_link || null,
    auto_update: body.auto_update !== false && body.auto_update !== "false",
    update_available: false,
    change_log: body.change_log || body.release_notes || null,
    latest_version_code: body.version_code ? Number(body.version_code) : 1,
    min_version: body.min_version || null,
    email: body.support_email || ctx.developer.email || null,
    is_free: isFree,
    price: isFree ? 0 : Number(body.price || 0),
    rating: 0,
    total_downloads: 0,
    total_reviews: 0,
    status: body.status === "published" ? "published" : "draft",
    developer_id: ctx.developer.id,
    store_id: storeId
  };
  const { data, error, status } = await sbWrite(c.env, "apps", "POST", payload, "", ctx.token);
  if (error) {
    return c.json(
      {
        success: false,
        error,
        hint: error.includes("row-level security") ? "Add an RLS INSERT policy on apps: WITH CHECK (developer_id IN (SELECT id FROM developers WHERE user_id = auth.uid()))." : void 0
      },
      status || 400
    );
  }
  const created = (data || [])[0] || null;

  // Seed the release history with this first version so the app page has a
  // changelog from day one. Best-effort — never fail the submission over it.
  let version = null;
  if (created?.id) {
    version = await recordVersion(c, ctx, created.id, {
      version: payload.latest_version,
      release_notes: body.release_notes || "Initial release.",
      download_url: payload.download_url,
      file_size: body.file_size
    });
  }
  return c.json({ success: true, app: created, version });
});
dev.patch("/developer/apps/:id", async (c) => {
  const ctx = await requireDev(c);
  if (ctx instanceof Response) return ctx;
  if (!ctx.developer) return c.json({ success: false, error: "No developer profile" }, 400);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const patch = {};
  const allow = [
    "app_name",
    "description",
    "icon_url",
    "category",
    "download_url",
    "website",
    "google_drive_link",
    "privacy_policy_link",
    "change_log",
    "min_version",
    "status"
  ];
  allow.forEach((k) => {
    if (body[k] !== void 0) patch[k] = body[k] === "" ? null : body[k];
  });
  if (body.support_email !== void 0) patch.email = body.support_email || null;
  if (body.website_link !== void 0) {
    patch.website_link = body.website_link || null;
    patch.website = body.website_link || null;
  }
  if (body.auto_update !== void 0) patch.auto_update = body.auto_update !== false && body.auto_update !== "false";
  if (body.update_available !== void 0) patch.update_available = body.update_available === true || body.update_available === "true" || body.update_available === "1";
  if (body.version_code !== void 0 && body.version_code !== "") patch.latest_version_code = Number(body.version_code) || null;
  if (body.icon_url !== void 0) patch.icon_url = normalizeImageUrl(body.icon_url, 512);
  if (body.download_url !== void 0) patch.download_url = normalizeDownloadUrl(body.download_url);
  if (body.version) {
    patch.current_version = body.version;
    patch.latest_version = body.version;
  }
  if (body.is_free !== void 0) {
    const isFree = body.is_free !== false && body.is_free !== "false";
    patch.is_free = isFree;
    patch.price = isFree ? 0 : Number(body.price || 0);
  }
  if (Array.isArray(body.screenshots)) {
    const shots = normalizeImageList(body.screenshots, 1600);
    patch.screenshots = shots.length ? shots : null;
  }
  if (!Object.keys(patch).length) return c.json({ success: false, error: "Nothing to update" }, 400);
  const { data, error, status } = await sbWrite(
    c.env,
    "apps",
    "PATCH",
    patch,
    `id=eq.${id}&developer_id=eq.${ctx.developer.id}`,
    ctx.token
  );
  if (error) return c.json({ success: false, error }, status || 400);
  if (!(data || []).length)
    return c.json({ success: false, error: "App not found, or your role cannot update it (RLS)" }, 403);

  // Publishing a new version number records an entry in the release history so
  // users can see what changed. Best-effort: never fail the update over it.
  let version = null;
  if (body.version && (body.release_notes || body.version !== ctxAppVersion(body))) {
    version = await recordVersion(c, ctx, id, body);
  }

  return c.json({ success: true, app: (data || [])[0], version });
});

/** Previous version of the app as sent by the client (may be absent). */
function ctxAppVersion(body) {
  return body.previous_version || null;
}

/** Insert a row into app_versions describing this release. */
async function recordVersion(c, ctx, appId, body) {
  const payload = {
    app_id: appId,
    version_number: String(body.version),
    release_notes: body.release_notes || null,
    download_url: normalizeDownloadUrl(body.download_url),
    drive_link: body.drive_link ? normalizeDownloadUrl(body.drive_link) : null,
    change_log: body.release_notes || null,
    is_auto_update: body.is_auto_update !== false && body.is_auto_update !== "false",
    force_update: body.force_update === true || body.force_update === "true" || body.force_update === "1",
    file_size: body.file_size ? Math.max(1, Math.round(Number(body.file_size))) : null,
    release_date: new Date().toISOString()
  };
  const res = hasServiceRole(c.env)
    ? await sbAdminWrite(c.env, "app_versions", "POST", payload)
    : await sbWrite(c.env, "app_versions", "POST", payload, "", ctx.token);
  return res.error ? null : (res.data || [])[0] || null;
}

/** GET /api/developer/apps/:id/versions — release history for one of my apps */
dev.get("/developer/apps/:id/versions", async (c) => {
  const ctx = await requireDev(c);
  if (ctx instanceof Response) return ctx;
  if (!ctx.developer) return c.json({ success: false, error: "No developer profile" }, 400);
  const id = c.req.param("id");

  const { data: owned } = await sbSelect(
    c.env,
    "apps",
    `select=id&id=eq.${id}&developer_id=eq.${ctx.developer.id}&limit=1`,
    ctx.token
  );
  if (!(owned || []).length) return c.json({ success: false, error: "App not found" }, 404);

  const { data, error } = await sbSelect(
    c.env,
    "app_versions",
    `select=id,version_number,release_notes,download_url,drive_link,file_size,force_update,is_auto_update,release_date,created_at&app_id=eq.${id}&order=release_date.desc.nullslast&limit=100`,
    ctx.token
  );
  if (error) return c.json({ success: false, error, versions: [] }, 500);
  return c.json({ success: true, versions: data || [] });
});

/** POST /api/developer/apps/:id/versions — ship an update (bumps the app row too) */
dev.post("/developer/apps/:id/versions", async (c) => {
  const ctx = await requireDev(c);
  if (ctx instanceof Response) return ctx;
  if (!ctx.developer) return c.json({ success: false, error: "No developer profile" }, 400);

  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const version = String(body.version || "").trim();
  if (!version) return c.json({ success: false, error: "Version number is required" }, 400);
  if (!/^\d+(\.\d+){0,3}([-+][A-Za-z0-9.]+)?$/.test(version))
    return c.json({ success: false, error: "Use a numeric version such as 1.2.0" }, 400);

  const { data: rows } = await sbSelect(
    c.env,
    "apps",
    `select=id,latest_version,current_version,download_url,latest_version_code&id=eq.${id}&developer_id=eq.${ctx.developer.id}&limit=1`,
    ctx.token
  );
  const current = (rows || [])[0];
  if (!current) return c.json({ success: false, error: "App not found" }, 404);
  if (current.latest_version === version)
    return c.json({ success: false, error: `Version ${version} is already the latest release` }, 409);

  const patch = {
    latest_version: version,
    current_version: version,
    min_version: body.min_version || void 0,
    change_log: body.release_notes || void 0,
    update_available: true,
    latest_version_code: body.version_code
      ? Number(body.version_code)
      : Number(current.latest_version_code || 0) + 1,
    auto_update: body.is_auto_update === void 0 ? void 0 : body.is_auto_update !== false && body.is_auto_update !== "false",
    updated_at: new Date().toISOString()
  };
  if (body.download_url) patch.download_url = normalizeDownloadUrl(body.download_url);
  if (body.drive_link) patch.google_drive_link = body.drive_link;
  Object.keys(patch).forEach((k) => patch[k] === void 0 && delete patch[k]);

  const upd = await sbWrite(c.env, "apps", "PATCH", patch, `id=eq.${id}&developer_id=eq.${ctx.developer.id}`, ctx.token);
  if (upd.error) return c.json({ success: false, error: upd.error }, upd.status || 400);

  const versionRow = await recordVersion(c, ctx, id, {
    version,
    release_notes: body.release_notes,
    download_url: body.download_url || current.download_url,
    file_size: body.file_size
  });

  return c.json({
    success: true,
    app: (upd.data || [])[0] || null,
    version: versionRow,
    previous_version: current.latest_version || current.current_version || null
  });
});
dev.delete("/developer/apps/:id", async (c) => {
  const ctx = await requireDev(c);
  if (ctx instanceof Response) return ctx;
  if (!ctx.developer) return c.json({ success: false, error: "No developer profile" }, 400);
  const id = c.req.param("id");
  const { error, status } = await sbWrite(
    c.env,
    "apps",
    "DELETE",
    void 0,
    `id=eq.${id}&developer_id=eq.${ctx.developer.id}`,
    ctx.token
  );
  if (error) return c.json({ success: false, error }, status || 400);
  return c.json({ success: true });
});
var api_developer_default = dev;
export {
  api_developer_default as default
};
