import { html, raw } from "hono/html";
import { ldScript } from "../lib/seo.js";
const SITE_NAME = "Open Appstore";
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const NAV_STORE = [
  { href: "/", label: "Discover", icon: "fa-compass", key: "home" },
  { href: "/apps", label: "Browse", icon: "fa-grip", key: "apps" },
  { href: "/categories", label: "Categories", icon: "fa-layer-group", key: "categories" },
  { href: "/top-charts", label: "Top Charts", icon: "fa-ranking-star", key: "charts" },
  { href: "/developers", label: "Developers", icon: "fa-users", key: "developers" }
];
const NAV_DEV = [
  { href: "/developer", label: "Dashboard", icon: "fa-gauge-high", key: "dash" },
  { href: "/developer/apps", label: "My Apps", icon: "fa-cubes", key: "myapps" },
  { href: "/developer/submit", label: "Submit App", icon: "fa-cloud-arrow-up", key: "submit" },
  { href: "/developer/profile", label: "Profile", icon: "fa-id-badge", key: "profile" },
  { href: "/developer/api-keys", label: "API Keys", icon: "fa-key", key: "apikeys" },
  { href: "/developer/security", label: "Security", icon: "fa-shield-halved", key: "security" },
  { href: "/developer/docs", label: "API Docs", icon: "fa-book", key: "docs" }
];
/*
 * Google Search Console verification token.
 *
 * Held module-side and set once per request by middleware rather than threaded
 * through all 21 layout() call sites: a token present on EVERY page means any
 * URL of the property can be verified, and a newly added page can never ship
 * unverified by accident. Read from the environment so it is not committed.
 */
let SITE_VERIFICATION = "";
function setSiteVerification(token) {
  SITE_VERIFICATION = typeof token === "string" ? token.trim() : "";
}

/*
 * Canonical origin for the current request, set by the same middleware.
 *
 * Canonical/og:url must be ABSOLUTE, and the origin is only knowable per
 * request (preview deployments each get their own *.pages.dev hostname). Held
 * module-side for the same reason as the verification token: threading it
 * through 22 layout() call sites means the one page someone forgets to update
 * silently ships without a canonical URL, which is exactly the duplicate-content
 * problem canonicals exist to solve.
 */
let SITE_ORIGIN = "";
let REQUEST_PATH = "/";

/*
 * Query parameters that produce a genuinely DISTINCT document and must survive
 * into the canonical URL.
 *
 * `category` is the only one: /apps?category=Games is a different listing with
 * different content, and it is listed in sitemap.xml -- if the canonical
 * stripped it, every category page would canonicalise to /apps and Search
 * Console would report "Alternate page with proper canonical tag" for all of
 * them, i.e. none would ever be indexed.
 *
 * Everything else (sort, price, page, search) only reorders or filters the same
 * underlying set, so those variants canonicalise to the bare path on purpose --
 * that is what stops a dozen near-duplicates competing with each other.
 */
const CANONICAL_PARAMS = ["category"];

/*
 * Path prefixes that must never be indexed, mirroring robots.txt.
 *
 * Derived from the path rather than passed per route on purpose: there are 13
 * developer-console routes and 5 auth routes, and the whole point is that a
 * NEW private page added later is noindex by default instead of depending on
 * whoever adds it remembering the flag.
 *
 * robots.txt Disallow alone is NOT sufficient: a disallowed URL can still be
 * indexed (without a snippet) if something links to it, because the crawler
 * never fetches the page to see the directive. Belt and braces -- the meta tag
 * here is what actually keeps it out of the index.
 */
