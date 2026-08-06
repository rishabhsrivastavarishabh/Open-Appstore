import { Hono } from "hono";
import { sbAuth, sbSelect, sbWrite, sbAdminWrite, hasServiceRole, serviceKey, bearer } from "../lib/supabase";
import {
  randomSecret,
  randomBackupCodes,
  totpVerify,
  otpauthUri,
  sha256Hex,
  safeEqual,
  sealChallenge,
  openChallenge
} from "../lib/totp.js";
// Bundled into the Worker, NOT fetched from a CDN at runtime: the enrolment page
// used to degrade to "QR code unavailable offline" whenever that request failed.
import QRCode from "qrcode";

const auth = new Hono();

const ISSUER = "Open Appstore";

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** The public origin of this deployment, used to build OAuth redirect URLs. */
function origin(c) {
  try {
    return new URL(c.req.url).origin;
  } catch {
    return "";
  }
}

function sessionOf(data) {
  if (!data?.access_token) return null;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    user: data.user || null
  };
}

/** Best-effort audit row; never blocks or fails a login. */
async function logLogin(c, userId, success, reason) {
  if (!userId || !hasServiceRole(c.env)) return;
  try {
    await sbAdminWrite(c.env, "user_login_history", "POST", {
      user_id: userId,
      success: !!success,
      reason: reason ? String(reason).slice(0, 200) : null,
      ip_address: (c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "").split(",")[0].trim() || null,
      login_time: new Date().toISOString()
    });
  } catch {
    /* audit is advisory only */
  }
}

/** Remember the browser this account signs in from. */
async function rememberDevice(c, userId) {
  if (!userId || !hasServiceRole(c.env)) return;
  try {
    const ua = c.req.header("User-Agent") || "";
    const ip = (c.req.header("CF-Connecting-IP") || "").split(",")[0].trim();
    const hash = await sha256Hex(`${userId}|${ua}|${ip}`);
    const { data } = await sbSelect(
      c.env,
      "user_devices",
      `select=id&user_id=eq.${userId}&device_hash=eq.${hash}&limit=1`
    );
    const now = new Date().toISOString();
    if ((data || []).length) {
      await sbAdminWrite(c.env, "user_devices", "PATCH", { last_login: now }, `id=eq.${data[0].id}`);
    } else {
      await sbAdminWrite(c.env, "user_devices", "POST", {
        user_id: userId,
        device_hash: hash,
        device_name: deviceName(ua),
        user_agent: ua.slice(0, 400),
        ip_address: ip || null,
        last_login: now
      });
    }
  } catch {
    /* advisory */
  }
}

function deviceName(ua) {
  const s = String(ua || "");
  const os = /Android/i.test(s)
    ? "Android"
    : /iPhone|iPad|iOS/i.test(s)
      ? "iOS"
      : /Windows/i.test(s)
        ? "Windows"
        : /Mac OS X|Macintosh/i.test(s)
          ? "macOS"
          : /Linux/i.test(s)
            ? "Linux"
            : "Unknown OS";
  const br = /Edg\//i.test(s)
    ? "Edge"
    : /OPR\//i.test(s)
      ? "Opera"
      : /Chrome\//i.test(s)
        ? "Chrome"
        : /Firefox\//i.test(s)
          ? "Firefox"
          : /Safari\//i.test(s)
            ? "Safari"
            : "Browser";
  return `${br} on ${os}`.slice(0, 80);
}

/** Read the user's 2FA row with the service key (RLS-proof, server only). */
/**
 * Read a table with the service key on behalf of an already-authenticated user.
 * The audit tables have no SELECT policy for `authenticated`, so a user-token
 * read comes back empty; the caller has already proven who they are.
 */
async function adminSelect(env, table, query) {
  const key = serviceKey(env);
  if (!key) return [];
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (!res.ok) return [];
    return (await res.json()) || [];
  } catch {
    return [];
  }
}

async function read2fa(env, userId) {
  const q = `select=id,user_id,totp_secret,backup_codes,enabled&user_id=eq.${userId}&limit=1`;
  const key = serviceKey(env);
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/user_2fa?${q}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return (rows || [])[0] || null;
  } catch {
    return null;
  }
}

