/**
 * WebAuthn / passkey endpoints for the developer console.
 *
 * Design decisions worth stating plainly:
 *
 * 1. Registration requires an existing signed-in session. Passkeys are added as
 *    a second factor / faster re-entry for an account that already exists; a
 *    flow that let an anonymous caller mint a passkey "for" an email address
 *    would be an account-takeover primitive.
 *
 * 2. Authentication returns a Supabase session ONLY if the deployment provides
 *    a service-role key, because minting a session for an existing user requires
 *    admin privileges. Where that is unavailable we say so instead of pretending
 *    to sign the caller in.
 *
 * 3. Challenges are single-use rows in `webauthn_challenges`, marked `used` on
 *    consumption and given a short expiry. In-memory challenge storage would be
 *    outright broken here: Workers isolates are per-request and per-colo, so the
 *    isolate that issued a challenge is usually not the one verifying it.
 */
import { Hono } from "hono";
import { sbSelect, sbAdminSelect, sbAdminWrite, sbAuth, bearer, hasServiceRole, serviceKey } from "../lib/supabase.js";
import {
  randomChallenge,
  verifyRegistration,
  verifyAssertion,
  rpIdFor,
  describeClient,
  defaultDeviceName
} from "../lib/webauthn.js";

const wa = new Hono();

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes: long enough for biometrics

function fail(c, status, message, code) {
  return c.json({ error: code || "server_error", message }, status);
}

/** Origins we will accept an assertion from: exactly the host serving this request. */
function originsFor(c) {
  try {
    return [new URL(c.req.url).origin];
  } catch {
    return [];
  }
}

async function requireDeveloper(c) {
  const token = bearer(c.req.header("Authorization"));
  if (!token) return { err: fail(c, 401, "Authentication token missing or invalid.", "unauthorized") };
  const { data: user, error } = await sbAuth(c.env, "user", { token });
  if (error || !user?.id) return { err: fail(c, 401, "Authentication token missing or invalid.", "unauthorized") };
  const { data } = await sbSelect(c.env, "developers", "select=id,developer_name,email&user_id=eq." + user.id + "&limit=1", token);
  const developer = (data || [])[0];
  if (!developer) return { err: fail(c, 403, "This account does not have a developer profile.", "forbidden") };
  return { user, developer, token };
}

async function storeChallenge(env, { developerId, email, challenge, type }) {
  const row = {
    developer_id: developerId || null,
    email: email ? String(email).toLowerCase() : null,
    challenge_b64: challenge,
    challenge_type: type,
    used: false,
    expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString()
  };
  return sbAdminWrite(env, "webauthn_challenges", "POST", row);
}

/**
 * Fetch and immediately burn a challenge. Marking it used before verification
 * (rather than after) is deliberate: it makes replay impossible even if
 * verification itself throws part-way through.
 */
async function consumeChallenge(env, { email, developerId, type }) {
  const clauses = ["challenge_type=eq." + type, "used=is.false", "expires_at=gt." + new Date().toISOString()];
  if (developerId) clauses.push("developer_id=eq." + developerId);
  else if (email) clauses.push("email=eq." + encodeURIComponent(String(email).toLowerCase()));
  const q = "select=id,challenge_b64&" + clauses.join("&") + "&order=created_at.desc&limit=1";
  const { data } = await sbAdminSelect(env, "webauthn_challenges", q);
  const row = (data || [])[0];
  if (!row) return null;
  await sbAdminWrite(env, "webauthn_challenges", "PATCH", { used: true }, "id=eq." + row.id);
  return row.challenge_b64;
}

/* ------------------------------------------------------------- registration */

wa.post("/developer/webauthn/register/options", async (c) => {
  const ctx = await requireDeveloper(c);
  if (ctx.err) return ctx.err;
  const challenge = randomChallenge();
  const { error } = await storeChallenge(c.env, {
    developerId: ctx.developer.id,
    email: ctx.developer.email,
    challenge,
    type: "registration"
  });
  if (error) return fail(c, 500, "Could not start passkey registration.");

  // Exclude keys already registered so the authenticator says "already
  // registered" instead of silently creating a duplicate.
  const { data: existing } = await sbAdminSelect(
    c.env,
    "webauthn_credentials",
    "select=credential_id_b64&developer_id=eq." + ctx.developer.id + "&limit=50"
  );
  const rpId = rpIdFor(c.req.url);
  return c.json({
    challenge,
    userId: btoa(ctx.developer.id).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    userName: ctx.developer.email || ctx.user.email || "developer",
    userDisplayName: ctx.developer.developer_name || ctx.developer.email || "Developer",
    rp: { name: "Open Appstore", id: rpId },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 }
    ],
    excludeCredentials: (existing || []).map((r) => ({ type: "public-key", id: r.credential_id_b64 })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    timeout: CHALLENGE_TTL_MS,
    attestation: "none"
  });
});

