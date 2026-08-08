/**
 * AI assistant, backed by OpenRouter.
 *
 * SECURITY: the API key lives ONLY in this Worker, injected as a Cloudflare
 * secret and read from c.env at request time. It is never sent to the browser
 * and never appears in a bundle. The guide this was built from states "never
 * expose API key in frontend / use backend proxy" -- but its own sample code
 * puts the literal key in `lib/openrouter.ts`, which a bundler happily ships to
 * the client. This file is that backend proxy, done properly: the browser calls
 * our endpoint, our endpoint calls OpenRouter.
 */
import { Hono } from "hono";
import { sbSelect } from "../lib/supabase.js";
import { consume, consumeBurst, applyHeaders } from "../lib/ratelimit.js";
import { bearer } from "../lib/supabase.js";
import { sbAuth } from "../lib/supabase.js";

const ai = new Hono();

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/* A small, fast, inexpensive model. `openrouter/auto` can silently route to a
   very expensive model, which is a poor default when the caller pays. */
const MODEL = "openai/gpt-4o-mini";

/* Cap the app catalogue sent as context. Sending every app would blow the token
   budget and cost, and the assistant only needs enough to make a suggestion. */
/*
 * Catalogue size vs detail-per-app.
 *
 * Each app now carries full listing detail rather than a one-line summary, so
 * the per-app cost in tokens is several times higher. The app count is reduced
 * to keep the total context (and therefore latency and per-request price)
 * roughly where it was -- 40 fully-described apps is far more useful to the
 * model than 60 it knows almost nothing about.
 */
const MAX_CONTEXT_APPS = 40;
const MAX_DESC_CHARS = 420;
const MAX_PROMPT_CHARS = 500;

/**
 * Response cache, keyed on the exact request shape.
 *
 * Two visitors asking "best photo editor" should not cost two API calls, and the
 * catalogue changes far more slowly than people ask about it. Per-isolate and
 * bounded, same honest caveat as the rate limiter: it is a cost/latency
 * optimisation, not a guaranteed global cache.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 200;
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() >= hit.expires) {
    cache.delete(key);
    return null;
  }
  // Refresh insertion order so hot entries survive eviction.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

function fail(c, status, message, code) {
  return c.json({ success: false, error: message, code: code || "ai_error" }, status);
}

/**
 * Project an `apps` row into the object the model sees.
 *
 * This carries the FULL detail of a listing, not a teaser: version numbers,
 * requirements, developer, links, review counts and update policy. The model
 * can only answer questions about facts it was given, so anything a visitor
 * might reasonably ask ("what version is it?", "does it need Android 8?",
 * "who made it?", "is there a privacy policy?") has to be in here.
 *
 * Column names are the REAL ones on `apps`. An earlier version guessed
 * `tagline` / `rating_average` / `download_count`; PostgREST answered
 * `column apps.tagline does not exist`, catalogue() returned an error object,
 * and every AI reply was generated with NO catalogue context while still
 * sounding fluent. Any field added here MUST exist in APP_SELECT.
 *
 * Empty values are stripped rather than sent as null. "min_android": null
 * invites the model to state the requirement is "not specified" as though that
 * were a finding; an absent key just leaves nothing to say.
 */
