/**
 * Authenticated tests for the endpoints added for the extended API spec.
 *
 * The anonymous suite (tests/api-new.mjs) proves the gates refuse strangers;
 * this proves the endpoints actually DO their job for a legitimate developer —
 * the half a 401-only suite silently leaves unverified. It also checks
 * cross-tenant isolation, which is the failure that matters most here.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY (read from .dev.vars) to create and clean up
 * throwaway accounts, so it only runs against a local dev server.
 *
 *   node tests/api-new-auth.mjs
 */
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3000";
const env = {};
for (const line of fs.readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
  if (m) env[m[1]] = m[2];
}
const U = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !K) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .dev.vars");
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log(`PASS ${n}`); } else { fail++; console.log(`FAIL ${n} -- ${e}`); } };

async function j(path, init = {}) {
  const r = await fetch(BASE + path, init);
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b, headers: r.headers };
}
const sb = (p, init = {}) => fetch(`${U}/rest/v1/${p}`, {
  ...init,
  headers: { apikey: K, authorization: "Bearer " + K, "content-type": "application/json", ...(init.headers || {}) }
});
const admin = (p, init = {}) => fetch(`${U}/auth/v1/admin/${p}`, {
  ...init,
  headers: { apikey: K, authorization: "Bearer " + K, "content-type": "application/json", ...(init.headers || {}) }
});

const password = "E2eTest!2026x";
const email = `newapi.${Date.now()}@openappstore.test`;
const cud = await (await admin("users", {
  method: "POST",
  body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: "New API Test", is_developer: true } })
})).json();
ok("create test user", !!cud.id, JSON.stringify(cud).slice(0, 200));
const userId = cud.id;

const li = await j("/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password })
});
const token = li.body?.session?.access_token || li.body?.access_token || li.body?.token;
ok("login returns access token", !!token, `status=${li.status} keys=${Object.keys(li.body || {})}`);
const AUTH = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

let devId = null;
{
  const rows = await (await sb(`developers?select=id&user_id=eq.${userId}&limit=1`)).json();
  devId = rows?.[0]?.id || null;
  if (!devId) {
    const d = await (await sb("developers", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: userId, developer_name: "New API Test Studio", email })
    })).json();
    devId = Array.isArray(d) ? d[0]?.id : d?.id;
  }
}
ok("developer profile exists", !!devId, String(devId));