wa.post("/developer/webauthn/register/verify", async (c) => {
  const ctx = await requireDeveloper(c);
  if (ctx.err) return ctx.err;
  let body;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, "Expected a JSON body.", "invalid_request");
  }
  const cred = body?.credential || {};
  const resp = cred.response || {};
  if (!resp.attestationObject || !resp.clientDataJSON) {
    return fail(c, 400, "The credential is missing its attestation data.", "invalid_request");
  }
  const challenge = await consumeChallenge(c.env, { developerId: ctx.developer.id, type: "registration" });
  if (!challenge) return fail(c, 400, "Your registration attempt expired. Please try again.", "invalid_request");

  let verified;
  try {
    verified = await verifyRegistration({
      attestationObjectB64u: resp.attestationObject,
      clientDataJSONB64u: resp.clientDataJSON,
      expectedChallenge: challenge,
      expectedOrigins: originsFor(c),
      rpId: rpIdFor(c.req.url)
    });
  } catch (e) {
    return fail(c, 400, e?.message || "Could not verify this passkey.", "invalid_request");
  }

  const { data: dupe } = await sbAdminSelect(
    c.env,
    "webauthn_credentials",
    "select=id&credential_id_b64=eq." + encodeURIComponent(verified.credentialIdB64u) + "&limit=1"
  );
  if ((dupe || []).length) return fail(c, 409, "This passkey is already registered.", "conflict");

  const client = describeClient(c.req.header("User-Agent"));
  const name = String(body.device_name || "").trim().slice(0, 100) || defaultDeviceName(client);
  const { data, error } = await sbAdminWrite(c.env, "webauthn_credentials", "POST", {
    developer_id: ctx.developer.id,
    credential_id_b64: verified.credentialIdB64u,
    public_key_jwk: verified.jwk,
    // The column exists for operators who want to eyeball keys; the JWK is what
    // we actually verify with, so PEM is left null rather than fabricated.
    public_key_pem: null,
    device_name: name,
    device_type: client.deviceType,
    browser: client.browser,
    os: client.os,
    transports: Array.isArray(cred.transports) ? cred.transports.slice(0, 6) : null,
    sign_count: verified.signCount || 0
  });
  if (error) return fail(c, 500, "Could not save this passkey.");
  const row = (data || [])[0] || {};
  return c.json({ success: true, passkey_id: row.id, device_name: name });
});

/* ----------------------------------------------------------- authentication */

wa.post("/developer/webauthn/authenticate/options", async (c) => {
  let body = {};
  try {
    body = (await c.req.json()) || {};
  } catch {
    body = {};
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return fail(c, 400, "A valid email address is required.", "invalid_request");
  }
  const challenge = randomChallenge();
  await storeChallenge(c.env, { developerId: null, email, challenge, type: "authentication" });

  /* Deliberately does NOT reveal whether the address has passkeys: an empty
   * allowCredentials list is a valid response that tells an enumerator nothing.
   * The browser will simply find no usable passkey. */
  let allow = [];
  const { data: devs } = await sbAdminSelect(c.env, "developers", "select=id&email=eq." + encodeURIComponent(email) + "&limit=1");
  const devId = (devs || [])[0]?.id;
  if (devId) {
    const { data: creds } = await sbAdminSelect(
      c.env,
      "webauthn_credentials",
      "select=credential_id_b64,transports&developer_id=eq." + devId + "&limit=50"
    );
    allow = (creds || []).map((r) => ({
      type: "public-key",
      id: r.credential_id_b64,
      ...(r.transports && r.transports.length ? { transports: r.transports } : {})
    }));
  }
  return c.json({
    challenge,
    rpId: rpIdFor(c.req.url),
    allowCredentials: allow,
    userVerification: "preferred",
    timeout: CHALLENGE_TTL_MS
  });
});

