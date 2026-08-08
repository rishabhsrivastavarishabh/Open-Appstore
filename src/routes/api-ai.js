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
import { consume, applyHeaders } from "../lib/ratelimit.js";
import { bearer } from "../lib/supabase.js";
import { sbAuth } from "../lib/supabase.js";

const ai = new Hono();

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/* A small, fast, inexpensive model. `openrouter/auto` can silently route to a
   very expensive model, which is a poor default when the caller pays. */
const MODEL = "openai/gpt-4o-mini";

/* Cap the app catalogue sent as context. Sending every app would blow the token
   budget and cost, and the assistant only needs enough to make a suggestion. */
const MAX_CONTEXT_APPS = 60;
const MAX_PROMPT_CHARS = 500;

function fail(c, status, message, code) {
  return c.json({ success: false, error: message, code: code || "ai_error" }, status);
}

/** Trim the catalogue to the few fields the model actually needs to reason. */
function slimApp(a) {
  return {
    slug: a.app_slug,
    name: a.app_name,
    category: a.category,
    tagline: a.tagline || "",
    rating: a.rating_average,
    downloads: a.download_count
  };
}

/**
 * Ask OpenRouter for a completion.
 *
 * Every failure mode returns a plain-language message rather than leaking the
 * upstream body, which can echo request details.
 */
async function complete(env, messages, maxTokens) {
  const key = env.OPENROUTER_API_KEY;
  if (!key) {
    return { error: "The AI assistant is not configured on this deployment.", status: 503 };
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

/** Load a compact published-app catalogue to ground the model in real data. */
async function catalogue(env) {
  const { data } = await sbSelect(
    env,
    "apps",
    "select=app_slug,app_name,category,tagline,rating_average,download_count" +
      `&status=eq.published&order=download_count.desc&limit=${MAX_CONTEXT_APPS}`
  );
  return (data || []).map(slimApp);
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
      endpoints: ["POST /api/ai/ask", "POST /api/ai/listing"]
    }
  })
);

/**
 * POST /api/ai/ask — free-form question, grounded in the real app catalogue.
 * Body: { prompt }
 */
ai.post("/ai/ask", async (c) => {
  const { err, user } = await gate(c);
  if (err) return err;

  const body = await c.req.json().catch(() => ({}));
  const prompt = String(body.prompt || "").trim().slice(0, MAX_PROMPT_CHARS);
  if (!prompt) return fail(c, 422, "Type a question first.", "validation_failed");

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
  const { err } = await gate(c);
  if (err) return err;

  const body = await c.req.json().catch(() => ({}));
  const name = String(body.app_name || "").trim().slice(0, 120);
  const category = String(body.category || "").trim().slice(0, 60);
  const notes = String(body.notes || "").trim().slice(0, MAX_PROMPT_CHARS);
  if (!name) return fail(c, 422, "An app name is required.", "validation_failed");

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

export default ai;
