import { html, raw } from "hono/html";
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
  { href: "/developer/assistant", label: "AI Assistant", icon: "fa-wand-magic-sparkles", key: "assistant" },
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

function layout(o) {
  const mode = o.mode || "store";
  const nav = mode === "developer" ? NAV_DEV : NAV_STORE;
  const desc = o.description || "Discover, browse and download apps \u2014 the open, developer-first app store.";
  return html`<!DOCTYPE html>
<html lang="en" data-mode="${mode}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="theme-color" content="#0b1020" />
<title>${o.title} · ${SITE_NAME}</title>
<meta name="description" content="${desc}" />
${SITE_VERIFICATION ? raw(`<meta name="google-site-verification" content="${esc(SITE_VERIFICATION)}" />`) : ""}
<meta property="og:title" content="${o.title} · ${SITE_NAME}" />
<meta property="og:description" content="${desc}" />
<meta property="og:type" content="website" />
${o.ogImage ? raw(`<meta property="og:image" content="${esc(o.ogImage)}" />`) : ""}
${o.canonical ? raw(`<link rel="canonical" href="${esc(o.canonical)}" />`) : ""}
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
  setSiteVerification
};
