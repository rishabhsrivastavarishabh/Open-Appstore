/**
 * "Sarath AI" developer help: a support chat that persists to
 * `developer_help_conversations` / `developer_help_messages`.
 *
 * This is separate from /api/ai/chat because it does a different job: it answers
 * questions about operating THIS store (how to publish, what the review rules
 * are) from a grounded system prompt, and it keeps a transcript so a developer
 * can come back to an answer and so feedback can be acted on.
 *
 * The API key stays server-side. The spec's sample code put the OpenRouter key
 * in the browser, which would expose it to anyone who opened devtools.
 */
import { Hono } from "hono";
import { sbSelect, sbAdminSelect, sbAdminWrite, sbAuth, bearer } from "../lib/supabase.js";
import { fail } from "../lib/apierror.js";
import { consume, consumeBurst, applyHeaders } from "../lib/ratelimit.js";

const help = new Hono();

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "openai/gpt-4o-mini";


/**
 * Grounding. The assistant is told what it does and does not know, because a
 * support bot that invents a "Monetisation" tab we never built produces support
 * tickets rather than preventing them.
 */
const SYSTEM = [
  "You are Sarath, the developer support assistant for Open Appstore.",
  "You help developers publish and manage apps on this store.",
  "",
  "Facts about this store (do not contradict these):",
  "- The developer console is at /developer. There is no /developer/dashboard.",
  "- Developers submit an app at /developer/submit, and manage listings at /developer/apps.",
  "- API keys are created at /developer/api-keys and are used with the /api/v1 REST API.",
  "- Two-factor authentication and passkeys are configured at /developer/security.",
  "- App downloads are hosted on links the developer supplies (direct URL, Google Drive, Dropbox, GitHub, OneDrive).",
  "- The store does not host uploaded binaries itself, so a developer must provide a download link.",
  "- Apps have a status of draft or published. Publishing is done from the developer console.",
  "",
  "Rules:",
  "- Be concise and practical. Prefer 3-6 sentences plus a short list where useful.",
  "- If you are not sure, say so and suggest contacting the store operator. Never invent",
  "  a feature, page, price, or policy that is not listed above.",
  "- Never ask for or repeat passwords, API keys, or tokens."
].join("\n");

/** Signed-in developer, plus the two-gate rate limit used for all AI calls. */
async function gate(c) {
  const token = bearer(c.req.header("Authorization"));
  if (!token) return { err: fail(c, 401, "Sign in to use developer help.", "unauthorized") };
  const { data: user, error } = await sbAuth(c.env, "user", { token });
  if (error || !user?.id) return { err: fail(c, 401, "Your session has expired. Sign in again.", "unauthorized") };
  const { data: devs } = await sbSelect(c.env, "developers", "select=id,developer_name,email&user_id=eq." + user.id + "&limit=1", token);
  const developer = (devs || [])[0];
  if (!developer) return { err: fail(c, 403, "This account does not have a developer profile.", "forbidden") };

  // Burst gate first and BEFORE the hourly charge: being told to slow down for a
  // few seconds should not also cost one of the hourly allowance.
  //
  // Note the field name: consumeBurst/consume report `allowed`, not `ok`.
  // Reading the wrong key made this gate reject every request, because
  // `!undefined` is always true.
  //
  // Retry-After is set with c.header() rather than on the returned Response,
  // because headers must be staged on the context before the body is created.
  const burst = consumeBurst(`help:${user.id}`, "ai");
  if (!burst.allowed) {
    c.header("Retry-After", String(burst.retryAfter));
    return {
      err: fail(
        c,
        429,
        `You are sending messages too quickly. Wait ${burst.retryAfter}s — the limit is ${burst.limit} per minute.`,
        "rate_limited",
        { retry_after: burst.retryAfter }
      )
    };
  }
  const info = consume(`help:${user.id}`, "ai");
  applyHeaders(c, info);
  if (!info.allowed) {
    c.header("Retry-After", String(info.retryAfter));
    return {
      err: fail(
        c,
        429,
        `You have used all ${info.limit} AI help requests for this hour.`,
        "rate_limited",
        { retry_after: info.retryAfter }
      )
    };
  }
  return { user, developer, token, rl: info };
}