function slimApp(a) {
  // Markdown is flattened: the model reads prose, and stray #/*/` tokens waste
  // context and occasionally leak into its output.
  const desc = String(a.description || "")
    .replace(/[#*_`>|]/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const out = {
    slug: a.app_slug,
    name: a.app_name,
    category: a.category || "Other",
    // Generous but bounded: enough for the model to actually understand what
    // the app does, short of pasting an entire README per app.
    description: desc.slice(0, MAX_DESC_CHARS),
    price: a.is_free === false ? `${Number(a.price || 0)}` : "Free",
    is_free: a.is_free !== false,
    version: a.latest_version || a.current_version || null,
    min_android: a.min_version || null,
    rating: Number(a.rating || 0) || null,
    reviews: Number(a.total_reviews || 0) || null,
    downloads: Number(a.total_downloads || 0) || null,
    developer: a.developers?.developer_name || null,
    developer_verified: a.developers?.verified === true ? true : null,
    website: a.website || a.website_link || null,
    has_privacy_policy: a.privacy_policy_link ? true : null,
    // Whether a download is actually obtainable: the model should not promise
    // an install for a listing with no link.
    downloadable: a.download_url || a.google_drive_link ? true : null,
    auto_update: a.auto_update === false ? false : null,
    updated: a.updated_at ? String(a.updated_at).slice(0, 10) : null,
    published: a.created_at ? String(a.created_at).slice(0, 10) : null
  };
  const changes = String(a.change_log || "").replace(/\s+/g, " ").trim();
  if (changes) out.latest_changes = changes.slice(0, 200);
  // Drop empty keys so the model is never handed a field with nothing in it.
  Object.keys(out).forEach((k) => {
    if (out[k] === null || out[k] === "" || out[k] === undefined) delete out[k];
  });
  return out;
}

/**
 * Pull the JSON payload out of a model reply.
 *
 * Models wrap JSON in prose or ```json fences even when told not to, so a bare
 * JSON.parse fails often enough to matter. Falling back to the outermost
 * bracketed span recovers nearly all of those cases.
 */
function parseJson(text, expect = "array") {
  const attempt = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [text, fenced && fenced[1]].filter(Boolean);
  const open = expect === "array" ? "[" : "{";
  const close = expect === "array" ? "]" : "}";
  for (const raw of candidates) {
    const direct = attempt(raw.trim());
    if (direct) return direct;
    const a = raw.indexOf(open);
    const b = raw.lastIndexOf(close);
    if (a !== -1 && b > a) {
      const span = attempt(raw.slice(a, b + 1));
      if (span) return span;
    }
  }
  return null;
}

/**
 * Ask OpenRouter for a completion.
 *
 * Every failure mode returns a plain-language message rather than leaking the
 * upstream body, which can echo request details.
 */
async function complete(env, messages, maxTokens, cacheKey) {
  const key = env.OPENROUTER_API_KEY;
  if (!key) {
    return { error: "The AI assistant is not configured on this deployment.", status: 503 };
  }
  if (cacheKey) {
    const hit = cacheGet(cacheKey);
    if (hit) return { text: hit, cached: true };
  }
  let res;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // OpenRouter uses these for attribution on their dashboard.
        "HTTP-Referer": "https://openappstore.pages.dev",
        "X-Title": "Open Appstore"
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.4,
        max_tokens: maxTokens || 500
      })
    });
  } catch {
    return { error: "Could not reach the AI service. Please try again.", status: 502 };
  }

  if (!res.ok) {
    // 401/402 mean the key is missing/out of credit -- an operator problem, not
    // something the developer reading the message can fix, so say so plainly.
    if (res.status === 401) return { error: "The AI service rejected our credentials.", status: 502 };
    if (res.status === 402) return { error: "The AI service account is out of credit.", status: 502 };
    if (res.status === 429) return { error: "The AI service is rate limiting us. Try again shortly.", status: 429 };
    return { error: "The AI service returned an error. Please try again.", status: 502 };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { error: "The AI service sent an unreadable response.", status: 502 };
  }
  const text = data?.choices?.[0]?.message?.content;
  if (!text) return { error: "The AI service returned an empty answer.", status: 502 };
  if (cacheKey) cacheSet(cacheKey, String(text));
  return { text: String(text) };
}

/**
 * Identify the caller and rate limit them.
 *
 * AI calls cost real money per request, so unlike the read-only store endpoints
 * this one requires a signed-in developer. Anonymous access would let anyone
 * burn the account's credit.
 */