/* ── legal acceptance ─────────────────────────────────────────────────────── */
{
  const r = await j("/api/user/policy-acceptance", {
    method: "POST", headers: AUTH, body: JSON.stringify({ privacy_version: 1, terms_version: 1, cookies_version: 1 })
  });
  ok("POST /api/user/policy-acceptance authenticated", r.status === 200 || r.status === 201,
    `status=${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
}
{
  const r = await j("/api/user/policy-acceptance", { headers: AUTH });
  ok("GET /api/user/policy-acceptance returns the record",
    r.status === 200 && (r.body?.accepted === true || !!r.body?.acceptance || !!r.body?.accepted_at),
    `status=${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
}
{
  // An unknown version must be refused, not coerced to "latest" — otherwise the
  // consent record names a document the user never saw.
  const r = await j("/api/user/policy-acceptance", {
    method: "POST", headers: AUTH, body: JSON.stringify({ privacy_version: 9999 })
  });
  ok("POST policy-acceptance with unknown version -> 4xx", r.status >= 400 && r.status < 500,
    `status=${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
}
{
  const r = await j("/api/developer/policy-acceptance", {
    method: "POST", headers: AUTH, body: JSON.stringify({ privacy_version: 1, terms_version: 1 })
  });
  ok("POST /api/developer/policy-acceptance authenticated", r.status === 200 || r.status === 201,
    `status=${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
}

/* ── WebAuthn ─────────────────────────────────────────────────────────────── */
let regChallenge = null;
{
  const r = await j("/api/developer/webauthn/register/options", { method: "POST", headers: AUTH, body: "{}" });
  const b = r.body;
  ok("POST webauthn/register/options authenticated", r.status === 200 && !!b?.challenge,
    `status=${r.status} ${JSON.stringify(b).slice(0, 250)}`);
  regChallenge = b?.challenge;
  ok("  rp.id + rp.name present", !!b?.rp?.id && !!b?.rp?.name, JSON.stringify(b?.rp));
  ok("  pubKeyCredParams offers ES256 and RS256",
    Array.isArray(b?.pubKeyCredParams) && b.pubKeyCredParams.some((p) => p.alg === -7) && b.pubKeyCredParams.some((p) => p.alg === -257),
    JSON.stringify(b?.pubKeyCredParams));
  // Nested exactly as PublicKeyCredentialCreationOptions.user expects, so the
  // browser needs no reassembly beyond base64url-decoding.
  ok("  user.{id,name,displayName} nested for navigator.credentials.create()",
    !!b?.user?.id && !!b?.user?.name && !!b?.user?.displayName, JSON.stringify(b?.user));
  ok("  flat userId alias retained for spec-written clients", b?.userId === b?.user?.id, `${b?.userId}`);
  ok("  challenge carries >=32 bytes of entropy", (b?.challenge || "").length >= 40, String(b?.challenge).length);
}
{
  const r2 = await j("/api/developer/webauthn/register/options", { method: "POST", headers: AUTH, body: "{}" });
  ok("  a second options call issues a DIFFERENT challenge",
    !!r2.body?.challenge && r2.body.challenge !== regChallenge, "challenge repeated");
  // Challenges must survive leaving the isolate that issued them: Workers
  // isolates are per-request/per-colo, so an in-memory challenge would usually
  // be verified by a different isolate than the one that minted it.
  const rows = await (await sb(`webauthn_challenges?select=id,challenge_type,used&developer_id=eq.${devId}`)).json();
  ok("  challenges are persisted in the database (not in an isolate)",
    Array.isArray(rows) && rows.length >= 2,
    `rows=${Array.isArray(rows) ? rows.length : JSON.stringify(rows).slice(0, 150)}`);
}
{
  const r = await j("/api/developer/webauthn/passkeys", { headers: AUTH });
  ok("GET webauthn/passkeys authenticated -> empty list",
    r.status === 200 && Array.isArray(r.body?.passkeys) && r.body.passkeys.length === 0,
    `status=${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
}
{
  // A forged attestation must be rejected by the crypto, not accepted because
  // the caller happens to hold a valid session.
  const r = await j("/api/developer/webauthn/register/verify", {
    method: "POST", headers: AUTH,
    body: JSON.stringify({ id: "AAAA", rawId: "AAAA", type: "public-key",
      response: { attestationObject: "AAAA", clientDataJSON: "AAAA" } })
  });
  ok("POST webauthn/register/verify with forged attestation -> 4xx", r.status >= 400 && r.status < 500,
    `status=${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
}
ok("DELETE a missing/foreign passkey -> 404",
  (await j("/api/developer/webauthn/passkeys/00000000-0000-0000-0000-000000000000", { method: "DELETE", headers: AUTH })).status === 404);

/* ── app metadata ─────────────────────────────────────────────────────────── */
let appId = null;
{
  const r = await j("/api/developer/apps", {
    method: "POST", headers: AUTH,
    body: JSON.stringify({
      app_name: `New API Probe ${Date.now()}`,
      description: "Created by the authenticated smoke test for the new metadata endpoints.",
      category: "Tools", is_free: true
    })
  });
  appId = r.body?.app?.id || r.body?.id;
  ok("POST /api/developer/apps creates a draft", (r.status === 200 || r.status === 201) && !!appId,
    `status=${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
}
if (appId) {
  {
    const r = await j(`/api/developer/apps/${appId}/screenshots`, { headers: AUTH });
    ok("GET screenshots on own app", r.status === 200 && Array.isArray(r.body?.screenshots), `status=${r.status}`);
  }
  {
    const r = await j(`/api/developer/apps/${appId}/screenshots`, {
      method: "POST", headers: AUTH, body: JSON.stringify({ image_url: "https://placehold.co/1080x1920/png" })
    });
    ok("POST screenshot registers it", r.status === 200 || r.status === 201,
      `status=${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
  }
  {
    const r = await j(`/api/developer/apps/${appId}/screenshots`, { headers: AUTH });
    ok("  screenshot now listed", (r.body?.screenshots?.length || 0) >= 1, `n=${r.body?.screenshots?.length}`);
  }
  {
    // A published listing with no way to install it is worse than a draft.
    const r = await j(`/api/developer/apps/${appId}/publish`, { method: "POST", headers: AUTH });
    ok("POST publish without a download link -> 422", r.status === 422,
      `status=${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
  }
  {
    const r = await j(`/api/developer/apps/${appId}/files`, { headers: AUTH });
    ok("GET files on own app", r.status === 200 && Array.isArray(r.body?.files), `status=${r.status}`);
  }
  {
    const r = await j(`/api/developer/apps/${appId}/files`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ file_url: "https://this-host-does-not-exist-93f2a.invalid/app.apk" })
    });
    ok("POST file with an unreachable URL -> 422 (server verifies, does not trust the client)",
      r.status === 422, `status=${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
  }
  {
    const r = await j(`/api/developer/apps/${appId}/analytics`, { headers: AUTH });
    ok("GET analytics on own app", r.status === 200, `status=${r.status}`);
    ok("  analytics admits it has no data rather than inventing numbers",
      r.body?.has_data === false || r.body?.source === "none", JSON.stringify(r.body).slice(0, 250));
  }
  {
    const r = await j(`/api/developer/apps/${appId}/screenshots/order`, {
      method: "PUT", headers: AUTH, body: JSON.stringify({ order: ["00000000-0000-0000-0000-000000000000"] })
    });
    ok("PUT screenshot order containing a foreign id -> 4xx (whole request refused)",
      r.status >= 400 && r.status < 500, `status=${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
}

/* ── cross-tenant isolation ───────────────────────────────────────────────── */
{
  const email2 = `newapi2.${Date.now()}@openappstore.test`;
  const u2 = await (await admin("users", {
    method: "POST",
    body: JSON.stringify({ email: email2, password, email_confirm: true, user_metadata: { is_developer: true } })
  })).json();
  await sb("developers", { method: "POST", body: JSON.stringify({ user_id: u2.id, developer_name: "Other Studio", email: email2 }) });
  const l2 = await j("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email2, password })
  });
  const t2 = l2.body?.session?.access_token || l2.body?.access_token;
  ok("second developer logs in", !!t2, `status=${l2.status}`);
  if (t2 && appId) {
    const A2 = { Authorization: `Bearer ${t2}`, "Content-Type": "application/json" };
    // 404 rather than 403: a 403 would confirm the app exists, which the caller
    // is not entitled to know.
    ok("cross-tenant: 404 on another developer's app (not 403)",
      (await j(`/api/developer/apps/${appId}/screenshots`, { headers: A2 })).status === 404);
    ok("cross-tenant: cannot publish another developer's app",
      (await j(`/api/developer/apps/${appId}/publish`, { method: "POST", headers: A2 })).status === 404);
    ok("cross-tenant: cannot read another developer's analytics",
      (await j(`/api/developer/apps/${appId}/analytics`, { headers: A2 })).status === 404);
    const ps = await j("/api/developer/webauthn/passkeys", { headers: A2 });
    ok("cross-tenant: passkey list is scoped to the caller",
      ps.status === 200 && (ps.body?.passkeys || []).length === 0, `status=${ps.status}`);
  }
  if (u2.id) await admin(`users/${u2.id}`, { method: "DELETE" });
}

/* ── developer help (real model call) ─────────────────────────────────────── */
{
  const r = await j("/api/developer/help/chat", {
    method: "POST", headers: AUTH, body: JSON.stringify({ message: "How do I publish my app on this store?" })
  });
  ok("POST help/chat authenticated", r.status === 200, `status=${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  if (r.status === 200) {
    const b = r.body;
    // The endpoint serves the answer as both `response` and `reply`, because the
    // uploaded spec uses each name in a different section.
    ok("  answer is non-empty text under both `response` and `reply`",
      typeof b?.response === "string" && b.response.length > 20 && b.reply === b.response,
      `response=${String(b?.response).slice(0, 60)} reply=${String(b?.reply).slice(0, 30)}`);
    ok("  conversation_id returned", !!b?.conversation_id, String(b?.conversation_id));
    ok("  suggestions returned", Array.isArray(b?.suggestions) && b.suggestions.length > 0, JSON.stringify(b?.suggestions));
    ok("  links returned", Array.isArray(b?.links), JSON.stringify(b?.links));
    ok("  rate-limit headers applied", !!r.headers.get("x-ratelimit-limit"),
      `limit=${r.headers.get("x-ratelimit-limit")} remaining=${r.headers.get("x-ratelimit-remaining")}`);

    const r2 = await j("/api/developer/help/chat", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ message: "And how do I add screenshots?", conversation_id: b.conversation_id })
    });
    ok("  continuing the conversation keeps the same id",
      r2.status === 200 && r2.body?.conversation_id === b.conversation_id,
      `status=${r2.status} id=${r2.body?.conversation_id}`);

    const list = await j("/api/developer/help/conversations", { headers: AUTH });
    ok("GET help/conversations lists it",
      list.status === 200 && (list.body?.conversations || []).some((x) => x.id === b.conversation_id),
      `status=${list.status} ${JSON.stringify(list.body).slice(0, 200)}`);

    const one = await j(`/api/developer/help/conversations/${b.conversation_id}`, { headers: AUTH });
    ok("GET one conversation returns its messages", one.status === 200 && (one.body?.messages || []).length >= 2,
      `status=${one.status} n=${one.body?.messages?.length}`);

    const assistantMsg = (one.body?.messages || []).find((m) => m.role === "assistant");
    const fb = await j("/api/developer/help/feedback", {
      method: "POST", headers: AUTH, body: JSON.stringify({ message_id: assistantMsg?.id, helpful: true })
    });
    ok("POST help/feedback accepted", fb.status === 200 || fb.status === 201,
      `status=${fb.status} ${JSON.stringify(fb.body).slice(0, 200)}`);
  }
}
{
  const r = await j("/api/developer/help/chat", { method: "POST", headers: AUTH, body: JSON.stringify({ message: "" }) });
  ok("POST help/chat with an empty message -> 400", r.status === 400, `status=${r.status}`);
}
ok("GET a conversation that is not yours -> 404",
  (await j("/api/developer/help/conversations/00000000-0000-0000-0000-000000000000", { headers: AUTH })).status === 404);

/* ── cleanup ──────────────────────────────────────────────────────────────── */
if (appId) await sb(`apps?id=eq.${appId}`, { method: "DELETE" });
if (userId) await admin(`users/${userId}`, { method: "DELETE" });

console.log(`\nPASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
