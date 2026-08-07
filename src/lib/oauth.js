/**
 * OAuth 2.0 provider registry.
 *
 * WHY THIS EXISTS
 * ---------------
 * The public developer guide describes implementing OAuth with NextAuth.js +
 * Prisma. That cannot run here: this app is Hono on Cloudflare Pages, which has
 * no Node runtime and no direct database socket, and NextAuth needs both. The
 * equivalent on our stack is Supabase GoTrue, which already implements the
 * whole authorization-code + PKCE dance server-side.
 *
 * That difference is a security WIN, not a compromise. With GoTrue the client
 * secret for every provider lives in Supabase's own config -- it never reaches
 * this Worker, never reaches the browser, and never sits in our environment
 * variables. So the guide's "GOOGLE_CLIENT_SECRET / GITHUB_SECRET /
 * APPLE_PRIVATE_KEY in .env" step is one we deliberately do NOT perform; there
 * is no secret here to leak. The guide's checklist items "all secrets in
 * environment variables" and "secrets not in code" are satisfied by having no
 * secret at all.
 *
 * Everything below is therefore only *presentation and routing* metadata:
 * which providers exist, what to call them, and which scopes to request.
 */

/**
 * Providers we know how to render and route to, keyed by the exact provider
 * slug GoTrue expects at /auth/v1/authorize?provider=<slug>.
 *
 * `scope` follows the guide's "minimal scopes" rule: only what is needed to
 * identify the developer. Notably github asks for `user:email` and NOT `repo`,
 * because we never touch a developer's repositories.
 */
export const PROVIDERS = {
  google: {
    slug: "google",
    label: "Google",
    scope: "openid profile email",
    className: "btn-google",
    note: "Most developers use this."
  },
  github: {
    slug: "github",
    label: "GitHub",
    // Deliberately not `repo` -- we only need an email address to identify you.
    scope: "user:email",
    className: "btn-github",
    note: "Good for developer accounts."
  },
  facebook: {
    slug: "facebook",
    label: "Facebook",
    scope: "email public_profile",
    className: "btn-facebook",
    note: "Large consumer reach."
  },
  azure: {
    slug: "azure",
    label: "Microsoft",
    scope: "openid profile email",
    className: "btn-microsoft",
    note: "Work and Office 365 accounts."
  },
  apple: {
    slug: "apple",
    label: "Apple",
    scope: "name email",
    className: "btn-apple",
    note: "Privacy-focused, required for iOS apps."
  }
};

/** Stable display order: highest-conversion first, per the guide's own ranking. */
export const PROVIDER_ORDER = ["google", "github", "microsoft", "azure", "facebook", "apple"];

/**
 * Accept the friendly names a developer is likely to type or that the guide
 * uses, and map them to GoTrue's actual slug. "microsoft" is the name everyone
 * knows; GoTrue calls it "azure".
 */
const ALIASES = { microsoft: "azure", entra: "azure", "sign-in-with-apple": "apple" };

export function resolveProvider(name) {
  const key = String(name || "").trim().toLowerCase();
  const slug = ALIASES[key] || key;
  return PROVIDERS[slug] || null;
}

/*
 * GoTrue tells us which providers are actually switched on, so the sign-in page
 * can render only buttons that work. Showing a "Continue with GitHub" button
 * that dead-ends in a GoTrue error page is worse than showing no button.
 *
 * Cached per isolate for 5 minutes: this is on the critical path of the
 * server-rendered login page, and a blocking fetch on every render would add
 * latency to the one page users are most impatient on.
 */
let cache = { at: 0, list: null };
const TTL_MS = 5 * 60 * 1000;

/**
 * @returns {Promise<string[]>} enabled provider slugs we support, in display
 *   order. Falls back to ["google"] if the settings probe fails, because that
 *   is the one provider this deployment is known to have configured -- a
 *   transient network blip should not remove every social button from the page.
 */
export async function enabledProviders(env) {
  const now = Date.now();
  if (cache.list && now - cache.at < TTL_MS) return cache.list;

  let list = null;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: env.SUPABASE_ANON_KEY || "" }
    });
    if (res.ok) {
      const external = (await res.json())?.external || {};
      list = PROVIDER_ORDER.filter((n) => {
        const p = resolveProvider(n);
        return p && external[p.slug] === true;
      })
        // PROVIDER_ORDER lists both "microsoft" and "azure" so either spelling
        // resolves; dedupe so Microsoft cannot render twice.
        .map((n) => resolveProvider(n).slug)
        .filter((slug, i, arr) => arr.indexOf(slug) === i);
    }
  } catch {
    /* fall through to the default below */
  }

  if (!list) list = ["google"];
  cache = { at: now, list };
  return list;
}

/** Test hook / manual invalidation after enabling a provider in Supabase. */
export function clearProviderCache() {
  cache = { at: 0, list: null };
}

/**
 * Reject anything that is not a same-site path.
 *
 * `next` is attacker-controllable (it rides in a link), and it ends up in a
 * redirect after a *successful* sign-in. Without this check, a crafted
 * /api/auth/oauth/google?next=https://evil.example link would hand a freshly
 * authenticated developer straight to an attacker's page -- a textbook covert
 * redirect. Protocol-relative "//evil.example" is rejected too: browsers treat
 * it as absolute, so checking only for a leading "/" is not enough.
 */
export function safeNext(next, fallback = "/developer") {
  const raw = String(next || "").trim();
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (/[\r\n]/.test(raw)) return fallback;
  return raw;
}