async function requireUser(c) {
  const token = bearer(c.req.header("Authorization"));
  if (!token) return { error: c.json({ success: false, error: "Sign in first" }, 401) };
  const { data: user, error } = await sbAuth(c.env, "user", { token });
  if (error || !user?.id) return { error: c.json({ success: false, error: error || "Invalid session" }, 401) };
  return { user, token };
}
auth.post("/auth/signup", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) return c.json({ success: false, error: "Email and password are required" }, 400);
  if (password.length < 8) return c.json({ success: false, error: "Password must be at least 8 characters" }, 400);
  const { data, error, status } = await sbAuth(c.env, "signup", {
    method: "POST",
    body: {
      email,
      password,
      data: {
        developer_name: body.developer_name || null,
        full_name: body.full_name || null
      }
    }
  });
  if (error) return c.json({ success: false, error }, status || 400);
  const session = data?.access_token ? data : data?.session || null;
  return c.json({
    success: true,
    needs_confirmation: !session?.access_token,
    message: session?.access_token ? "Account created and signed in." : "Account created. Check your inbox and confirm your email address, then sign in.",
    session: session?.access_token ? {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      user: session.user || data?.user || null
    } : null
  });
});
/**
 * POST /api/auth/login — email + password.
 *
 * When the account has two-factor authentication switched on we do NOT hand the
 * session to the browser. Instead the session is sealed into an encrypted,
 * 5-minute challenge token that only this server can open, and the client must
 * finish with POST /api/auth/2fa/verify.
 */
auth.post("/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) return c.json({ success: false, error: "Email and password are required" }, 400);

  const { data, error, status } = await sbAuth(c.env, "token?grant_type=password", {
    method: "POST",
    body: { email, password }
  });
  if (error) return c.json({ success: false, error }, status || 401);

  const session = sessionOf(data);
  const userId = data?.user?.id;

  const tfa = userId ? await read2fa(c.env, userId) : null;
  if (tfa?.enabled && tfa.totp_secret) {
    await logLogin(c, userId, false, "password ok, awaiting 2FA");
    const challenge = await sealChallenge(
      c.env,
      { uid: userId, email, rt: session.refresh_token },
      300
    );
    return c.json({
      success: true,
      requires_2fa: true,
      challenge,
      message: "Enter the 6-digit code from your authenticator app."
    });
  }

  await logLogin(c, userId, true, "password");
  await rememberDevice(c, userId);
  return c.json({ success: true, requires_2fa: false, session });
});

/* ── Google sign-in ──────────────────────────────────────────────────────── */

/**
 * GET /api/auth/google — start the Google OAuth dance.
 *
 * Supabase GoTrue owns the client id/secret (set in Dashboard → Authentication →
 * Providers → Google), so no Google credential ever reaches this Worker or the
 * browser. GoTrue redirects back to /auth/callback with the session in the URL
 * fragment, which the callback page reads and stores.
 */
auth.get("/auth/google", (c) => {
  const next = c.req.query("next") || "/developer";
  const redirect = `${origin(c)}/auth/callback?next=${encodeURIComponent(next)}`;
  const url =
    `${c.env.SUPABASE_URL}/auth/v1/authorize?provider=google` +
    `&redirect_to=${encodeURIComponent(redirect)}`;
  return c.redirect(url, 302);
});

/** POST /api/auth/oauth/exchange — swap a PKCE ?code= for a session. */
auth.post("/auth/oauth/exchange", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const code = String(body.code || "").trim();
  if (!code) return c.json({ success: false, error: "Authorization code missing" }, 400);
  const { data, error, status } = await sbAuth(c.env, "token?grant_type=pkce", {
    method: "POST",
    body: { auth_code: code }
  });
  if (error) return c.json({ success: false, error }, status || 400);
  const session = sessionOf(data);
  if (!session) return c.json({ success: false, error: "No session returned" }, 400);
  await logLogin(c, data?.user?.id, true, "google");
  await rememberDevice(c, data?.user?.id);
  return c.json({ success: true, session });
});

