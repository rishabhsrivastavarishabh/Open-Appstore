/**
 * WebAuthn / passkey primitives for the Workers runtime.
 *
 * There is no `@simplewebauthn/server` here on purpose: that library pulls in
 * Node crypto and cbor dependencies that do not run on the edge and would blow
 * past the Worker size budget. Everything below is built on the Web Crypto API,
 * which Workers implements natively.
 *
 * Scope is deliberately narrow — ES256 (COSE alg -7) and RS256 (-257), which
 * together cover every platform authenticator in practice (Face ID, Touch ID,
 * Android fingerprint, Windows Hello) plus common security keys. An
 * authenticator offering only something exotic is rejected with a clear message
 * rather than silently "registered" as an unverifiable credential.
 *
 * IMPORTANT: this verifies signatures for real. A passkey implementation that
 * skips signature verification is not authentication at all — it would let
 * anyone who knows a credential ID sign in as its owner.
 */

/* ------------------------------------------------------------------ base64 */

/** base64url -> Uint8Array. Tolerates standard base64 and missing padding. */
export function b64uToBytes(s) {
  const norm = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 === 0 ? norm : norm + "=".repeat(4 - (norm.length % 4));
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Uint8Array -> base64url, no padding. */
export function bytesToB64u(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  // Chunked: String.fromCharCode(...huge) overflows the call stack.
  const CHUNK = 0x8000;
  for (let i = 0; i < arr.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, arr.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomChallenge(len = 32) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return bytesToB64u(b);
}

/** Constant-time-ish comparison for short byte strings (digests, challenges). */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* -------------------------------------------------------------------- CBOR */

/**
 * Minimal CBOR decoder — enough for attestation objects and COSE keys.
 * Returns { value, offset }. Only the major types WebAuthn actually uses are
 * implemented; anything else throws rather than returning a wrong value.
 */
function cborDecode(buf, offset = 0) {
  if (offset >= buf.length) throw new Error("CBOR: truncated");
  const first = buf[offset++];
  const major = first >> 5;
  const minor = first & 0x1f;

  function readUint(n) {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + buf[offset++];
    return v;
  }
  let len;
  if (minor < 24) len = minor;
  else if (minor === 24) len = readUint(1);
  else if (minor === 25) len = readUint(2);
  else if (minor === 26) len = readUint(4);
  else if (minor === 27) len = readUint(8);
  else if (minor === 31) len = -1; // indefinite
  else throw new Error("CBOR: bad additional info " + minor);

  switch (major) {
    case 0:
      return { value: len, offset };
    case 1:
      return { value: -1 - len, offset };
    case 2: {
      const v = buf.subarray(offset, offset + len);
      return { value: v, offset: offset + len };
    }
    case 3: {
      const v = new TextDecoder().decode(buf.subarray(offset, offset + len));
      return { value: v, offset: offset + len };
    }
    case 4: {
      const arr = [];
      for (let i = 0; i < len; i++) {
        const r = cborDecode(buf, offset);
        arr.push(r.value);
        offset = r.offset;
      }
      return { value: arr, offset };
    }
    case 5: {
      const map = new Map();
      for (let i = 0; i < len; i++) {
        const k = cborDecode(buf, offset);
        const v = cborDecode(buf, k.offset);
        map.set(k.value, v.value);
        offset = v.offset;
      }
      return { value: map, offset };
    }
    case 6: {
      // Tagged value: skip the tag, return the content.
      return cborDecode(buf, offset);
    }
    case 7: {
      if (minor === 20) return { value: false, offset };
      if (minor === 21) return { value: true, offset };
      if (minor === 22) return { value: null, offset };
      return { value: null, offset };
    }
    default:
      throw new Error("CBOR: unsupported major type " + major);
  }
}

/* --------------------------------------------------------------- COSE keys */

/**
 * Convert a COSE_Key (as found in attested credential data) to a JWK that
 * Web Crypto can import. Returns { jwk, alg } or throws with a plain message.
 */
export function coseToJwk(coseBytes) {
  const { value: m } = cborDecode(coseBytes, 0);
  if (!(m instanceof Map)) throw new Error("Unsupported credential key format.");
  const kty = m.get(1);
  const alg = m.get(3);

  if (kty === 2) {
    // EC2. Only P-256 / ES256 is accepted.
    if (alg !== -7) throw new Error("Unsupported key algorithm. This device is not supported.");
    const crv = m.get(-1);
    if (crv !== 1) throw new Error("Unsupported elliptic curve. This device is not supported.");
    const x = m.get(-2);
    const y = m.get(-3);
    if (!x || !y) throw new Error("Malformed credential key.");
    return {
      alg: -7,
      jwk: { kty: "EC", crv: "P-256", x: bytesToB64u(x), y: bytesToB64u(y), ext: true }
    };
  }
  if (kty === 3) {
    // RSA. RS256 only.
    if (alg !== -257) throw new Error("Unsupported key algorithm. This device is not supported.");
    const n = m.get(-1);
    const e = m.get(-2);
    if (!n || !e) throw new Error("Malformed credential key.");
    return { alg: -257, jwk: { kty: "RSA", n: bytesToB64u(n), e: bytesToB64u(e), ext: true } };
  }
  throw new Error("Unsupported credential key type. This device is not supported.");
}

async function importVerifyKey(jwk, alg) {
  if (alg === -7) {
    return crypto.subtle.importKey("jwk", { ...jwk, crv: "P-256", kty: "EC" }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  }
  return crypto.subtle.importKey("jwk", { ...jwk, kty: "RSA", alg: "RS256" }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

/**
 * WebAuthn ECDSA signatures are ASN.1 DER encoded, but Web Crypto's ECDSA
 * verify expects the raw r||s form. Converting is mandatory — skipping it makes
 * every signature "invalid" and the whole flow silently unusable.
 */
function derToRaw(der) {
  if (der[0] !== 0x30) throw new Error("Malformed signature.");
  let i = 2;
  // A long-form length byte shifts where the first INTEGER starts.
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  if (der[i] !== 0x02) throw new Error("Malformed signature.");
  const rLen = der[i + 1];
  let r = der.subarray(i + 2, i + 2 + rLen);
  let j = i + 2 + rLen;
  if (der[j] !== 0x02) throw new Error("Malformed signature.");
  const sLen = der[j + 1];
  let s = der.subarray(j + 2, j + 2 + sLen);
  // DER carries a leading zero to keep INTEGERs positive; raw form does not.
  const trim = (v) => {
    let k = 0;
    while (k < v.length - 1 && v[k] === 0) k++;
    return v.subarray(k);
  };
  r = trim(r);
  s = trim(s);
  if (r.length > 32 || s.length > 32) throw new Error("Malformed signature.");
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out;
}

/* ----------------------------------------------------------- authData parse */

/**
 * Parse the authenticator data structure. Layout is fixed-width up to the
 * flags, so this is straightforward once the optional attested-credential and
 * extension blocks are accounted for.
 */
export function parseAuthData(bytes) {
  if (bytes.length < 37) throw new Error("Malformed authenticator data.");
  const rpIdHash = bytes.subarray(0, 32);
  const flags = bytes[32];
  const signCount = (bytes[33] << 24) | (bytes[34] << 16) | (bytes[35] << 8) | bytes[36];
  const out = {
    rpIdHash,
    flags,
    userPresent: !!(flags & 0x01),
    userVerified: !!(flags & 0x04),
    attestedCredentialData: !!(flags & 0x40),
    signCount: signCount >>> 0,
    credentialId: null,
    coseKey: null
  };
  let offset = 37;
  if (out.attestedCredentialData) {
    if (bytes.length < offset + 18) throw new Error("Malformed attested credential data.");
    offset += 16; // AAGUID
    const idLen = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;
    out.credentialId = bytes.subarray(offset, offset + idLen);
    offset += idLen;
    // The COSE key is the remainder up to any extension map; the CBOR decoder
    // stops at the end of the key itself, so passing the tail is safe.
    out.coseKey = bytes.subarray(offset);
  }
  return out;
}

async function sha256(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(d);
}

/**
 * Decode and sanity check clientDataJSON.
 * `expectedOrigin` is checked exactly: origin confusion is the whole attack
 * WebAuthn's origin binding exists to prevent.
 */
export function parseClientData(b64u, expectedType, expectedChallengeB64u, expectedOrigins) {
  let json;
  try {
    json = JSON.parse(new TextDecoder().decode(b64uToBytes(b64u)));
  } catch {
    throw new Error("Malformed client data.");
  }
  if (json.type !== expectedType) throw new Error("Unexpected credential type.");
  // Normalise: browsers send base64url without padding, which is what we store.
  const got = String(json.challenge || "").replace(/=+$/, "");
  const want = String(expectedChallengeB64u || "").replace(/=+$/, "");
  if (!got || got !== want) throw new Error("Challenge did not match. Please try again.");
  if (expectedOrigins && expectedOrigins.length) {
    if (!expectedOrigins.includes(json.origin)) throw new Error("Request came from an unexpected origin.");
  }
  return json;
}

/**
 * Verify a registration (attestation) response.
 * Attestation *statements* are not verified — we accept "none"/self attestation,
 * which is the right call for a first-party store: we care that the key is
 * bound to this RP and origin, not which manufacturer made the device.
 */
export async function verifyRegistration({ attestationObjectB64u, clientDataJSONB64u, expectedChallenge, expectedOrigins, rpId }) {
  parseClientData(clientDataJSONB64u, "webauthn.create", expectedChallenge, expectedOrigins);
  const { value: att } = cborDecode(b64uToBytes(attestationObjectB64u), 0);
  if (!(att instanceof Map)) throw new Error("Malformed attestation object.");
  const authDataBytes = att.get("authData");
  if (!authDataBytes) throw new Error("Malformed attestation object.");
  const authData = parseAuthData(authDataBytes);

  const expectedRpIdHash = await sha256(new TextEncoder().encode(rpId));
  if (!timingSafeEqual(authData.rpIdHash, expectedRpIdHash)) {
    throw new Error("This passkey was created for a different site.");
  }
  if (!authData.userPresent) throw new Error("The device did not confirm user presence.");
  if (!authData.attestedCredentialData || !authData.credentialId || !authData.coseKey) {
    throw new Error("The device did not return a credential.");
  }
  const { jwk, alg } = coseToJwk(authData.coseKey);
  return {
    credentialIdB64u: bytesToB64u(authData.credentialId),
    jwk,
    alg,
    signCount: authData.signCount,
    userVerified: authData.userVerified
  };
}

/**
 * Verify an authentication (assertion) response.
 * The signed message is authenticatorData || SHA-256(clientDataJSON).
 */
export async function verifyAssertion({
  authenticatorDataB64u,
  clientDataJSONB64u,
  signatureB64u,
  expectedChallenge,
  expectedOrigins,
  rpId,
  jwk,
  alg,
  storedSignCount
}) {
  parseClientData(clientDataJSONB64u, "webauthn.get", expectedChallenge, expectedOrigins);
  const authDataBytes = b64uToBytes(authenticatorDataB64u);
  const authData = parseAuthData(authDataBytes);

  const expectedRpIdHash = await sha256(new TextEncoder().encode(rpId));
  if (!timingSafeEqual(authData.rpIdHash, expectedRpIdHash)) {
    throw new Error("This passkey belongs to a different site.");
  }
  if (!authData.userPresent) throw new Error("The device did not confirm user presence.");

  const clientHash = await sha256(b64uToBytes(clientDataJSONB64u));
  const signed = new Uint8Array(authDataBytes.length + clientHash.length);
  signed.set(authDataBytes, 0);
  signed.set(clientHash, authDataBytes.length);

  const key = await importVerifyKey(jwk, alg);
  let sig = b64uToBytes(signatureB64u);
  let ok;
  if (alg === -7) {
    sig = derToRaw(sig);
    ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, signed);
  } else {
    ok = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, sig, signed);
  }
  if (!ok) throw new Error("Passkey verification failed.");

  /* Signature counter check. Many platform authenticators (Apple in
   * particular) always report 0, so a zero counter cannot be treated as
   * cloning. Only a real regression between two non-zero values is suspicious,
   * and even then the spec leaves the response to the RP — we reject, because a
   * going-backwards counter on a hardware key is the documented clone signal. */
  if (authData.signCount > 0 && storedSignCount > 0 && authData.signCount <= storedSignCount) {
    throw new Error("This passkey looks like it has been duplicated. It has been rejected.");
  }
  return { signCount: authData.signCount, userVerified: authData.userVerified };
}

/**
 * Derive the Relying Party ID from the request. WebAuthn requires the RP ID to
 * be the origin's registrable domain (or a suffix of it), so it must follow
 * whatever host actually served the page — hardcoding one value would break
 * every deployment except that one, including the sandbox preview and
 * *.pages.dev previews.
 */
export function rpIdFor(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "localhost";
  }
}

/** Best-effort device labelling from the User-Agent, for the passkey list. */
export function describeClient(ua) {
  const s = String(ua || "");
  let os = "Unknown";
  if (/iPhone|iPad|iPod/i.test(s)) os = "iOS";
  else if (/Android/i.test(s)) os = "Android";
  else if (/Mac OS X|Macintosh/i.test(s)) os = "macOS";
  else if (/Windows/i.test(s)) os = "Windows";
  else if (/Linux/i.test(s)) os = "Linux";
  let browser = "Unknown";
  // Order matters: Edge and Chrome both claim "Chrome", Chrome claims "Safari".
  if (/Edg\//i.test(s)) browser = "Edge";
  else if (/OPR\//i.test(s)) browser = "Opera";
  else if (/Chrome\//i.test(s)) browser = "Chrome";
  else if (/Firefox\//i.test(s)) browser = "Firefox";
  else if (/Safari\//i.test(s)) browser = "Safari";
  let deviceType = "key";
  if (os === "iOS" || os === "macOS") deviceType = "face";
  else if (os === "Android") deviceType = "fingerprint";
  else if (os === "Windows") deviceType = "fingerprint";
  return { os, browser, deviceType };
}

/** A friendly default name so the list is not full of "Unknown device". */
export function defaultDeviceName({ os, browser, deviceType }) {
  if (os === "iOS") return "iPhone / iPad (Face ID or Touch ID)";
  if (os === "macOS") return "Mac (Touch ID)";
  if (os === "Android") return "Android (fingerprint)";
  if (os === "Windows") return "Windows Hello";
  return `${browser} on ${os}` + (deviceType === "key" ? " (security key)" : "");
}
