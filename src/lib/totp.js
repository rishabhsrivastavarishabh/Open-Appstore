/**
 * Two-factor authentication primitives, written against the Web Crypto API only
 * so they run unchanged on the Cloudflare Workers edge runtime (no Node APIs).
 *
 *  - RFC 4648 base32 (no padding) for the shared secret
 *  - RFC 6238 TOTP with HMAC-SHA1, 6 digits, 30-second steps
 *  - AES-GCM sealed challenge tokens, so a half-finished login can be carried
 *    between two requests without any server-side session store
 */

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/* ── base32 ─────────────────────────────────────────────────────────────── */

export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/* ── random helpers ─────────────────────────────────────────────────────── */

/** A fresh 20-byte (160-bit) TOTP secret, base32 encoded. */
export function randomSecret(bytes = 20) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base32Encode(buf);
}

/** Ten human-friendly single-use recovery codes, e.g. "4F2C-9K7Q". */
export function randomBackupCodes(count = 10) {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const codes = [];
  for (let i = 0; i < count; i++) {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    let s = "";
    for (let j = 0; j < 8; j++) {
      if (j === 4) s += "-";
      s += alphabet[buf[j] % alphabet.length];
    }
    codes.push(s);
  }
  return codes;
}

/* ── hashing ────────────────────────────────────────────────────────────── */

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time-ish string compare (length leak only). */
export function safeEqual(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/* ── TOTP ───────────────────────────────────────────────────────────────── */

async function hmacSha1(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  return new Uint8Array(sig);
}

/** The 6-digit code for one 30-second counter step. */
export async function totpAt(secretB32, counter, digits = 6) {
  const key = base32Decode(secretB32);
  if (!key.length) return null;
  const msg = new Uint8Array(8);
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    msg[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  const mac = await hmacSha1(key, msg);
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/**
 * Verify a user-supplied code, tolerating clock drift of `window` steps either
 * side (default ±1 step = ±30 s, the usual recommendation).
 */
export async function totpVerify(secretB32, code, window = 1, period = 30) {
  const clean = String(code || "").replace(/\D/g, "");
  if (clean.length !== 6) return false;
  const step = Math.floor(Date.now() / 1000 / period);
  for (let d = -window; d <= window; d++) {
    const expected = await totpAt(secretB32, step + d);
    if (expected && safeEqual(expected, clean)) return true;
  }
  return false;
}

/** The otpauth:// URI that authenticator apps scan. */
export function otpauthUri({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30"
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/* ── sealed challenge tokens ────────────────────────────────────────────── */

async function challengeKey(env) {
  // Derived from a server-only secret, so a sealed challenge cannot be forged
  // or read by the browser. Falls back to the anon key in dev-only setups.
  const material = env.AUTH_CHALLENGE_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || "";
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`oas.2fa.${material}`));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

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

/** Encrypt a small object into an opaque, expiring token. */
export async function sealChallenge(env, payload, ttlSeconds = 300) {
  const key = await challengeKey(env);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const body = new TextEncoder().encode(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  );
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, body));
  const joined = new Uint8Array(iv.length + ct.length);
  joined.set(iv, 0);
  joined.set(ct, iv.length);
  return b64urlEncode(joined);
}

/** Decrypt a token produced by sealChallenge. Returns null if invalid/expired. */
export async function openChallenge(env, token) {
  try {
    const raw = b64urlDecode(token);
    if (raw.length < 13) return null;
    const key = await challengeKey(env);
    const iv = raw.slice(0, 12);
    const ct = raw.slice(12);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    const obj = JSON.parse(new TextDecoder().decode(pt));
    if (!obj?.exp || obj.exp < Math.floor(Date.now() / 1000)) return null;
    return obj;
  } catch {
    return null;
  }
}