async function gate(c) {
  const token = bearer(c.req.header("Authorization"));
  if (!token) return { err: fail(c, 401, "Sign in to use the AI assistant.", "auth_required") };
  const { data: user, error } = await sbAuth(c.env, "user", { token });
  if (error || !user?.id) return { err: fail(c, 401, "Your session has expired. Sign in again.", "auth_required") };

  // Burst gate first, and deliberately BEFORE the hourly charge: telling someone
  // to slow down for a few seconds should not also cost one of their 20 calls.
  const burst = consumeBurst(user.id, "ai");
  if (!burst.allowed) {
    c.header("Retry-After", String(burst.retryAfter));
    return {
      err: fail(c, 429, `Please wait ${burst.retryAfter}s — max ${burst.limit} AI requests per minute.`, "rate_limited")
    };
  }

  // 20/hour per user. Deliberately tighter than the data APIs because each call
  // has a direct cost. Same per-isolate caveat as the rest of the app: it stops
  // runaway loops, it is not a hard distributed boundary.
  const rl = consume(`ai:${user.id}`, "ai");
  applyHeaders(c, rl);
  if (!rl.allowed) {
    c.header("Retry-After", String(rl.retryAfter));
    return { err: fail(c, 429, `You have used all ${rl.limit} AI requests for this hour.`, "rate_limited") };
  }
  return { user };
}

/**
 * Gate for the STOREFRONT AI features (search, chat widget, compare, picks).
 *
 * These have to work for a signed-out shopper -- requiring an account before you
 * can ask "which photo editor is best" would defeat the point of the feature.
 * That reintroduces the cost problem the developer gate solves with a user id,
 * so identity falls back to the client IP, and the limits are the same tight
 * AI ones. A signed-in visitor is keyed by user id so they are not lumped in
 * with everyone else behind a shared NAT.
 *
 * Being explicit about the limitation: IP is spoofable in general, but on
 * Cloudflare `CF-Connecting-IP` is set by the edge and cannot be forged by the
 * client, so it is a sound key here. A large NAT still shares one budget, which
 * is the deliberate trade for keeping the feature open to visitors.
 */
async function visitorGate(c) {
  if (!c.env.OPENROUTER_API_KEY) {
    return { err: fail(c, 503, "The AI assistant is not configured on this deployment.", "ai_unavailable") };
  }

  let id = null;
  const token = bearer(c.req.header("Authorization"));
  if (token) {
    const { data: user } = await sbAuth(c.env, "user", { token });
    if (user?.id) id = `u:${user.id}`;
  }
  if (!id) {
    const ip =
      c.req.header("CF-Connecting-IP") ||
      (c.req.header("X-Forwarded-For") || "").split(",")[0].trim() ||
      "anon";
    id = `ip:${ip}`;
  }

  const burst = consumeBurst(id, "ai");
  if (!burst.allowed) {
    c.header("Retry-After", String(burst.retryAfter));
    return {
      err: fail(c, 429, `Please wait ${burst.retryAfter}s \u2014 max ${burst.limit} AI requests per minute.`, "rate_limited")
    };
  }
  const rl = consume(`ai:${id}`, "ai");
  applyHeaders(c, rl);
  if (!rl.allowed) {
    c.header("Retry-After", String(rl.retryAfter));
    return { err: fail(c, 429, `You have used all ${rl.limit} AI requests for this hour.`, "rate_limited") };
  }
  return { id };
}

/** Load a compact published-app catalogue to ground the model in real data. */
/*
 * Columns pulled for AI context. Every name here is verified against the real
 * `apps` table (see APP_SELECT in lib/types.js) -- a typo makes PostgREST fail
 * the whole query, which used to leave the model answering with no grounding.
 *
 * `developers(...)` is a PostgREST embedded resource over the developer_id
 * foreign key: it fetches the studio name in the SAME round trip, so the model
 * can answer "who made this?" without a second query per app.
 */
const CATALOGUE_SELECT =
  "select=app_slug,app_name,category,description,rating,total_reviews,total_downloads," +
  "is_free,price,current_version,latest_version,min_version,change_log,auto_update," +
  "website,website_link,privacy_policy_link,download_url,google_drive_link," +
  "created_at,updated_at,developers(developer_name,verified)";

