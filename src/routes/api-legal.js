/**
 * Legal document API: privacy policy, terms of service, cookie policy, and the
 * record of who accepted which version.
 *
 * The documents live in the database (`privacy_policy_versions`,
 * `terms_of_service_versions`, `cookie_policy_versions`) rather than in code so
 * the operator can publish a revision without a redeploy. Each table is
 * append-only: a new revision is a new row with a higher `version_number`, and
 * the acceptance records point at the specific row a person agreed to. That is
 * the whole point of versioning consent — if you overwrite a policy in place you
 * destroy the evidence of what was actually agreed to, which is exactly what
 * GDPR Art. 7(1) requires you to be able to demonstrate.
 *
 * The spec asked for `{ "version": 1 }` integers in the acceptance payload. The
 * live tables use `*_version_id` UUID foreign keys instead, so this accepts an
 * integer version number and resolves it to the row id — the caller gets the
 * simple contract from the spec without us denormalising consent records.
 */
import { Hono } from "hono";
import { sbSelect, sbAdminSelect, sbAdminWrite, sbAuth, bearer } from "../lib/supabase.js";
import { fail } from "../lib/apierror.js";

const legal = new Hono();

/** Maps the public document kind to its versions table. */
const DOC_TABLES = {
  privacy: "privacy_policy_versions",
  terms: "terms_of_service_versions",
  cookies: "cookie_policy_versions"
};

const DOC_SELECT = "id,version_number,content,effective_date,created_at,updated_at";


/**
 * Read the current revision: the highest `version_number` whose
 * `effective_date` has already passed. Ordering by version rather than by
 * `created_at` means a back-dated correction cannot silently become "current".
 */
async function currentDoc(env, kind) {
  const table = DOC_TABLES[kind];
  if (!table) return { doc: null, error: "unknown_kind" };
  const nowIso = new Date().toISOString();
  const q = `select=${DOC_SELECT}&effective_date=lte.${nowIso}&order=version_number.desc&limit=1`;
  const { data, error } = await sbSelect(env, table, q);
  if (error) return { doc: null, error };
  const doc = (data || [])[0] || null;
  if (doc) return { doc, error: null };
  // Nothing effective yet: fall back to the newest row so a policy that was
  // seeded with a future date is still readable rather than 404ing.
  const { data: any1 } = await sbSelect(env, table, `select=${DOC_SELECT}&order=version_number.desc&limit=1`);
  return { doc: (any1 || [])[0] || null, error: null };
}

for (const kind of Object.keys(DOC_TABLES)) {
  legal.get(`/legal/${kind}`, async (c) => {
    const { doc, error } = await currentDoc(c.env, kind);
    if (error) return fail(c, 500, "Could not load the document.");
    if (!doc) {
      // A missing policy row is an operator problem, not a client error. Say so
      // rather than returning an empty 200 that a client would render as blank
      // legal text.
      return fail(c, 404, "No published version of this document yet.", "not_found");
    }
    // Legal text changes rarely; let the edge hold it.
    c.header("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
    return c.json({
      id: doc.id,
      version: doc.version_number,
      content: doc.content,
      effective_date: doc.effective_date
    });
  });
}

/** All three current versions in one round trip, for a consent banner. */
legal.get("/legal/versions", async (c) => {
  const [p, t, k] = await Promise.all([
    currentDoc(c.env, "privacy"),
    currentDoc(c.env, "terms"),
    currentDoc(c.env, "cookies")
  ]);
  c.header("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  return c.json({
    privacy: p.doc ? { id: p.doc.id, version: p.doc.version_number, effective_date: p.doc.effective_date } : null,
    terms: t.doc ? { id: t.doc.id, version: t.doc.version_number, effective_date: t.doc.effective_date } : null,
    cookies: k.doc ? { id: k.doc.id, version: k.doc.version_number, effective_date: k.doc.effective_date } : null
  });
});

/**
 * Resolve a caller-supplied integer version number to the row id it names.
 * A number that does not exist is rejected rather than coerced to "latest":
 * silently recording consent to a different document than the one the caller
 * named would make the audit trail worse than having none.
 */