/* ── Two-factor authentication ───────────────────────────────────────────── */

/** GET /api/auth/2fa — is 2FA armed for the signed-in user? */
auth.get("/auth/2fa", async (c) => {
  const { user, error } = await requireUser(c);
  if (error) return error;
  const row = await read2fa(c.env, user.id);
  return c.json({
    success: true,
    enabled: !!row?.enabled,
    pending: !!row && !row.enabled && !!row.totp_secret,
    backup_codes_left: Array.isArray(row?.backup_codes) ? row.backup_codes.length : 0
  });
});

/**
 * POST /api/auth/2fa/setup — mint a secret and return the otpauth:// URI.
 * Nothing is enforced until /2fa/enable confirms the user can read a code.
 */
auth.post("/auth/2fa/setup", async (c) => {
  const { user, error } = await requireUser(c);
  if (error) return error;
  if (!hasServiceRole(c.env))
    return c.json(
      { success: false, error: "Two-factor setup needs the service-role key configured on the server." },
      501
    );

  const existing = await read2fa(c.env, user.id);
  if (existing?.enabled)
    return c.json({ success: false, error: "Two-factor authentication is already switched on." }, 409);

  const secret = randomSecret();
  const payload = { user_id: user.id, totp_secret: secret, enabled: false, updated_at: new Date().toISOString() };
  const res = existing
    ? await sbAdminWrite(c.env, "user_2fa", "PATCH", payload, `id=eq.${existing.id}`)
    : await sbAdminWrite(c.env, "user_2fa", "POST", payload);
  if (res.error) return c.json({ success: false, error: res.error }, res.status || 400);

  const uri = otpauthUri({ secret, account: user.email, issuer: ISSUER });

  // Render the QR on the server so the client never needs a third-party script.
  let qrSvg = null;
  try {
    qrSvg = await QRCode.toString(uri, {
      type: "svg",
      margin: 1,
      width: 200,
      errorCorrectionLevel: "M",
      color: { dark: "#0b1020ff", light: "#ffffffff" }
    });
  } catch {
    qrSvg = null; // the client falls back to showing the typed key
  }

  return c.json({
    success: true,
    secret,
    otpauth_uri: uri,
    qr_svg: qrSvg,
    issuer: ISSUER,
    account: user.email
  });
});

/** POST /api/auth/2fa/enable — confirm a code, arm 2FA, return backup codes. */
auth.post("/auth/2fa/enable", async (c) => {
  const { user, error } = await requireUser(c);
  if (error) return error;
  const body = await c.req.json().catch(() => ({}));
  const row = await read2fa(c.env, user.id);
  if (!row?.totp_secret) return c.json({ success: false, error: "Run setup first" }, 400);
  if (row.enabled) return c.json({ success: false, error: "Already enabled" }, 409);

  const ok = await totpVerify(row.totp_secret, body.code);
  if (!ok)
    return c.json(
      { success: false, error: "That code did not match. Check your device clock and try the current code." },
      401
    );

  const codes = randomBackupCodes(10);
  const hashed = [];
  for (const code of codes) hashed.push(await sha256Hex(code));
  const res = await sbAdminWrite(
    c.env,
    "user_2fa",
    "PATCH",
    { enabled: true, backup_codes: hashed, updated_at: new Date().toISOString() },
    `id=eq.${row.id}`
  );
  if (res.error) return c.json({ success: false, error: res.error }, res.status || 400);

  await logLogin(c, user.id, true, "2fa enabled");
  return c.json({
    success: true,
    enabled: true,
    backup_codes: codes,
    message: "Two-factor authentication is on. Store these backup codes somewhere safe — they are shown once."
  });
});

