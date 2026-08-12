/**
 * Anonymous smoke tests for the endpoints added for the extended API spec:
 * legal documents, WebAuthn passkeys, developer help, app metadata, and the
 * upgraded app-details / reviews / versions / related / share routes.
 *
 * Run against a local dev server or a deployment:
 *   node tests/api-new.mjs
 *   BASE=https://openappstore.pages.dev node tests/api-new.mjs
 *
 * This suite deliberately checks that the gated routes REFUSE anonymous
 * callers. tests/api-new-auth.mjs covers the authenticated half.
 */
const BASE = process.env.BASE || "http://localhost:3000";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} -- ${extra}`); }
};

async function j(path, init) {
  const r = await fetch(BASE + path, init);
  let b = null;
  try { b = await r.json(); } catch { b = null; }
  return { status: r.status, body: b, headers: r.headers };
}

const list = await j("/api/apps?limit=3");
ok("GET /api/apps", list.status === 200 && Array.isArray(list.body?.apps) && list.body.apps.length > 0,
  `status=${list.status} n=${list.body?.apps?.length}`);
const app = list.body?.apps?.[0];
// The list view exposes `slug`; `id` is the uuid. Exercise the SLUG path here —
// a separate check below confirms the uuid path resolves to the same app.
const slug = app?.slug || app?.id;
console.log(`   using slug=${slug}`);

/* ── feature 6: legal documents ───────────────────────────────────────────── */
for (const kind of ["privacy", "terms", "cookies"]) {
  const r = await j(`/api/legal/${kind}`);
  ok(`GET /api/legal/${kind}`,
    r.status === 200 && r.body?.version === 1 && typeof r.body?.content === "string" && r.body.content.length > 300,
    `status=${r.status} len=${r.body?.content?.length}`);
  ok(`  ${kind} is cacheable at the edge`,
    /s-maxage=3600/.test(r.headers.get("cache-control") || ""), r.headers.get("cache-control"));
}
{
  const r = await j("/api/legal/versions");
  ok("GET /api/legal/versions",
    r.status === 200 && r.body?.privacy?.version === 1 && r.body?.terms?.version === 1 && r.body?.cookies?.version === 1,
    JSON.stringify(r.body).slice(0, 200));
}
ok("GET /api/legal/<unknown> -> 404", (await j("/api/legal/nonsense")).status === 404);
{
  const r = await j("/api/user/policy-acceptance", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  ok("POST /api/user/policy-acceptance unauthenticated -> 401",
    r.status === 401 && r.body?.code === "unauthorized", `status=${r.status} code=${r.body?.code}`);
}
{
  const r = await j("/api/developer/policy-acceptance", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer garbage" }, body: "{}"
  });
  ok("POST /api/developer/policy-acceptance bad token -> 401", r.status === 401, `status=${r.status}`);
}

/* ── feature 3: WebAuthn ──────────────────────────────────────────────────── */
ok("POST webauthn/register/options unauthenticated -> 401",
  (await j("/api/developer/webauthn/register/options", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
  })).status === 401);
{
  // Authentication options must NOT require a session (that is the point), and
  // must not reveal whether the address has passkeys.
  const a = await j("/api/developer/webauthn/authenticate/options", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "definitely-not-a-user-9f3a@example.com" })
  });
  ok("POST webauthn/authenticate/options unknown email -> 200",
    a.status === 200 && typeof a.body?.challenge === "string" && a.body.challenge.length >= 40,
    `status=${a.status}`);
  ok("  no user enumeration (empty allowCredentials)",
    Array.isArray(a.body?.allowCredentials) && a.body.allowCredentials.length === 0,
    JSON.stringify(a.body?.allowCredentials));
  ok("  rpId present", typeof a.body?.rpId === "string" && a.body.rpId.length > 0, a.body?.rpId);
}
{
  const r = await j("/api/developer/webauthn/authenticate/verify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "x@example.com", id: "AAAA", response: {} })
  });
  ok("POST webauthn/authenticate/verify garbage -> 4xx", r.status >= 400 && r.status < 500, `status=${r.status}`);
}
ok("GET webauthn/passkeys unauthenticated -> 401",
  (await j("/api/developer/webauthn/passkeys")).status === 401);

/* ── feature 4: developer help ────────────────────────────────────────────── */
ok("POST help/chat unauthenticated -> 401",
  (await j("/api/developer/help/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "how do I publish an app?" })
  })).status === 401);
ok("GET help/conversations unauthenticated -> 401",
  (await j("/api/developer/help/conversations")).status === 401);

/* ── feature 2: app metadata ──────────────────────────────────────────────── */
for (const p of ["screenshots", "files", "analytics"]) {
  ok(`GET developer/apps/:id/${p} unauthenticated -> 401`,
    (await j(`/api/developer/apps/00000000-0000-0000-0000-000000000000/${p}`)).status === 401);
}
ok("POST developer/apps/:id/publish unauthenticated -> 401",
  (await j("/api/developer/apps/00000000-0000-0000-0000-000000000000/publish", { method: "POST" })).status === 401);

/* ── feature 1: app details ───────────────────────────────────────────────── */
{
  const r = await j(`/api/apps/${slug}`);
  const b = r.body;
  ok("GET /api/apps/:slug full", r.status === 200 && !!b?.app?.id, `status=${r.status}`);
  ok("  has reviews_pagination",
    b?.reviews_pagination && typeof b.reviews_pagination.total === "number" && typeof b.reviews_pagination.has_more === "boolean",
    JSON.stringify(b?.reviews_pagination));
  ok("  has rating_breakdown with 5 buckets",
    b?.rating_breakdown?.counts && Object.keys(b.rating_breakdown.counts).length === 5,
    JSON.stringify(b?.rating_breakdown));
  for (const k of ["app", "developer", "more_from_developer", "similar", "reviews", "versions",
                   "reviews_pagination", "rating_breakdown"]) {
    ok(`  section present: ${k}`, k in b, "missing");
  }
  // uuid must resolve to the same app as the slug
  const byId = await j(`/api/apps/${app.id}`);
  ok("  the uuid resolves to the same app as the slug",
    byId.status === 200 && byId.body?.app?.id === b.app.id, `status=${byId.status}`);
}
{
  const r = await j(`/api/apps/${slug}?fields=basic`);
  ok("GET /api/apps/:slug?fields=basic", r.status === 200 && r.body?.fields === "basic" && !!r.body?.app?.id, `status=${r.status}`);
  ok("  basic omits reviews/versions", !("reviews" in r.body) && !("versions" in r.body), Object.keys(r.body).join(","));
  const full = await j(`/api/apps/${slug}`);
  ok("  basic payload is smaller than full",
    JSON.stringify(r.body).length < JSON.stringify(full.body).length,
    `${JSON.stringify(r.body).length} vs ${JSON.stringify(full.body).length}`);
}
{
  const r = await j("/api/apps/no-such-app-slug-xyz");
  ok("GET /api/apps/<missing> -> 404 with code", r.status === 404 && r.body?.code === "not_found",
    `status=${r.status} code=${r.body?.code}`);
}

/* reviews: pagination, sorting, filtering */
{
  const r = await j(`/api/apps/${slug}/reviews?limit=5&offset=0&sort=newest`);
  ok("GET reviews (by slug) paginated",
    r.status === 200 && Array.isArray(r.body?.reviews) && !!r.body?.pagination
      && typeof r.body.has_more === "boolean" && typeof r.body.total === "number",
    `status=${r.status} ${JSON.stringify(r.body?.pagination)}`);
  ok("  limit respected", (r.body?.reviews?.length ?? 99) <= 5, `n=${r.body?.reviews?.length}`);
  ok("  rating_breakdown present", !!r.body?.rating_breakdown);
  ok("  applied echoed", r.body?.applied?.sort === "newest");
}
for (const s of ["newest", "oldest", "highest", "lowest", "helpful"]) {
  const r = await j(`/api/apps/${slug}/reviews?sort=${s}&limit=3`);
  ok(`  reviews sort=${s} -> 200`, r.status === 200 && r.body?.applied?.sort === s,
    `status=${r.status} applied=${r.body?.applied?.sort}`);
}
ok("  reviews unknown sort falls back to newest",
  (await j(`/api/apps/${slug}/reviews?sort=bogus`)).body?.applied?.sort === "newest");
{
  const r = await j(`/api/apps/${slug}/reviews?rating=5`);
  ok("  reviews rating=5 filter -> 200", r.status === 200 && r.body?.applied?.rating === 5, `status=${r.status}`);
  ok("  rating filter actually filters",
    (r.body?.reviews || []).every((x) => Number(x.rating) === 5), "off-rating rows present");
}
{
  const r = await j(`/api/apps/${slug}/reviews?limit=99999&offset=-5`);
  ok("  reviews clamps absurd limit/offset",
    r.status === 200 && r.body?.pagination?.limit === 100 && r.body?.pagination?.offset === 0,
    JSON.stringify(r.body?.pagination));
}
ok("GET reviews for missing app -> 404", (await j("/api/apps/no-such-app/reviews")).status === 404);

/* versions */
{
  const r = await j(`/api/apps/${slug}/versions`);
  ok("GET /api/apps/:slug/versions (by slug)",
    r.status === 200 && Array.isArray(r.body?.versions) && !!r.body?.pagination,
    `status=${r.status} ${JSON.stringify(r.body?.pagination)}`);
}
ok("GET versions for missing app -> 404", (await j("/api/apps/no-such-app/versions")).status === 404);

/* related */
{
  const r = await j(`/api/apps/${slug}/related?limit=6`);
  ok("GET /api/apps/:slug/related", r.status === 200 && Array.isArray(r.body?.related), `status=${r.status}`);
  ok("  related honours limit", (r.body?.related?.length ?? 99) <= 6, `n=${r.body?.related?.length}`);
  ok("  related excludes the app itself", !(r.body?.related || []).some((a) => a.slug === slug));
  ok("  every item labelled with relation_source",
    (r.body?.related || []).every((a) => typeof a.relation_source === "string"));
}
ok("GET related for missing app -> 404", (await j("/api/apps/no-such-app/related")).status === 404);

/* share */
{
  const r = await j(`/api/apps/${slug}/share`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "whatsapp" })
  });
  const b = r.body;
  ok("POST /api/apps/:slug/share", r.status === 200 && typeof b?.share_url === "string", `status=${r.status}`);
  ok("  share_url points at the canonical /app/<slug>",
    String(b?.share_url).includes(`/app/${app.slug || app.id}`), `${b?.share_url}`);
  ok("  qr_code is an svg data uri",
    typeof b?.qr_code === "string" && b.qr_code.startsWith("data:image/svg+xml;base64,"),
    String(b?.qr_code).slice(0, 40));
  ok("  qr decodes to real svg markup",
    !!b?.qr_code && Buffer.from(b.qr_code.split(",")[1], "base64").toString("utf8").includes("<svg"));
  ok("  channel echoed", b?.channel === "whatsapp");
  for (const k of ["whatsapp", "telegram", "twitter", "facebook", "linkedin", "reddit", "email", "copy"]) {
    ok(`  share link: ${k}`, typeof b?.links?.[k] === "string" && b.links[k].length > 0);
  }
}
ok("POST share for missing app -> 404", (await j("/api/apps/no-such-app/share", { method: "POST" })).status === 404);

/* the envelope must be identical everywhere */
for (const [p, want] of [["/api/apps/no-such-app", 404], ["/api/apps/no-such-app/reviews", 404],
                         ["/api/developer/webauthn/passkeys", 401]]) {
  const r = await j(p);
  ok(`envelope GET ${p}`,
    r.status === want && typeof r.body?.message === "string" && typeof r.body?.code === "string"
      && typeof r.body?.error === "string",
    `status=${r.status} body=${JSON.stringify(r.body)}`);
}

console.log(`\nPASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