const NOINDEX_PREFIXES = ["/developer", "/auth"];
function pathIsPrivate(path) {
  return NOINDEX_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

function setRequestUrl(url) {
  try {
    const u = new URL(url);
    SITE_ORIGIN = u.origin;
    const keep = new URLSearchParams();
    CANONICAL_PARAMS.forEach((k) => {
      const v = u.searchParams.get(k);
      // "All" is the default, so ?category=All IS /apps and must collapse to it.
      if (v && v !== "All") keep.set(k, v);
    });
    const qs = keep.toString();
    REQUEST_PATH = `${u.pathname || "/"}${qs ? `?${qs}` : ""}`;
  } catch {
    SITE_ORIGIN = "";
    REQUEST_PATH = "/";
  }
}
function siteOrigin() {
  return SITE_ORIGIN;
}

function layout(o) {
  const mode = o.mode || "store";
  const nav = mode === "developer" ? NAV_DEV : NAV_STORE;
  const desc = o.description || "Discover, browse and download apps \u2014 the open, developer-first app store.";
  const fullTitle = `${o.title} \u00b7 ${SITE_NAME}`;
  // Explicit o.canonical wins (a page that knows it is a duplicate of another
  // can point at the original); otherwise derive it from the request path.
  const canonical = o.canonical || (SITE_ORIGIN ? `${SITE_ORIGIN}${REQUEST_PATH}` : "");
  const ogImage = o.ogImage || (SITE_ORIGIN ? `${SITE_ORIGIN}/static/icon-512.png` : "");
  /*
   * Indexing directives.
   *
   * Pages pass `noindex: true` for anything transactional or private (auth
   * screens, the developer console). `follow` is kept even when noindexing so
   * link equity still flows through to the public pages those screens link to.
   * `max-image-preview:large` opts into the big thumbnail in search results,
   * which is what makes an app icon show up next to the listing.
   */
  const robots = o.noindex || pathIsPrivate(REQUEST_PATH)
    ? "noindex, follow"
    : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
  const jsonLd = Array.isArray(o.jsonLd) ? o.jsonLd.filter(Boolean) : o.jsonLd ? [o.jsonLd] : [];
  return html`<!DOCTYPE html>
<html lang="en" data-mode="${mode}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="theme-color" content="#0b1020" />
<title>${fullTitle}</title>
<meta name="description" content="${desc}" />
${SITE_VERIFICATION ? raw(`<meta name="google-site-verification" content="${esc(SITE_VERIFICATION)}" />`) : ""}
<meta name="robots" content="${robots}" />
<meta name="googlebot" content="${robots}" />
${canonical ? raw(`<link rel="canonical" href="${esc(canonical)}" />`) : ""}
<meta property="og:site_name" content="${SITE_NAME}" />
<meta property="og:title" content="${fullTitle}" />
<meta property="og:description" content="${desc}" />
<meta property="og:type" content="${o.ogType || "website"}" />
<meta property="og:locale" content="en_US" />
${canonical ? raw(`<meta property="og:url" content="${esc(canonical)}" />`) : ""}
${ogImage ? raw(`<meta property="og:image" content="${esc(ogImage)}" />
<meta property="og:image:alt" content="${esc(o.title)}" />`) : ""}
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${fullTitle}" />
<meta name="twitter:description" content="${desc}" />
${ogImage ? raw(`<meta name="twitter:image" content="${esc(ogImage)}" />
<meta name="twitter:image:alt" content="${esc(o.title)}" />`) : ""}
<meta name="application-name" content="${SITE_NAME}" />
<meta name="apple-mobile-web-app-title" content="${SITE_NAME}" />
<meta name="format-detection" content="telephone=no" />
${jsonLd.length ? raw(jsonLd.map((n) => ldScript(n)).join("\n")) : ""}
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/static/apple-touch-icon.png" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.2/css/all.min.css" rel="stylesheet" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
<link href="/static/app.css" rel="stylesheet" />
</head>
<body class="${o.bodyClass || ""}" data-mode="${mode}">
<a class="skip-link" href="#main-content">Skip to content</a>

<div id="toast-host" class="toast-host" aria-live="polite" aria-atomic="true"></div>

<header id="site-header" class="site-header">
  <div class="header-inner">
    <a class="brand" href="${mode === "developer" ? "/developer" : "/"}" aria-label="${SITE_NAME} home">
      <img class="brand-mark" src="/static/logo.svg" alt="" width="40" height="40" />
      <span class="brand-text">
        <strong>Open Appstore</strong>
        <em>${mode === "developer" ? "Developer Console" : "Discover great apps"}</em>
      </span>
    </a>

    <form id="header-search" class="header-search" role="search" action="/apps" method="get">
      <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
      <input id="header-search-input" type="search" name="search" placeholder="Search apps, categories, developers…" autocomplete="off" aria-label="Search apps" />
      <kbd>/</kbd>
      <div id="search-suggest" class="search-suggest" hidden role="listbox" aria-label="Search suggestions"></div>
    </form>

    <nav class="mode-switch" id="mode-switch" aria-label="Switch between store and developer console">
      <a href="/" class="mode-switch-btn ${mode === "store" ? "is-active" : ""}" data-mode-target="store">
        <i class="fa-solid fa-store" aria-hidden="true"></i><span>Store</span>
      </a>
      <a href="/developer" class="mode-switch-btn ${mode === "developer" ? "is-active" : ""}" data-mode-target="developer">
        <i class="fa-solid fa-code" aria-hidden="true"></i><span>Developer</span>
      </a>
    </nav>

    <div class="header-actions">
      <button id="theme-toggle" class="icon-btn" type="button" title="Toggle theme" aria-label="Toggle dark mode">
        <i class="fa-solid fa-moon" aria-hidden="true"></i>
      </button>
      <div id="account-slot" class="account-slot">
        <a class="btn btn-ghost btn-sm" href="/auth/login"><i class="fa-solid fa-right-to-bracket"></i><span>Sign in</span></a>
      </div>
      <button id="nav-toggle" class="icon-btn nav-toggle" type="button" aria-label="Open menu" aria-expanded="false">
        <i class="fa-solid fa-bars"></i>
      </button>
    </div>
  </div>

  <nav id="primary-nav" class="primary-nav" aria-label="Primary">
    <div class="primary-nav-inner">
      ${raw(
    nav.map(
      (n) => `<a href="${n.href}" class="nav-link${o.active === n.key ? " is-active" : ""}"><i class="fa-solid ${n.icon}" aria-hidden="true"></i><span>${n.label}</span></a>`
    ).join("")
  )}
    </div>
  </nav>
</header>

<main id="main-content" class="site-main">
${o.body}
</main>

<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <img class="brand-mark" src="/static/logo.svg" alt="" width="40" height="40" />
      <div>
        <strong>Open Appstore</strong>
        <p>An open, developer-first catalogue of apps. Publish once, reach everyone.</p>
      </div>
    </div>
    <div class="footer-cols">
      <div>
        <h4>Store</h4>
        <a href="/apps">Browse apps</a>
        <a href="/top-charts">Top charts</a>
        <a href="/categories">Categories</a>
        <a href="/developers">Developers</a>
      </div>
      <div>
        <h4>Developers</h4>
        <a href="/developer">Console</a>
        <a href="/developer/submit">Submit an app</a>
        <a href="/developer/docs">API docs</a>
        <a href="/developer/security">Account security</a>
        <a href="/api/apps">Public API</a>
      </div>
      <div>
        <h4>Account</h4>
        <a href="/auth/login">Sign in</a>
        <a href="/auth/signup">Create account</a>
        <a href="/auth/reset">Reset password</a>
      </div>
      <div>
        <h4>Legal</h4>
        <a href="/legal/privacy">Privacy</a>
        <a href="/legal/terms">Terms</a>
        <a href="/legal/guidelines">Guidelines</a>
      </div>
    </div>
  </div>
  <div class="footer-bottom">
    <p>&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Open Appstore. Powered by Hono on Cloudflare + Supabase.</p>
    <div class="footer-social">
      <a href="/developer/docs" aria-label="API documentation"><i class="fa-solid fa-book"></i></a>
      <a href="/api/apps" aria-label="JSON API"><i class="fa-solid fa-code"></i></a>
    </div>
  </div>
</footer>

<nav class="mobile-tabbar" aria-label="Mobile navigation">
  ${raw(
    (mode === "developer" ? [
      { href: "/developer", icon: "fa-gauge-high", label: "Dash", key: "dash" },
      { href: "/developer/apps", icon: "fa-cubes", label: "Apps", key: "myapps" },
      { href: "/developer/submit", icon: "fa-plus", label: "Submit", key: "submit" },
      { href: "/developer/profile", icon: "fa-id-badge", label: "Profile", key: "profile" },
      { href: "/", icon: "fa-store", label: "Store", key: "store" }
    ] : [
      { href: "/", icon: "fa-compass", label: "Discover", key: "home" },
      { href: "/apps", icon: "fa-grip", label: "Browse", key: "apps" },
      { href: "/categories", icon: "fa-layer-group", label: "Categories", key: "categories" },
      { href: "/top-charts", icon: "fa-ranking-star", label: "Charts", key: "charts" },
      { href: "/developer", icon: "fa-code", label: "Developer", key: "devmode" }
    ]).map(
      (t) => `<a href="${t.href}" class="tabbar-link${o.active === t.key ? " is-active" : ""}"><i class="fa-solid ${t.icon}"></i><span>${t.label}</span></a>`
    ).join("")
  )}
</nav>

<!-- Sarath, the floating AI assistant. Rendered on every page from the layout so it is
     reachable from anywhere, per spec. The panel ships collapsed and inert:
     the hidden attribute keeps it out of the accessibility tree until opened,
     and no AI request is made until the visitor actually sends a message.
     (No backticks in this comment: it sits inside a template literal.) -->
<div id="ai-widget" class="ai-widget" data-open="false">
  <button id="ai-widget-toggle" class="ai-fab" type="button" aria-expanded="false" aria-controls="ai-widget-panel" aria-label="Open Sarath, the AI assistant">
    <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
  </button>
  <section id="ai-widget-panel" class="ai-panel" role="dialog" aria-label="Sarath, the AI assistant" aria-modal="false" hidden>
    <header class="ai-panel-head">
      <span class="ai-panel-title"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Sarath <small class="ai-panel-sub">AI app guide</small></span>
      <button id="ai-widget-close" class="icon-btn" type="button" aria-label="Close Sarath"><i class="fa-solid fa-xmark"></i></button>
    </header>
    <div id="ai-widget-log" class="ai-log" role="log" aria-live="polite" aria-atomic="false"></div>
    <form id="ai-widget-form" class="ai-panel-form" autocomplete="off">
      <label class="sr-only" for="ai-widget-input">Your message</label>
      <input id="ai-widget-input" class="ai-panel-input" type="text" maxlength="500" placeholder="Ask Sarath… e.g. I need a photo editor" />
      <button class="btn btn-primary ai-panel-send" type="submit" aria-label="Send"><i class="fa-solid fa-paper-plane"></i></button>
    </form>
  </section>
</div>

<script>window.__BOOT__ = ${raw(JSON.stringify(o.bootstrap ?? {}).replace(/</g, "\\u003c"))};</script>
<script src="/static/app.js" type="module"></script>
${raw((o.scripts || []).map((s) => `<script src="${esc(s)}" type="module"></script>`).join("\n"))}
</body>
</html>`;
}
export {
  SITE_NAME,
  esc,
  layout,
  setSiteVerification,
  setRequestUrl,
  siteOrigin
};