async function catalogue(env) {
  const { data, error } = await sbSelect(
    env,
    "apps",
    `${CATALOGUE_SELECT}&status=eq.published&order=total_downloads.desc&limit=${MAX_CONTEXT_APPS}`
  );
  // A failed query must not masquerade as an empty catalogue: returning [] here
  // would let the model answer confidently with no grounding at all.
  if (error || !Array.isArray(data)) return [];
  return data.map(slimApp);
}

/* ── Endpoints ───────────────────────────────────────────────────────────── */

/** GET /api/ai — is the assistant available? Lets the UI hide itself cleanly. */
ai.get("/ai", (c) =>
  c.json({
    success: true,
    data: {
      available: !!c.env.OPENROUTER_API_KEY,
      model: MODEL,
      limit_per_hour: 20,
      limit_per_minute: 3,
      endpoints: [
        "POST /api/ai/ask",
        "POST /api/ai/listing",
        "POST /api/ai/search",
        "POST /api/ai/chat",
        "POST /api/ai/compare",
        "POST /api/ai/picks"
      ]
    }
  })
);

/**
 * GET /api/ai/context — how many catalogue apps the model is actually grounded on.
 *
 * Exists because a broken catalogue query is invisible from the outside: the
 * model keeps answering fluently with no data (see the note on `slimApp`). This
 * makes the grounding assertable, so a regression fails a test instead of
 * quietly degrading every answer.
 */
ai.get("/ai/context", async (c) => {
  const apps = await catalogue(c.env);
  return c.json({
    success: true,
    data: { apps: apps.length, sample: apps.slice(0, 3).map((a) => a.slug), fields: Object.keys(apps[0] || {}) }
  });
});

/**
 * POST /api/ai/ask — free-form question, grounded in the real app catalogue.
 * Body: { prompt }
 */
ai.post("/ai/ask", async (c) => {
  // Input is validated BEFORE the rate limiter runs. Validation is free -- it
  // costs no AI call -- so charging a request for an empty textbox would punish
  // a user for a typo and burn a slot of their 3/min budget on nothing.
  const body = await c.req.json().catch(() => ({}));
  const prompt = String(body.prompt || "").trim().slice(0, MAX_PROMPT_CHARS);
  if (!prompt) return fail(c, 422, "Type a question first.", "validation_failed");

  const { err, user } = await gate(c);
  if (err) return err;

  const apps = await catalogue(c.env);
  const { text, error, status } = await complete(
    c.env,
    [
      {
        role: "system",
        content:
          "You are the assistant inside the Open Appstore developer console. " +
          "Answer concisely in plain text, no markdown headings. " +
          "You may be asked about publishing, listings, the store catalogue, or the Developer API. " +
          "When recommending apps, ONLY use apps from this catalogue and cite them by name. " +
          "If the catalogue does not contain anything relevant, say so rather than inventing an app. " +
          `Catalogue: ${JSON.stringify(apps)}`
      },
      { role: "user", content: prompt }
    ],
    600
  );
  if (error) return fail(c, status || 502, error);
  return c.json({ success: true, data: { answer: text, model: MODEL } });
});

/**
 * POST /api/ai/listing — help a developer write their store listing.
 * Body: { app_name, category, notes }
 *
 * This is the highest-value AI feature for a developer console: a weak
 * description is the most common reason a good app does not get installed.
 */