/** POST /api/auth/2fa/disable — needs a valid code or backup code. */
auth.post("/auth/2fa/disable", async (c) => {
  const { user, error } = await requireUser(c);
  if (error) return error;
  const body = await c.req.json().catch(() => ({}));
  const row = await read2fa(c.env, user.id);
  if (!row?.enabled) return c.json({ success: false, error: "Two-factor authentication is not on." }, 400);

  const code = String(body.code || "").trim();
  let ok = await totpVerify(row.totp_secret, code);
  if (!ok) ok = await consumeBackupCode(c.env, row, code);
  if (!ok) return c.json({ success: false, error: "Enter a valid authenticator or backup code." }, 401);

  const res = await sbAdminWrite(
    c.env,
    "user_2fa",
    "PATCH",
    { enabled: false, totp_secret: null, backup_codes: null, updated_at: new Date().toISOString() },
    `id=eq.${row.id}`
  );
  if (res.error) return c.json({ success: false, error: res.error }, res.status || 400);
  await logLogin(c, user.id, true, "2fa disabled");
  return c.json({ success: true, enabled: false, message: "Two-factor authentication switched off." });
});

/** POST /api/auth/2fa/verify — finish a login that was gated by 2FA. */
auth.post("/auth/2fa/verify", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const challenge = String(body.challenge || "");
  const code = String(body.code || "").trim();
  if (!challenge || !code)
    return c.json({ success: false, error: "Challenge and code are required" }, 400);

  const opened = await openChallenge(c.env, challenge);
  if (!opened?.uid || !opened?.rt)
    return c.json({ success: false, error: "This sign-in attempt expired. Start again." }, 401);

  const row = await read2fa(c.env, opened.uid);
  if (!row?.enabled || !row.totp_secret)
    return c.json({ success: false, error: "Two-factor authentication is not configured." }, 400);

  let usedBackup = false;
  let ok = await totpVerify(row.totp_secret, code);
  if (!ok) {
    ok = await consumeBackupCode(c.env, row, code);
    usedBackup = ok;
  }
  if (!ok) {
    await logLogin(c, opened.uid, false, "2fa code rejected");
    return c.json({ success: false, error: "That code is not right. Try the current one." }, 401);
  }

  // Trade the sealed refresh token for a live session.
  const { data, error, status } = await sbAuth(c.env, "token?grant_type=refresh_token", {
    method: "POST",
    body: { refresh_token: opened.rt }
  });
  if (error) return c.json({ success: false, error }, status || 401);

  await logLogin(c, opened.uid, true, usedBackup ? "2fa backup code" : "2fa totp");
  await rememberDevice(c, opened.uid);
  return c.json({
    success: true,
    session: sessionOf(data),
    used_backup_code: usedBackup,
    backup_codes_left: Array.isArray(row.backup_codes) ? Math.max(0, row.backup_codes.length - (usedBackup ? 1 : 0)) : 0
  });
});

/** Burn a single-use backup code. Returns true when one matched. */
async function consumeBackupCode(env, row, code) {
  const list = Array.isArray(row.backup_codes) ? row.backup_codes : [];
  if (!list.length) return false;
  const normalised = String(code || "").toUpperCase().replace(/\s/g, "");
  const withDash = normalised.length === 8 && !normalised.includes("-")
    ? `${normalised.slice(0, 4)}-${normalised.slice(4)}`
    : normalised;
  const candidates = [await sha256Hex(normalised), await sha256Hex(withDash)];
  const idx = list.findIndex((h) => candidates.some((cand) => safeEqual(h, cand)));
  if (idx < 0) return false;
  const remaining = list.filter((_, i) => i !== idx);
  await sbAdminWrite(
    env,
    "user_2fa",
    "PATCH",
    { backup_codes: remaining, updated_at: new Date().toISOString() },
    `id=eq.${row.id}`
  );
  return true;
}