async function complete(env, messages, maxTokens) {
  const key = env.OPENROUTER_API_KEY;
  if (!key) return { error: "Developer help is not configured on this deployment.", status: 503 };
  let res;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://openappstore.pages.dev",
        "X-Title": "Open Appstore Developer Help"
      },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: maxTokens || 600 })
    });
  } catch {
    return { error: "Could not reach the AI service. Please try again.", status: 502 };
  }
  if (!res.ok) {
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

/** Cheap keyword topic tag, used to group the conversation list. */
function topicOf(s) {
  const t = String(s || "").toLowerCase();
  if (/publish|submit|review|approv|reject/.test(t)) return "publishing";
  if (/api|key|endpoint|sdk|token/.test(t)) return "api";
  if (/passkey|2fa|password|security|login|sign in/.test(t)) return "security";
  if (/upload|apk|aab|file|drive|dropbox/.test(t)) return "uploads";
  if (/analytic|download|stats|rating/.test(t)) return "analytics";
  if (/price|pay|monet|revenue/.test(t)) return "payments";
  return "general";
}

/** Follow-ups offered to the developer. Static per topic, so no second AI call. */
function suggestionsFor(topic) {
  const map = {
    publishing: ["How do I publish an app?", "Why is my app still a draft?", "What should the app description include?"],
    api: ["How do I create an API key?", "What can the /api/v1 API do?", "How do I revoke a key?"],
    security: ["How do I add a passkey?", "How do I turn on two-factor authentication?", "I lost my backup codes"],
    uploads: ["What download links are supported?", "Can I use Google Drive?", "How do I ship a new version?"],
    analytics: ["Where do I see download counts?", "How is the rating calculated?"],
    payments: ["Can I charge for an app?"],
    general: ["How do I publish an app?", "How do I add a passkey?", "What download links are supported?"]
  };
  return map[topic] || map.general;
}

/** Docs links relevant to the topic, so an answer can be followed up on. */
function linksFor(topic) {
  const docs = { title: "Developer docs", url: "/developer/docs" };
  const map = {
    publishing: [{ title: "Submit an app", url: "/developer/submit" }, docs],
    api: [{ title: "API keys", url: "/developer/api-keys" }, docs],
    security: [{ title: "Security settings", url: "/developer/security" }, docs],
    uploads: [{ title: "Submit an app", url: "/developer/submit" }, docs],
    analytics: [{ title: "My apps", url: "/developer/apps" }, docs],
    payments: [docs],
    general: [docs]
  };
  return map[topic] || [docs];
}

help.post("/developer/help/chat", async (c) => {
  const g = await gate(c);
  if (g.err) return g.err;
  let body;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, "Expected a JSON body.", "invalid_request");
  }
  const message = String(body?.message || "").trim();
  if (!message) return fail(c, 400, "A message is required.", "invalid_request");
  if (message.length > 2000) return fail(c, 400, "That message is too long (2000 characters maximum).", "invalid_request");

  const topic = topicOf(message);

  // Resolve or create the conversation. A caller-supplied id is checked against
  // the caller's own developer_id so an id cannot be used to read someone
  // else's transcript.
  let conversationId = String(body?.conversation_id || "").trim() || null;
  if (conversationId) {
    const { data } = await sbAdminSelect(
      c.env,
      "developer_help_conversations",
      "select=id&id=eq." + conversationId + "&developer_id=eq." + g.developer.id + "&limit=1"
    );
    if (!(data || []).length) return fail(c, 404, "Conversation not found.", "not_found");
  } else {
    const { data, error } = await sbAdminWrite(c.env, "developer_help_conversations", "POST", {
      developer_id: g.developer.id,
      title: message.slice(0, 80),
      topic,
      started_at: new Date().toISOString(),
      last_message_at: new Date().toISOString()
    });
    if (error) return fail(c, 500, "Could not start the conversation.");
    conversationId = (data || [])[0]?.id || null;
  }

  // Prior turns for context. Capped: an unbounded transcript would eventually
  // exceed the model's context window and cost more per call every time.
  const { data: history } = await sbAdminSelect(
    c.env,
    "developer_help_messages",
    "select=role,content&conversation_id=eq." + conversationId + "&order=created_at.asc&limit=12"
  );
  const messages = [{ role: "system", content: SYSTEM }];
  for (const h of history || []) {
    if (h.role === "user" || h.role === "assistant") messages.push({ role: h.role, content: String(h.content || "").slice(0, 2000) });
  }
  messages.push({ role: "user", content: message });

  await sbAdminWrite(c.env, "developer_help_messages", "POST", {
    conversation_id: conversationId,
    developer_id: g.developer.id,
    role: "user",
    message_type: "text",
    content: message
  });

  const out = await complete(c.env, messages, 600);
  if (out.error) {
    // The developer's question is already saved, so a transient upstream failure
    // does not lose what they typed.
    const res = fail(c, out.status || 502, out.error, out.status === 503 ? "server_error" : "server_error");
    return res;
  }

  const { data: saved } = await sbAdminWrite(c.env, "developer_help_messages", "POST", {
    conversation_id: conversationId,
    developer_id: g.developer.id,
    role: "assistant",
    message_type: "text",
    content: out.text,
    metadata: { model: MODEL, topic }
  });
  await sbAdminWrite(
    c.env,
    "developer_help_conversations",
    "PATCH",
    { last_message_at: new Date().toISOString() },
    "id=eq." + conversationId
  );

  // applyHeaders writes onto the context, so it must run before c.json() builds
  // the response.
  applyHeaders(c, g.rl);
  return c.json({
    success: true,
    response: out.text,
    // `reply` is an alias for `response`: the uploaded specification uses both
    // names in different places, so serving both means a client written against
    // either half of the document works.
    reply: out.text,
    conversation_id: conversationId,
    message_id: (saved || [])[0]?.id || null,
    topic,
    suggestions: suggestionsFor(topic),
    links: linksFor(topic),
    model: MODEL
  });
});