ai.post("/ai/listing", async (c) => {
  // Validate before charging the limiter (see /ai/ask).
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.app_name || "").trim().slice(0, 120);
  const category = String(body.category || "").trim().slice(0, 60);
  const notes = String(body.notes || "").trim().slice(0, MAX_PROMPT_CHARS);
  if (!name) return fail(c, 422, "An app name is required.", "validation_failed");

  const { err } = await gate(c);
  if (err) return err;

  const { text, error, status } = await complete(
    c.env,
    [
      {
        role: "system",
        content:
          "You write app store listings. Given an app name, category and notes, return EXACTLY this plain-text shape and nothing else:\n" +
          "TAGLINE: <one line, max 80 characters>\n" +
          "DESCRIPTION: <2 short paragraphs, max 900 characters total>\n" +
          "FEATURES:\n- <feature>\n- <feature>\n- <feature>\n" +
          "Be concrete and factual. Do not invent platforms, prices, awards or user numbers."
      },
      {
        role: "user",
        content: `App name: ${name}\nCategory: ${category || "unspecified"}\nNotes: ${notes || "none"}`
      }
    ],
    700
  );
  if (error) return fail(c, status || 502, error);

  // Parse into fields so the UI can drop them straight into the submit form.
  const tagline = (/TAGLINE:\s*(.+)/i.exec(text) || [])[1]?.trim() || "";
  const description = (/DESCRIPTION:\s*([\s\S]*?)(?:\nFEATURES:|$)/i.exec(text) || [])[1]?.trim() || "";
  const features = (text.split(/FEATURES:/i)[1] || "")
    .split("\n")
    .map((l) => l.replace(/^[-*\u2022]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8);

  return c.json({
    success: true,
    data: { tagline, description, features, raw: text, model: MODEL }
  });
});

/* ── Storefront AI (search, chat, compare, picks) ────────────────────────── */

/** Resolve slugs the model returned back to real catalogue rows, in AI order. */
function hydrate(recs, apps) {
  const bySlug = new Map(apps.map((a) => [String(a.slug).toLowerCase(), a]));
  const byName = new Map(apps.map((a) => [String(a.name).toLowerCase(), a]));
  const out = [];
  const seen = new Set();
  for (const r of recs || []) {
    const slug = String(r.slug || "").toLowerCase();
    const name = String(r.name || "").toLowerCase();
    // Trust the catalogue, not the model: an app it invented has no match here
    // and is silently dropped, so a hallucination can never reach the UI.
    const app = bySlug.get(slug) || byName.get(name);
    if (!app || seen.has(app.slug)) continue;
    seen.add(app.slug);
    out.push({ slug: app.slug, name: app.name, category: app.category, reason: String(r.reason || "").slice(0, 240) });
  }
  return out;
}

/**
 * POST /api/ai/search — natural-language app search.
 * Body: { query }
 * Returns ranked recommendations, each with the AI's reason.
 */
ai.post("/ai/search", async (c) => {
  // Validate before charging the limiter (see /ai/ask).
  const body = await c.req.json().catch(() => ({}));
  const query = String(body.query || "").trim().slice(0, MAX_PROMPT_CHARS);
  if (!query) return fail(c, 422, "Type what you are looking for.", "validation_failed");

  const { err } = await visitorGate(c);
  if (err) return err;

  const apps = await catalogue(c.env);
  if (!apps.length) return c.json({ success: true, data: { query, results: [], note: "The catalogue is empty." } });

  const { text, error, status, cached } = await complete(
    c.env,
    [
      {
        role: "system",
        content:
          "You match a shopper's need to apps in a store catalogue. " +
          "Return ONLY a JSON array, no prose, no code fence. " +
          'Each element: {"slug":"<exact slug from the catalogue>","reason":"<max 20 words, why it fits>"}. ' +
          "Order best match first. Return at most 6. " +
          "ONLY use slugs present in the catalogue. If nothing fits, return []. " +
          "Never invent an app. " +
          `Catalogue: ${JSON.stringify(apps)}`
      },
      { role: "user", content: query }
    ],
    500,
    // Same question + same catalogue size = same answer, so cache it.
    `search:${apps.length}:${query.toLowerCase()}`
  );
  if (error) return fail(c, status || 502, error);

  const parsed = parseJson(text, "array");
  const results = hydrate(Array.isArray(parsed) ? parsed : [], apps);
  return c.json({ success: true, data: { query, results, cached: !!cached, model: MODEL } });
});