/** GET /api/auth/sessions — recent sign-ins and known devices. */
auth.get("/auth/sessions", async (c) => {
  const { user, token, error } = await requireUser(c);
  if (error) return error;
  const useAdmin = hasServiceRole(c.env);
  const devQuery = `select=id,device_name,ip_address,last_login,created_at&user_id=eq.${user.id}&order=last_login.desc.nullslast&limit=10`;
  const logQuery = `select=id,login_time,ip_address,success,reason&user_id=eq.${user.id}&order=login_time.desc&limit=15`;
  const [devices, history] = await Promise.all([
    useAdmin
      ? adminSelect(c.env, "user_devices", devQuery)
      : sbSelect(c.env, "user_devices", devQuery, token).then((r) => r.data || []),
    useAdmin
      ? adminSelect(c.env, "user_login_history", logQuery)
      : sbSelect(c.env, "user_login_history", logQuery, token).then((r) => r.data || [])
  ]);
  return c.json({ success: true, devices, history });
});
auth.post("/auth/reset-password", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) return c.json({ success: false, error: "Email is required" }, 400);
  const { error, status } = await sbAuth(c.env, "recover", { method: "POST", body: { email } });
  if (error) return c.json({ success: false, error }, status || 400);
  return c.json({ success: true, message: "Password reset email sent." });
});
auth.post("/auth/refresh", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const refresh_token = String(body.refresh_token || "");
  if (!refresh_token) return c.json({ success: false, error: "refresh_token required" }, 400);
  const { data, error, status } = await sbAuth(c.env, "token?grant_type=refresh_token", {
    method: "POST",
    body: { refresh_token }
  });
  if (error) return c.json({ success: false, error }, status || 401);
  return c.json({
    success: true,
    session: {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      user: data.user
    }
  });
});
auth.post("/auth/logout", async (c) => {
  const token = bearer(c.req.header("Authorization"));
  if (token) await sbAuth(c.env, "logout", { method: "POST", token });
  return c.json({ success: true });
});
auth.get("/me", async (c) => {
  const token = bearer(c.req.header("Authorization"));
  if (!token) return c.json({ success: false, error: "Not authenticated" }, 401);
  const { data: user, error, status } = await sbAuth(c.env, "user", { token });
  if (error) return c.json({ success: false, error }, status || 401);
  const [devRes, profileRes] = await Promise.all([
    sbSelect(
      c.env,
      "developers",
      `select=*&user_id=eq.${user.id}&limit=1`,
      token
    ),
    sbSelect(c.env, "user_profiles", `select=*&id=eq.${user.id}&limit=1`, token)
  ]);
  return c.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      email_confirmed_at: user.email_confirmed_at,
      metadata: user.user_metadata || {}
    },
    developer: (devRes.data || [])[0] || null,
    profile: (profileRes.data || [])[0] || null
  });
});
auth.post("/developer/register", async (c) => {
  const token = bearer(c.req.header("Authorization"));
  if (!token) return c.json({ success: false, error: "Sign in first" }, 401);
  const { data: user, error: uErr } = await sbAuth(c.env, "user", { token });
  if (uErr || !user?.id) return c.json({ success: false, error: uErr || "Invalid session" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const developer_name = String(body.developer_name || "").trim();
  if (!developer_name) return c.json({ success: false, error: "Developer / studio name is required" }, 400);
  const payload = {
    developer_name,
    company_name: body.company_name || null,
    description: body.description || null,
    website: body.website || null,
    email: body.email || user.email,
    avatar_url: body.avatar_url || body.logo_url || null
  };
  const { data: existing } = await sbSelect(
    c.env,
    "developers",
    `select=id&user_id=eq.${user.id}&limit=1`,
    token
  );
  if ((existing || []).length) {
    const { data: data2, error: error2, status: status2 } = await sbWrite(
      c.env,
      "developers",
      "PATCH",
      payload,
      `id=eq.${existing[0].id}`,
      token
    );
    if (error2) return c.json({ success: false, error: error2 }, status2 || 400);
    return c.json({ success: true, developer: (data2 || [])[0] || null, updated: true });
  }
  const { data, error, status } = await sbWrite(
    c.env,
    "developers",
    "POST",
    { ...payload, user_id: user.id },
    "",
    token
  );
  if (error) {
    return c.json(
      {
        success: false,
        error,
        hint: error.includes("row-level security") ? "The developers table blocks inserts for this role. Add an RLS INSERT policy: USING/WITH CHECK (user_id = auth.uid())." : void 0
      },
      status || 400
    );
  }
  return c.json({ success: true, developer: (data || [])[0] || null, created: true });
});
var api_auth_default = auth;
export {
  api_auth_default as default
};