help.get("/developer/help/conversations", async (c) => {
  const token = bearer(c.req.header("Authorization"));
  if (!token) return fail(c, 401, "Sign in to view your help history.", "unauthorized");
  const { data: user, error } = await sbAuth(c.env, "user", { token });
  if (error || !user?.id) return fail(c, 401, "Your session has expired. Sign in again.", "unauthorized");
  const { data: devs } = await sbSelect(c.env, "developers", "select=id&user_id=eq." + user.id + "&limit=1", token);
  const dev = (devs || [])[0];
  if (!dev) return c.json({ conversations: [] });
  const { data } = await sbAdminSelect(
    c.env,
    "developer_help_conversations",
    "select=id,title,topic,started_at,last_message_at&developer_id=eq." + dev.id + "&order=last_message_at.desc&limit=50"
  );
  return c.json({ conversations: data || [] });
});

help.get("/developer/help/conversations/:id", async (c) => {
  const token = bearer(c.req.header("Authorization"));
  if (!token) return fail(c, 401, "Sign in to view your help history.", "unauthorized");
  const { data: user, error } = await sbAuth(c.env, "user", { token });
  if (error || !user?.id) return fail(c, 401, "Your session has expired. Sign in again.", "unauthorized");
  const { data: devs } = await sbSelect(c.env, "developers", "select=id&user_id=eq." + user.id + "&limit=1", token);
  const dev = (devs || [])[0];
  if (!dev) return fail(c, 403, "This account does not have a developer profile.", "forbidden");
  const id = c.req.param("id");
  const { data: conv } = await sbAdminSelect(
    c.env,
    "developer_help_conversations",
    "select=id,title,topic,started_at,last_message_at&id=eq." + id + "&developer_id=eq." + dev.id + "&limit=1"
  );
  if (!(conv || []).length) return fail(c, 404, "Conversation not found.", "not_found");
  const { data: msgs } = await sbAdminSelect(
    c.env,
    "developer_help_messages",
    "select=id,role,content,helpful,created_at&conversation_id=eq." + id + "&order=created_at.asc&limit=200"
  );
  return c.json({ conversation: conv[0], messages: msgs || [] });
});

help.post("/developer/help/feedback", async (c) => {
  const token = bearer(c.req.header("Authorization"));
  if (!token) return fail(c, 401, "Sign in to send feedback.", "unauthorized");
  const { data: user, error } = await sbAuth(c.env, "user", { token });
  if (error || !user?.id) return fail(c, 401, "Your session has expired. Sign in again.", "unauthorized");
  const { data: devs } = await sbSelect(c.env, "developers", "select=id&user_id=eq." + user.id + "&limit=1", token);
  const dev = (devs || [])[0];
  if (!dev) return fail(c, 403, "This account does not have a developer profile.", "forbidden");
  let body;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, "Expected a JSON body.", "invalid_request");
  }
  const messageId = String(body?.message_id || "").trim();
  if (!messageId) return fail(c, 400, "message_id is required.", "invalid_request");
  if (typeof body.helpful !== "boolean") return fail(c, 400, "helpful must be true or false.", "invalid_request");
  const { data, error: wErr } = await sbAdminWrite(
    c.env,
    "developer_help_messages",
    "PATCH",
    { helpful: body.helpful, feedback: String(body.comment || "").slice(0, 1000) || null },
    "id=eq." + messageId + "&developer_id=eq." + dev.id
  );
  if (wErr) return fail(c, 500, "Could not record your feedback.");
  if (!(data || []).length) return fail(c, 404, "Message not found.", "not_found");
  return c.json({ success: true });
});

export default help;