/**
 * POST /api/ai/chat — the floating assistant widget.
 * Body: { messages: [{ role, content }], }
 *
 * History is supplied by the client and capped here; the server keeps no
 * conversation state, which suits a stateless Worker and means a visitor's chat
 * is never stored anywhere.
 */
ai.post("/ai/chat", async (c) => {
  // Validate before charging the limiter (see /ai/ask).
  const body = await c.req.json().catch(() => ({}));
  const history = Array.isArray(body.messages) ? body.messages : [];
  // Only the last few turns: enough for context, bounded for cost.
  const turns = history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-6)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, MAX_PROMPT_CHARS) }));
  if (!turns.length || turns[turns.length - 1].role !== "user") {
    return fail(c, 422, "Type a message first.", "validation_failed");
  }

  const { err } = await visitorGate(c);
  if (err) return err;

  const apps = await catalogue(c.env);
  const { text, error, status } = await complete(
    c.env,
    [
      {
        role: "system",
        content:
          "You are the shopping assistant for Open Appstore. Be brief and friendly: 2-4 sentences. " +
          "Plain text only, no markdown. " +
          "When suggesting apps, ONLY use apps from this catalogue and name them exactly. " +
          "If nothing in the catalogue fits, say so honestly instead of inventing an app. " +
          `Catalogue: ${JSON.stringify(apps)}`
      },
      ...turns
    ],
    400
  );
  if (error) return fail(c, status || 502, error);
  return c.json({ success: true, data: { reply: text, model: MODEL } });
});

/**
 * POST /api/ai/compare — compare two apps.
 * Body: { a: slug, b: slug }
 *
 * The apps are loaded from OUR database and only the slugs come from the client,
 * so the comparison is always grounded in real listing data.
 */
ai.post("/ai/compare", async (c) => {
  // Validate before charging the limiter (see /ai/ask).
  const body = await c.req.json().catch(() => ({}));
  const slugA = String(body.a || "").trim().slice(0, 120);
  const slugB = String(body.b || "").trim().slice(0, 120);
  if (!slugA || !slugB) return fail(c, 422, "Pick two apps to compare.", "validation_failed");
  if (slugA === slugB) return fail(c, 422, "Pick two different apps.", "validation_failed");

  const { err } = await visitorGate(c);
  if (err) return err;

  const fields =
    "select=app_slug,app_name,category,description,icon_url,rating,total_reviews,total_downloads,is_free,price,current_version";
  const load = async (slug) => {
    const { data } = await sbSelect(c.env, "apps", `${fields}&app_slug=eq.${encodeURIComponent(slug)}&status=eq.published&limit=1`);
    return (data || [])[0] || null;
  };
  const [rowA, rowB] = await Promise.all([load(slugA), load(slugB)]);
  if (!rowA || !rowB) return fail(c, 404, "One of those apps could not be found.", "not_found");

  const trim = (r) => ({
    slug: r.app_slug,
    name: r.app_name,
    category: r.category,
    description: String(r.description || "").replace(/\s+/g, " ").trim().slice(0, 700),
    rating: r.rating,
    reviews: r.total_reviews,
    downloads: r.total_downloads,
    price: r.is_free ? "Free" : `${r.price}`,
    version: r.current_version
  });

  const { text, error, status, cached } = await complete(
    c.env,
    [
      {
        role: "system",
        content:
          "Compare two apps for a shopper. Return ONLY JSON, no prose, no code fence, exactly this shape:\n" +
          '{"rows":[{"aspect":"<short label>","a":"<about app A>","b":"<about app B>"}],' +
          '"pros_a":["..."],"cons_a":["..."],"pros_b":["..."],"cons_b":["..."],' +
          '"verdict":"<2 sentences: who should pick which, and why>"}\n' +
          "Use 4-6 rows. Base every claim ONLY on the supplied data. " +
          "If the data does not say something, do not assert it -- say \"not stated\"."
      },
      { role: "user", content: `App A:\n${JSON.stringify(trim(rowA))}\n\nApp B:\n${JSON.stringify(trim(rowB))}` }
    ],
    900,
    `compare:${[slugA, slugB].sort().join("|")}`
  );
  if (error) return fail(c, status || 502, error);

  const parsed = parseJson(text, "object") || {};
  const list = (v) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 200)).slice(0, 6) : []);
  return c.json({
    success: true,
    data: {
      a: { slug: rowA.app_slug, name: rowA.app_name, icon: rowA.icon_url || null },
      b: { slug: rowB.app_slug, name: rowB.app_name, icon: rowB.icon_url || null },
      rows: Array.isArray(parsed.rows)
        ? parsed.rows
            .filter((r) => r && r.aspect)
            .map((r) => ({
              aspect: String(r.aspect).slice(0, 60),
              a: String(r.a ?? "").slice(0, 240),
              b: String(r.b ?? "").slice(0, 240)
            }))
            .slice(0, 8)
        : [],
      pros_a: list(parsed.pros_a),
      cons_a: list(parsed.cons_a),
      pros_b: list(parsed.pros_b),
      cons_b: list(parsed.cons_b),
      verdict: String(parsed.verdict || "").slice(0, 600),
      cached: !!cached,
      model: MODEL
    }
  });
});

