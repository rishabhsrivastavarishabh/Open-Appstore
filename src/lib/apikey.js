/**
 * Developer API keys for the public `/api/v1` surface.
 *
 * Storage: there is no `developer_api_keys` table and PostgREST cannot run DDL,
 * so key records live in the user's GoTrue `app_metadata.oas_api_keys`. That
 * field is writable only with the service-role key (never by the user's own
 * JWT), which makes it a safe place for key metadata. A PUT to
 * /auth/v1/admin/users/:id *merges* app_metadata, so `provider`/`providers` are
 * preserved. See migrations/0002_developer_api_keys.sql for the optional
 * relational version of the same data.
 *
 * Format: `dev_<b64url(payload‖sig)>`
 *   payload = 16-byte user uuid ‖ 8-byte key id ‖ 4-byte issued-at (BE seconds)
 *   sig     = first 16 bytes of HMAC-SHA256(server secret, payload)
 *
 * Why self-describing rather than an opaque random string: verifying an opaque
 * key would mean scanning every user looking for a matching hash, which the
 * admin API cannot index. Embedding the user id lets us verify the signature
 * with zero network calls, then do exactly one lookup to confirm the key has
 * not been revoked. The HMAC means a forged key is rejected before any I/O.
 *
 * We still store a SHA-256 hash of the full key: it is what proves a presented
 * key matches the stored record, so a stolen metadata dump cannot be replayed.
 */

const KEY_PREFIX = "dev_";
const META_FIELD = "oas_api_keys";
const MAX_KEYS = 10;

/* ── byte helpers ───────────────────────────────────────────────────────── */

function b64urlEncode(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** uuid string -> 16 bytes. Returns null when the input is not a uuid. */
function uuidToBytes(uuid) {
  const clean = String(uuid || "").replace(/-/g, "");
  if (clean.length !== 32 || /[^0-9a-f]/i.test(clean)) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 16 bytes -> canonical uuid string. */
function bytesToUuid(bytes) {
  const h = hex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Constant-time comparison so signature checks cannot be timed. */
function safeEqualBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ── crypto ─────────────────────────────────────────────────────────────── */

/**
 * The signing secret. Derived from a server-only value so an API key cannot be
 * forged by anyone who has not seen the secret. Mirrors the derivation used for
 * 2FA challenge sealing, but with a distinct label so the two key spaces never
 * overlap.
 */
async function signingKey(env) {
  const material =
    env.AUTH_CHALLENGE_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || "";
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`oas.apikey.${material}`));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(env, payload) {
  const key = await signingKey(env);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, payload));
  return sig.slice(0, 16);
}

/** SHA-256 of the presented key string, hex encoded. */
export async function hashKey(keyString) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyString));
  return hex(new Uint8Array(digest));
}

/* ── mint / parse ───────────────────────────────────────────────────────── */

/**
 * Create a brand-new API key for a user.
 * Returns { key, record } — `key` is the only time the full secret exists;
 * `record` is what gets persisted (no secret, only its hash).
 */
export async function mintKey(env, userId, name) {
  const userBytes = uuidToBytes(userId);
  if (!userBytes) throw new Error("mintKey: userId must be a uuid");

  const keyId = new Uint8Array(8);
  crypto.getRandomValues(keyId);

  const iat = Math.floor(Date.now() / 1000);
  const payload = new Uint8Array(28);
  payload.set(userBytes, 0);
  payload.set(keyId, 16);
  // Big-endian 32-bit issued-at.
  payload[24] = (iat >>> 24) & 0xff;
  payload[25] = (iat >>> 16) & 0xff;
  payload[26] = (iat >>> 8) & 0xff;
  payload[27] = iat & 0xff;

  const sig = await sign(env, payload);
  const joined = new Uint8Array(payload.length + sig.length);
  joined.set(payload, 0);
  joined.set(sig, payload.length);

  const key = KEY_PREFIX + b64urlEncode(joined);
  const record = {
    id: hex(keyId),
    name: String(name || "API key").slice(0, 60),
    // Shown in the UI so a developer can tell two keys apart without the secret.
    prefix: key.slice(0, 12),
    hash: await hashKey(key),
    created_at: new Date(iat * 1000).toISOString(),
    last_used_at: null,
    revoked: false
  };
  return { key, record };
}

/**
 * Decode and signature-check a key string. Purely local — no network.
 * Returns { userId, keyId } or null when malformed / forged.
 */