async function resolveVersionId(env, kind, wanted) {
  const table = DOC_TABLES[kind];
  if (wanted === void 0 || wanted === null || wanted === "") {
    const { doc } = await currentDoc(env, kind);
    return { id: doc?.id || null, missing: !doc };
  }
  const n = Number(wanted);
  if (!Number.isInteger(n) || n < 1) return { id: null, invalid: true };
  const { data } = await sbSelect(env, table, `select=id&version_number=eq.${n}&limit=1`);
  const row = (data || [])[0];
  return { id: row?.id || null, missing: !row };
}

/**
 * Record an acceptance. `who` is "user" or "developer"; the two tables are
 * identical apart from the owning column.
 */
async function recordAcceptance(c, who) {
  const token = bearer(c.req.header("Authorization"));
  if (!token) return fail(c, 401, "Authentication token missing or invalid.", "unauthorized");
  const { data: user, error: authErr } = await sbAuth(c.env, "user", { token });
  if (authErr || !user?.id) return fail(c, 401, "Authentication token missing or invalid.", "unauthorized");

  let body = {};
  try {
    body = (await c.req.json()) || {};
  } catch {
    body = {};
  }

  let ownerCol = "user_id";
  let ownerId = user.id;
  let table = "user_policy_acceptance";
  if (who === "developer") {
    const { data: devs } = await sbSelect(c.env, "developers", `select=id&user_id=eq.${user.id}&limit=1`, token);
    const devId = (devs || [])[0]?.id;
    if (!devId) return fail(c, 403, "This account does not have a developer profile.", "forbidden");
    ownerCol = "developer_id";
    ownerId = devId;
    table = "developer_policy_acceptance";
  }

  const [priv, terms, cookies] = await Promise.all([
    resolveVersionId(c.env, "privacy", body.privacy_version),
    resolveVersionId(c.env, "terms", body.terms_version),
    resolveVersionId(c.env, "cookies", body.cookie_version)
  ]);
  for (const [name, r] of [["privacy_version", priv], ["terms_version", terms], ["cookie_version", cookies]]) {
    if (r.invalid) return fail(c, 400, `${name} must be a positive integer.`, "invalid_request");
    if (r.missing && body[name] !== void 0) {
      return fail(c, 400, `${name} ${body[name]} does not exist.`, "invalid_request");
    }
  }
  if (!priv.id && !terms.id && !cookies.id) {
    return fail(c, 409, "No policy versions are published yet, so there is nothing to accept.", "conflict");
  }

  const row = {
    [ownerCol]: ownerId,
    privacy_policy_version_id: priv.id,
    terms_version_id: terms.id,
    cookie_policy_version_id: cookies.id,
    // Kept for the audit trail. CF-Connecting-IP is the client address as seen
    // by Cloudflare; it is not attacker-controllable the way X-Forwarded-For is.
    ip_address: c.req.header("CF-Connecting-IP") || null,
    user_agent: (c.req.header("User-Agent") || "").slice(0, 500) || null,
    accepted_at: new Date().toISOString()
  };
  // Service role: RLS on these tables is written for the owning principal, and
  // the tenant boundary is already established above from the verified token.
  const { error } = await sbAdminWrite(c.env, table, "POST", row);
  if (error) return fail(c, 500, "Could not record your acceptance.");
  return c.json({ success: true });
}

legal.post("/user/policy-acceptance", (c) => recordAcceptance(c, "user"));
legal.post("/developer/policy-acceptance", (c) => recordAcceptance(c, "developer"));

/** What the signed-in caller has already accepted, so a banner can stay quiet. */
legal.get("/user/policy-acceptance", async (c) => {
  const token = bearer(c.req.header("Authorization"));
  if (!token) return fail(c, 401, "Authentication token missing or invalid.", "unauthorized");
  const { data: user, error } = await sbAuth(c.env, "user", { token });
  if (error || !user?.id) return fail(c, 401, "Authentication token missing or invalid.", "unauthorized");
  const { data } = await sbAdminSelect(
    c.env,
    "user_policy_acceptance",
    `select=id,privacy_policy_version_id,terms_version_id,cookie_policy_version_id,accepted_at&user_id=eq.${user.id}&order=accepted_at.desc&limit=1`
  );
  return c.json({ acceptance: (data || [])[0] || null });
});

export default legal;