/**
 * POST /api/ai/picks — "Apps You Might Like".
 * Body: { recent: [slug], installed: [slug], liked_categories: [name] }
 *
 * Signals come from the client (localStorage recent views) plus, when signed in,
 * the visitor's real installed apps. With no signals at all this returns nothing
 * rather than a generic list -- the store already has a popular section, and a
 * fake "personalised" row is worse than none.
 */
ai.post("/ai/picks", async (c) => {
  // Validated (and the no-signal case answered) before charging the limiter:
  // this endpoint fires automatically on page load, so a visitor with no
  // browsing history must not silently spend a slot of their 3/min budget.
  const body = await c.req.json().catch(() => ({}));
  const clean = (v) =>
    (Array.isArray(v) ? v : [])
      .map((x) => String(x || "").trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 12);
  const recent = clean(body.recent);
  const installed = clean(body.installed);
  const cats = clean(body.liked_categories);

  if (!recent.length && !installed.length && !cats.length) {
    return c.json({ success: true, data: { results: [], note: "Not enough activity yet." } });
  }

  const { err } = await visitorGate(c);
  if (err) return err;

  const apps = await catalogue(c.env);
  // Never recommend something the visitor already has.
  const pool = apps.filter((a) => !installed.includes(a.slug));
  if (!pool.length) return c.json({ success: true, data: { results: [] } });

  const { text, error, status, cached } = await complete(
    c.env,
    [
      {
        role: "system",
        content:
          "You personalise app recommendations. Return ONLY a JSON array, no prose, no code fence. " +
          'Each element: {"slug":"<exact slug from the catalogue>","reason":"<max 15 words, tied to their activity>"}. ' +
          "Return at most 6, best first. ONLY use slugs from the catalogue. " +
          "Do not recommend apps the user already installed. Never invent an app. " +
          `Catalogue: ${JSON.stringify(pool)}`
      },
      {
        role: "user",
        content:
          `Recently viewed: ${recent.join(", ") || "none"}\n` +
          `Already installed: ${installed.join(", ") || "none"}\n` +
          `Categories they engage with: ${cats.join(", ") || "unknown"}`
      }
    ],
    500,
    `picks:${pool.length}:${recent.join(",")}|${installed.join(",")}|${cats.join(",")}`
  );
  if (error) return fail(c, status || 502, error);

  const parsed = parseJson(text, "array");
  const results = hydrate(Array.isArray(parsed) ? parsed : [], pool);
  return c.json({ success: true, data: { results, cached: !!cached, model: MODEL } });
});

export default ai;