export async function parseKey(env, keyString) {
  const s = String(keyString || "").trim();
  if (!s.startsWith(KEY_PREFIX)) return null;
  let raw;
  try {
    raw = b64urlDecode(s.slice(KEY_PREFIX.length));
  } catch {
    return null;
  }
  if (raw.length !== 44) return null;
  const payload = raw.slice(0, 28);
  const sig = raw.slice(28);
  const expect = await sign(env, payload);
  if (!safeEqualBytes(sig, expect)) return null;
  return {
    userId: bytesToUuid(payload.slice(0, 16)),
    keyId: hex(payload.slice(16, 24))
  };
}

/* ── persistence (GoTrue admin app_metadata) ────────────────────────────── */

function adminHeaders(env) {
  const k = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  return { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" };
}

async function adminUser(env, userId) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: adminHeaders(env)
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function writeKeys(env, userId, keys) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: adminHeaders(env),
    // A PUT merges app_metadata rather than replacing it, so `provider` and
    // `providers` survive untouched.
    body: JSON.stringify({ app_metadata: { [META_FIELD]: keys } })
  });
  return res.ok;
}

function readKeys(user) {
  const list = user?.app_metadata?.[META_FIELD];
  return Array.isArray(list) ? list : [];
}

/** All key records for a user, newest first, secrets never included. */
export async function listKeys(env, userId) {
  const user = await adminUser(env, userId);
  if (!user) return [];
  return readKeys(user)
    .filter((k) => !k.revoked)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

/** Mint + persist. Returns { key, record } or { error }. */
export async function createKey(env, userId, name) {
  const user = await adminUser(env, userId);
  if (!user) return { error: "Could not load your account" };
  const existing = readKeys(user).filter((k) => !k.revoked);
  if (existing.length >= MAX_KEYS) {
    return { error: `You already have ${MAX_KEYS} active keys. Revoke one first.` };
  }
  const { key, record } = await mintKey(env, userId, name);
  const ok = await writeKeys(env, userId, [...readKeys(user), record]);
  if (!ok) return { error: "Could not save the key" };
  return { key, record };
}

/** Hard-delete a key record. Returns true when something was removed. */
export async function revokeKey(env, userId, keyId) {
  const user = await adminUser(env, userId);
  if (!user) return false;
  const all = readKeys(user);
  const next = all.filter((k) => k.id !== keyId);
  if (next.length === all.length) return false;
  return writeKeys(env, userId, next);
}

/**
 * Full authentication for an inbound `dev_…` key.
 *
 * Signature is checked first (no I/O for a forged key), then exactly one
 * lookup confirms the key still exists and its hash matches. The stored hash
 * check is what makes a revoked-then-reissued key id unusable.
 *
 * Returns { userId, keyId, record } or { error, code }.
 */
export async function authenticateKey(env, keyString) {
  const parsed = await parseKey(env, keyString);
  if (!parsed) return { error: "The API key is malformed or has an invalid signature.", code: "invalid_api_key" };

  const user = await adminUser(env, parsed.userId);
  if (!user) return { error: "The account for this API key no longer exists.", code: "invalid_api_key" };

  const record = readKeys(user).find((k) => k.id === parsed.keyId);
  if (!record || record.revoked) {
    return { error: "This API key has been revoked.", code: "revoked_api_key" };
  }
  const presented = await hashKey(String(keyString).trim());
  if (record.hash && record.hash !== presented) {
    return { error: "The API key is malformed or has an invalid signature.", code: "invalid_api_key" };
  }
  return { userId: parsed.userId, keyId: parsed.keyId, record, email: user.email };
}

/**
 * Best-effort "last used" stamp. Never awaited on the request path by callers
 * that care about latency, and never allowed to fail a request: an API key that
 * works must not stop working because a bookkeeping write failed.
 */
export async function touchKey(env, userId, keyId) {
  try {
    const user = await adminUser(env, userId);
    if (!user) return;
    const all = readKeys(user);
    const idx = all.findIndex((k) => k.id === keyId);
    if (idx < 0) return;
    // Coarse throttle: only rewrite when the stamp is more than a minute stale,
    // so a busy key does not generate an admin write per request.
    const prev = all[idx].last_used_at ? Date.parse(all[idx].last_used_at) : 0;
    if (Date.now() - prev < 60_000) return;
    all[idx] = { ...all[idx], last_used_at: new Date().toISOString() };
    await writeKeys(env, userId, all);
  } catch {
    /* ignore */
  }
}