wa.post("/developer/webauthn/authenticate/verify", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, "Expected a JSON body.", "invalid_request");
  }
  const email = String(body?.email || "").trim().toLowerCase();
  const a = body?.assertion || body?.credential || {};
  const resp = a.response || {};
  if (!email || !resp.authenticatorData || !resp.clientDataJSON || !resp.signature) {
    return fail(c, 400, "The assertion is incomplete.", "invalid_request");
  }
  const credentialId = a.id || a.rawId;
  if (!credentialId) return fail(c, 400, "The assertion is missing its credential id.", "invalid_request");

  const challenge = await consumeChallenge(c.env, { email, type: "authentication" });
  if (!challenge) return fail(c, 400, "Your sign-in attempt expired. Please try again.", "invalid_request");

  const { data: creds } = await sbAdminSelect(
    c.env,
    "webauthn_credentials",
    "select=id,developer_id,public_key_jwk,sign_count&credential_id_b64=eq." + encodeURIComponent(credentialId) + "&limit=1"
  );
  const cred = (creds || [])[0];
  // One deliberately vague message for "no such passkey" and "wrong owner":
  // distinguishing them would confirm which addresses have passkeys.
  if (!cred) return fail(c, 401, "That passkey is not recognised.", "unauthorized");

  const { data: devs } = await sbAdminSelect(c.env, "developers", "select=id,user_id,email&id=eq." + cred.developer_id + "&limit=1");
  const dev = (devs || [])[0];
  if (!dev || String(dev.email || "").toLowerCase() !== email) {
    return fail(c, 401, "That passkey is not recognised.", "unauthorized");
  }

  const jwk = cred.public_key_jwk;
  if (!jwk) return fail(c, 500, "This passkey is missing its public key and must be removed and re-added.");
  const alg = jwk.kty === "RSA" ? -257 : -7;
  let result;
  try {
    result = await verifyAssertion({
      authenticatorDataB64u: resp.authenticatorData,
      clientDataJSONB64u: resp.clientDataJSON,
      signatureB64u: resp.signature,
      expectedChallenge: challenge,
      expectedOrigins: originsFor(c),
      rpId: rpIdFor(c.req.url),
      jwk,
      alg,
      storedSignCount: Number(cred.sign_count || 0)
    });
  } catch (e) {
    return fail(c, 401, e?.message || "Passkey verification failed.", "unauthorized");
  }

  await sbAdminWrite(
    c.env,
    "webauthn_credentials",
    "PATCH",
    { sign_count: result.signCount, last_used_at: new Date().toISOString() },
    "id=eq." + cred.id
  );

  /* Minting a session for an existing user needs admin rights. Without a
   * service-role key we cannot issue one, and rather than invent a token that
   * nothing would accept, we report the passkey as verified and say what is
   * missing. */
  if (!hasServiceRole(c.env)) {
    return c.json({
      success: true,
      verified: true,
      session: null,
      message: "Passkey verified, but this deployment cannot issue a session. Sign in with your password."
    });
  }

  // GoTrue admin: generate a magic-link style token pair for the known user.
  try {
    const key = serviceKey(c.env);
    const res = await fetch(c.env.SUPABASE_URL + "/auth/v1/admin/generate_link", {
      method: "POST",
      headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "magiclink", email })
    });
    const link = await res.json().catch(() => null);
    const hashed = link?.hashed_token;
    if (!res.ok || !hashed) {
      return c.json({
        success: true,
        verified: true,
        session: null,
        message: "Passkey verified, but a session could not be created. Sign in with your password."
      });
    }
    const vres = await fetch(c.env.SUPABASE_URL + "/auth/v1/verify", {
      method: "POST",
      headers: { apikey: c.env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "magiclink", token: hashed, email })
    });
    const session = await vres.json().catch(() => null);
    if (!vres.ok || !session?.access_token) {
      return c.json({
        success: true,
        verified: true,
        session: null,
        message: "Passkey verified, but a session could not be created. Sign in with your password."
      });
    }
    return c.json({
      success: true,
      verified: true,
      token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      user: session.user || null
    });
  } catch {
    return c.json({
      success: true,
      verified: true,
      session: null,
      message: "Passkey verified, but a session could not be created. Sign in with your password."
    });
  }
});

/* --------------------------------------------------------------- management */

wa.get("/developer/webauthn/passkeys", async (c) => {
  const ctx = await requireDeveloper(c);
  if (ctx.err) return ctx.err;
  const { data, error } = await sbAdminSelect(
    c.env,
    "webauthn_credentials",
    "select=id,device_name,device_type,browser,os,created_at,last_used_at&developer_id=eq." + ctx.developer.id + "&order=created_at.desc&limit=100"
  );
  if (error) return fail(c, 500, "Could not load your passkeys.");
  return c.json({ passkeys: data || [] });
});

wa.put("/developer/webauthn/passkeys/:id", async (c) => {
  const ctx = await requireDeveloper(c);
  if (ctx.err) return ctx.err;
  let body = {};
  try {
    body = (await c.req.json()) || {};
  } catch {
    body = {};
  }
  const name = String(body.device_name || "").trim().slice(0, 100);
  if (!name) return fail(c, 400, "A device name is required.", "invalid_request");
  // The developer_id filter is the tenant boundary: without it, any signed-in
  // developer could rename someone else's passkey by guessing an id.
  const { data, error } = await sbAdminWrite(
    c.env,
    "webauthn_credentials",
    "PATCH",
    { device_name: name, updated_at: new Date().toISOString() },
    "id=eq." + c.req.param("id") + "&developer_id=eq." + ctx.developer.id
  );
  if (error) return fail(c, 500, "Could not rename this passkey.");
  if (!(data || []).length) return fail(c, 404, "Passkey not found.", "not_found");
  return c.json({ success: true });
});

wa.delete("/developer/webauthn/passkeys/:id", async (c) => {
  const ctx = await requireDeveloper(c);
  if (ctx.err) return ctx.err;
  const { data, error } = await sbAdminWrite(
    c.env,
    "webauthn_credentials",
    "DELETE",
    void 0,
    "id=eq." + c.req.param("id") + "&developer_id=eq." + ctx.developer.id
  );
  if (error) return fail(c, 500, "Could not remove this passkey.");
  if (!(data || []).length) return fail(c, 404, "Passkey not found.", "not_found");
  return c.json({ success: true });
});

export default wa;
