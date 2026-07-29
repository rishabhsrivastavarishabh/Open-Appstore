import { raw } from 'hono/html'
import { esc } from './layout'
import { CATEGORIES } from '../lib/types'

const CAT_OPTIONS = (selected = '') =>
  ['Other', ...CATEGORIES]
    .map((c) => `<option value="${esc(c)}" ${selected === c ? 'selected' : ''}>${esc(c)}</option>`)
    .join('')

/** Shared gate shown while auth state resolves / when signed out */
const authGate = (title: string, msg: string) => `
<div id="auth-gate" class="auth-gate" hidden>
  <span class="empty-icon"><i class="fa-solid fa-lock"></i></span>
  <h2>${esc(title)}</h2>
  <p>${esc(msg)}</p>
  <div class="gate-actions">
    <a class="btn btn-primary" href="/auth/login?next=${'${location.pathname}'}" data-next-link><i class="fa-solid fa-right-to-bracket"></i> Sign in</a>
    <a class="btn btn-outline" href="/auth/signup"><i class="fa-solid fa-user-plus"></i> Create account</a>
  </div>
</div>
<div id="auth-loading" class="auth-loading"><span class="spinner"></span><p>Checking your session…</p></div>`

/** ===================== DEVELOPER DASHBOARD ===================== */
export function devDashboardPage() {
  return raw(`
<section class="dev-head">
  <div class="dev-head-inner">
    <div>
      <p class="dev-eyebrow"><i class="fa-solid fa-code"></i> Developer Console</p>
      <h1 id="dev-greeting">Dashboard</h1>
      <p id="dev-subtitle">Manage your listings, track downloads and publish new releases.</p>
    </div>
    <div class="dev-head-actions">
      <a class="btn btn-primary" href="/developer/submit"><i class="fa-solid fa-plus"></i> New app</a>
      <a class="btn btn-outline-light" href="/developer/docs"><i class="fa-solid fa-book"></i> API docs</a>
    </div>
  </div>
</section>

${authGate('Developer sign-in required', 'Sign in to access your developer console, publish apps and view analytics.')}

<div id="dev-content" hidden>
  <section id="profile-banner-slot"></section>

  <section class="section">
    <div class="metric-grid" id="dev-metrics">
      <div class="metric-card"><span class="metric-icon" style="--m:#3b82f6"><i class="fa-solid fa-cubes"></i></span><div><strong id="m-total">0</strong><small>Total apps</small></div></div>
      <div class="metric-card"><span class="metric-icon" style="--m:#22c55e"><i class="fa-solid fa-circle-check"></i></span><div><strong id="m-published">0</strong><small>Published</small></div></div>
      <div class="metric-card"><span class="metric-icon" style="--m:#f59e0b"><i class="fa-solid fa-pen-ruler"></i></span><div><strong id="m-drafts">0</strong><small>Drafts</small></div></div>
      <div class="metric-card"><span class="metric-icon" style="--m:#8b5cf6"><i class="fa-solid fa-download"></i></span><div><strong id="m-downloads">0</strong><small>Downloads</small></div></div>
      <div class="metric-card"><span class="metric-icon" style="--m:#ec4899"><i class="fa-solid fa-star"></i></span><div><strong id="m-rating">—</strong><small>Avg rating</small></div></div>
    </div>
  </section>

  <section class="section section-split-wide">
    <div class="split-col">
      <div class="section-head"><div><h2>Your apps</h2><p>Newest first</p></div><a class="section-link" href="/developer/apps">Manage all <i class="fa-solid fa-arrow-right"></i></a></div>
      <div id="dev-app-list" class="dev-app-list"><div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div></div>
    </div>
    <div class="split-col">
      <div class="section-head"><div><h2>Quick actions</h2><p>Common tasks</p></div></div>
      <div class="quick-actions">
        <a class="quick-action" href="/developer/submit"><span style="--m:#3b82f6"><i class="fa-solid fa-cloud-arrow-up"></i></span><div><strong>Submit a new app</strong><small>Create a listing in under 2 minutes</small></div><i class="fa-solid fa-chevron-right"></i></a>
        <a class="quick-action" href="/developer/apps"><span style="--m:#22c55e"><i class="fa-solid fa-pen-to-square"></i></span><div><strong>Edit existing listings</strong><small>Update version, price or description</small></div><i class="fa-solid fa-chevron-right"></i></a>
        <a class="quick-action" href="/developer/profile"><span style="--m:#f59e0b"><i class="fa-solid fa-id-badge"></i></span><div><strong>Developer profile</strong><small>Studio name, logo, website</small></div><i class="fa-solid fa-chevron-right"></i></a>
        <a class="quick-action" href="/developer/docs"><span style="--m:#8b5cf6"><i class="fa-solid fa-book"></i></span><div><strong>API documentation</strong><small>Endpoints, auth &amp; examples</small></div><i class="fa-solid fa-chevron-right"></i></a>
        <a class="quick-action" href="/"><span style="--m:#06b6d4"><i class="fa-solid fa-store"></i></span><div><strong>Switch to Store</strong><small>See your apps as users do</small></div><i class="fa-solid fa-chevron-right"></i></a>
      </div>
    </div>
  </section>
</div>
`)
}

/** ===================== MY APPS ===================== */
export function devAppsPage() {
  return raw(`
<section class="dev-head">
  <div class="dev-head-inner">
    <div>
      <p class="dev-eyebrow"><i class="fa-solid fa-cubes"></i> Developer Console</p>
      <h1>My apps</h1>
      <p>Edit listings, switch between draft and published, or remove an app.</p>
    </div>
    <div class="dev-head-actions">
      <a class="btn btn-primary" href="/developer/submit"><i class="fa-solid fa-plus"></i> New app</a>
    </div>
  </div>
</section>

${authGate('Developer sign-in required', 'Sign in to manage your app listings.')}

<div id="dev-content" hidden>
  <section id="profile-banner-slot"></section>
  <section class="section">
    <div class="manage-toolbar">
      <div class="input-icon">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="search" id="manage-search" placeholder="Filter your apps…" />
      </div>
      <div class="tabs tabs-sm" role="tablist">
        <button class="tab-btn is-active" data-status="all">All</button>
        <button class="tab-btn" data-status="published">Published</button>
        <button class="tab-btn" data-status="draft">Drafts</button>
      </div>
    </div>
    <div id="manage-list" class="manage-list"><div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div></div>
  </section>
</div>

<dialog id="edit-dialog" class="dialog">
  <form id="edit-form" class="dialog-form">
    <header class="dialog-head">
      <h2><i class="fa-solid fa-pen-to-square"></i> Edit app</h2>
      <button type="button" class="icon-btn" data-close-dialog aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
    </header>
    <div class="dialog-body form-grid">
      <input type="hidden" name="id" />
      <label class="field"><span>App name *</span><input name="app_name" required maxlength="120" /></label>
      <label class="field"><span>Category *</span><select name="category">${CAT_OPTIONS()}</select></label>
      <label class="field field-full"><span>Description *</span><textarea name="description" rows="6" required></textarea></label>
      <label class="field"><span>Version</span><input name="version" placeholder="1.0.0" /></label>
      <label class="field"><span>Icon URL</span><input name="icon_url" type="url" placeholder="https://…/icon.png" /></label>
      <label class="field"><span>Download URL</span><input name="download_url" type="url" placeholder="https://…" /></label>
      <label class="field"><span>Website</span><input name="website" type="url" placeholder="https://…" /></label>
      <label class="field"><span>Support email</span><input name="support_email" type="email" /></label>
      <label class="field"><span>Pricing</span>
        <select name="is_free" id="edit-is-free"><option value="true">Free</option><option value="false">Paid</option></select>
      </label>
      <label class="field" id="edit-price-field" hidden><span>Price (USD)</span><input name="price" type="number" min="0" step="0.01" /></label>
      <label class="field"><span>Status</span><select name="status"><option value="draft">Draft</option><option value="published">Published</option></select></label>
    </div>
    <footer class="dialog-foot">
      <button type="button" class="btn btn-ghost" data-close-dialog>Cancel</button>
      <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Save changes</button>
    </footer>
  </form>
</dialog>
`)
}

/** ===================== SUBMIT APP ===================== */
export function devSubmitPage() {
  return raw(`
<section class="dev-head">
  <div class="dev-head-inner">
    <div>
      <p class="dev-eyebrow"><i class="fa-solid fa-cloud-arrow-up"></i> Developer Console</p>
      <h1>Submit a new app</h1>
      <p>Fill in your listing details. Save as draft first, or publish straight to the store.</p>
    </div>
  </div>
</section>

${authGate('Developer sign-in required', 'Sign in to submit an app to the store.')}

<div id="dev-content" hidden>
  <section id="profile-banner-slot"></section>
  <section class="section submit-layout">
    <form id="submit-form" class="card form-card">
      <h2 class="card-title"><i class="fa-solid fa-circle-info"></i> Listing details</h2>
      <div class="form-grid">
        <label class="field"><span>App name *</span><input name="app_name" required maxlength="120" placeholder="My Awesome App" /></label>
        <label class="field"><span>URL slug</span><input name="app_slug" placeholder="auto-generated" pattern="[a-zA-Z0-9\\-\\s]*" /></label>
        <label class="field field-full"><span>Description * <small>Markdown supported</small></span><textarea name="description" rows="8" required placeholder="What does your app do? Key features, requirements, links…"></textarea></label>
        <label class="field"><span>Category *</span><select name="category" required>${CAT_OPTIONS('Productivity')}</select></label>
        <label class="field"><span>Version</span><input name="version" placeholder="1.0.0" value="1.0.0" /></label>
        <label class="field"><span>Icon URL</span><input name="icon_url" type="url" placeholder="https://…/icon.png" /></label>
        <label class="field"><span>Download URL</span><input name="download_url" type="url" placeholder="https://…/app.apk" /></label>
        <label class="field"><span>Website</span><input name="website" type="url" placeholder="https://myapp.com" /></label>
        <label class="field"><span>Support email</span><input name="support_email" type="email" placeholder="support@myapp.com" /></label>
        <label class="field"><span>Pricing</span><select name="is_free" id="submit-is-free"><option value="true">Free</option><option value="false">Paid</option></select></label>
        <label class="field" id="submit-price-field" hidden><span>Price (USD)</span><input name="price" type="number" min="0" step="0.01" value="0" /></label>
        <label class="field field-full"><span>Screenshot URLs <small>one per line, optional</small></span><textarea name="screenshots" rows="3" placeholder="https://…/1.png&#10;https://…/2.png"></textarea></label>
      </div>
      <div class="form-actions">
        <button class="btn btn-outline" type="submit" name="intent" value="draft"><i class="fa-solid fa-floppy-disk"></i> Save as draft</button>
        <button class="btn btn-primary" type="submit" name="intent" value="published"><i class="fa-solid fa-rocket"></i> Publish now</button>
      </div>
      <p class="form-note"><i class="fa-solid fa-shield-halved"></i> Your app is linked to your developer profile. You can edit or unpublish it at any time.</p>
    </form>

    <aside class="submit-side">
      <div class="card preview-card">
        <h2 class="card-title"><i class="fa-solid fa-eye"></i> Live preview</h2>
        <div id="live-preview" class="preview-shell">
          <div class="app-card">
            <div class="app-card-banner" style="--cat-color:#3b82f6"><i class="fa-solid fa-bolt"></i></div>
            <div class="app-card-head">
              <span class="app-icon app-icon-fallback" id="pv-icon">AA</span>
              <div class="app-card-title"><h3 id="pv-name">My Awesome App</h3><p class="app-card-dev" id="pv-dev">Your studio</p></div>
            </div>
            <p class="app-card-desc" id="pv-desc">Your description preview appears here as you type.</p>
            <div class="app-card-meta">
              <span class="pill pill-cat" style="--cat-color:#3b82f6" id="pv-cat">Productivity</span>
              <span class="pill pill-muted">New</span>
              <span class="pill"><i class="fa-solid fa-download"></i> —</span>
            </div>
            <div class="app-card-foot"><span class="price is-free" id="pv-price">Free</span><span class="btn btn-primary btn-sm">Get</span></div>
          </div>
        </div>
      </div>
      <div class="card tips-card">
        <h2 class="card-title"><i class="fa-solid fa-lightbulb"></i> Listing tips</h2>
        <ul class="tips-list">
          <li><i class="fa-solid fa-check"></i> Use a square PNG icon (512×512) for the crispest result.</li>
          <li><i class="fa-solid fa-check"></i> Open the first paragraph with the single biggest benefit.</li>
          <li><i class="fa-solid fa-check"></i> Use <code>## Headings</code> and <code>- bullets</code> — markdown renders on the detail page.</li>
          <li><i class="fa-solid fa-check"></i> A working download URL means users can install in one tap.</li>
          <li><i class="fa-solid fa-check"></i> Save as draft to preview privately before going live.</li>
        </ul>
      </div>
    </aside>
  </section>
</div>
`)
}

/** ===================== DEVELOPER PROFILE ===================== */
export function devProfilePage() {
  return raw(`
<section class="dev-head">
  <div class="dev-head-inner">
    <div>
      <p class="dev-eyebrow"><i class="fa-solid fa-id-badge"></i> Developer Console</p>
      <h1>Developer profile</h1>
      <p>This is what users see on your public developer page and on every app listing.</p>
    </div>
    <div class="dev-head-actions">
      <a class="btn btn-outline-light" id="view-public-profile" href="/developers"><i class="fa-solid fa-arrow-up-right-from-square"></i> Public page</a>
    </div>
  </div>
</section>

${authGate('Developer sign-in required', 'Sign in to create or edit your developer profile.')}

<div id="dev-content" hidden>
  <section class="section submit-layout">
    <form id="profile-form" class="card form-card">
      <h2 class="card-title"><i class="fa-solid fa-user-tie"></i> Studio information</h2>
      <div class="form-grid">
        <label class="field"><span>Developer / studio name *</span><input name="developer_name" required maxlength="120" placeholder="Tech Studio" /></label>
        <label class="field"><span>Company name</span><input name="company_name" maxlength="120" /></label>
        <label class="field field-full"><span>Bio / description</span><textarea name="description" rows="4" placeholder="Tell users what you build…"></textarea></label>
        <label class="field"><span>Website</span><input name="website" type="url" placeholder="https://…" /></label>
        <label class="field"><span>Contact email</span><input name="email" type="email" /></label>
        <label class="field"><span>Phone</span><input name="phone" /></label>
        <label class="field"><span>Logo URL</span><input name="logo_url" type="url" placeholder="https://…/logo.png" /></label>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> Save profile</button>
      </div>
      <p class="form-note" id="profile-status"></p>
    </form>

    <aside class="submit-side">
      <div class="card">
        <h2 class="card-title"><i class="fa-solid fa-circle-user"></i> Account</h2>
        <dl class="info-list">
          <dt>Email</dt><dd id="acct-email">—</dd>
          <dt>User ID</dt><dd><code class="code-inline" id="acct-id">—</code></dd>
          <dt>Verified</dt><dd id="acct-verified">—</dd>
          <dt>Developer ID</dt><dd><code class="code-inline" id="acct-dev-id">—</code></dd>
          <dt>Status</dt><dd id="acct-dev-status">—</dd>
        </dl>
        <button class="btn btn-ghost btn-block btn-sm" id="logout-btn" type="button"><i class="fa-solid fa-right-from-bracket"></i> Sign out</button>
      </div>
      <div class="card">
        <h2 class="card-title"><i class="fa-solid fa-shield-halved"></i> Security</h2>
        <p class="muted">Password resets and email confirmation are handled by Supabase Auth.</p>
        <a class="btn btn-outline btn-block btn-sm" href="/auth/reset"><i class="fa-solid fa-key"></i> Reset password</a>
      </div>
    </aside>
  </section>
</div>
`)
}

/** ===================== AUTH PAGES ===================== */
export function authPage(mode: 'login' | 'signup' | 'reset') {
  const titles = {
    login: { h: 'Welcome back', p: 'Sign in to manage your apps and reviews.' },
    signup: { h: 'Create your account', p: 'One account for browsing, reviewing and publishing apps.' },
    reset: { h: 'Reset your password', p: 'We will email you a secure reset link.' },
  }[mode]

  return raw(`
<section class="auth-layout">
  <div class="auth-panel">
    <a class="auth-brand" href="/"><img class="brand-mark" src="/static/logo.svg" alt="" width="40" height="40" /> Open App Store</a>
    <h1>${esc(titles.h)}</h1>
    <p class="auth-sub">${esc(titles.p)}</p>

    <div class="auth-tabs">
      <a href="/auth/login" class="${mode === 'login' ? 'is-active' : ''}">Sign in</a>
      <a href="/auth/signup" class="${mode === 'signup' ? 'is-active' : ''}">Sign up</a>
    </div>

    <form id="auth-form" class="auth-form" data-mode="${mode}">
      ${
        mode === 'signup'
          ? `<label class="field"><span>Developer / display name</span><input name="developer_name" placeholder="Tech Studio" autocomplete="organization" /></label>`
          : ''
      }
      <label class="field"><span>Email address *</span><input name="email" type="email" required autocomplete="email" placeholder="you@example.com" /></label>
      ${
        mode !== 'reset'
          ? `<label class="field"><span>Password *</span>
        <span class="password-wrap">
          <input name="password" type="password" required minlength="8" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" placeholder="At least 8 characters" />
          <button type="button" class="icon-btn password-toggle" aria-label="Show password"><i class="fa-solid fa-eye"></i></button>
        </span></label>`
          : ''
      }
      <button class="btn btn-primary btn-block btn-lg" type="submit">
        <i class="fa-solid ${mode === 'login' ? 'fa-right-to-bracket' : mode === 'signup' ? 'fa-user-plus' : 'fa-key'}"></i>
        ${mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
      </button>
      <p class="auth-alert" id="auth-alert" hidden></p>
    </form>

    ${
      mode !== 'reset'
        ? `<div class="auth-divider"><span>or</span></div>
    <button class="btn btn-outline btn-block" id="magic-link-btn" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Email me a sign-in link</button>`
        : ''
    }

    <div class="auth-links">
      ${mode === 'login' ? '<a href="/auth/reset">Forgot your password?</a>' : ''}
      ${mode === 'reset' ? '<a href="/auth/login">Back to sign in</a>' : ''}
      <a href="/">Continue browsing without an account</a>
    </div>
  </div>

  <aside class="auth-aside">
    <div class="auth-aside-inner">
      <h2>Publish to a store that gets out of your way</h2>
      <ul>
        <li><i class="fa-solid fa-bolt"></i><div><strong>Instant publishing</strong><span>No review queue. Go live the moment you hit publish.</span></div></li>
        <li><i class="fa-solid fa-chart-line"></i><div><strong>Real analytics</strong><span>Downloads, ratings and reviews for every listing.</span></div></li>
        <li><i class="fa-solid fa-code"></i><div><strong>Full REST API</strong><span>Every listing is available as clean JSON.</span></div></li>
        <li><i class="fa-solid fa-tags"></i><div><strong>Free &amp; paid apps</strong><span>List free downloads or set your own price.</span></div></li>
      </ul>
      <p class="auth-aside-note"><i class="fa-solid fa-circle-info"></i> New accounts may need email confirmation before the first sign-in.</p>
    </div>
  </aside>
</section>
`)
}

/** ===================== API DOCS ===================== */
export function devDocsPage(origin: string) {
  const ep = (method: string, path: string, desc: string, auth = false) => `
  <div class="endpoint">
    <div class="endpoint-head">
      <span class="method method-${method.toLowerCase()}">${method}</span>
      <code>${esc(path)}</code>
      ${auth ? '<span class="pill pill-warn"><i class="fa-solid fa-lock"></i> Auth</span>' : '<span class="pill pill-free">Public</span>'}
    </div>
    <p>${esc(desc)}</p>
  </div>`

  return raw(`
<section class="dev-head">
  <div class="dev-head-inner">
    <div>
      <p class="dev-eyebrow"><i class="fa-solid fa-book"></i> Developer Console</p>
      <h1>API documentation</h1>
      <p>Every listing in the store is available over a clean JSON API. Base URL: <code class="code-inline">${esc(origin)}</code></p>
    </div>
    <div class="dev-head-actions">
      <a class="btn btn-outline-light" href="/api/apps" target="_blank" rel="noopener"><i class="fa-solid fa-flask"></i> Try /api/apps</a>
    </div>
  </div>
</section>

<section class="section docs-layout">
  <nav class="docs-nav" aria-label="Docs sections">
    <a href="#public-api">Public API</a>
    <a href="#auth-api">Authentication</a>
    <a href="#developer-api">Developer API</a>
    <a href="#examples">Examples</a>
    <a href="#errors">Errors</a>
    <a href="#schema">Data model</a>
  </nav>

  <div class="docs-body">
    <div class="card" id="public-api">
      <h2 class="card-title"><i class="fa-solid fa-globe"></i> Public API</h2>
      ${ep('GET', '/api/apps', 'List published apps. Query: limit, offset, category, search, sort=popular|newest|rated|name, featured=true')}
      ${ep('GET', '/api/apps/:slugOrId', 'Full app detail including developer, reviews, similar apps and other apps by the developer.')}
      ${ep('GET', '/api/apps/stats', 'Aggregate store statistics: app count, downloads, average rating, per-category counts.')}
      ${ep('GET', '/api/categories', 'All categories with a live count of published apps.')}
      ${ep('GET', '/api/developers', 'Public developer directory with app counts and total downloads.')}
      ${ep('GET', '/api/developers/:id', 'A developer profile plus all of their published apps.')}
      ${ep('GET', '/api/apps/:id/reviews', 'Reviews for an app, newest first.')}
      ${ep('POST', '/api/apps/:id/download', 'Register a download and return the resolved download URL.')}
    </div>

    <div class="card" id="auth-api">
      <h2 class="card-title"><i class="fa-solid fa-key"></i> Authentication</h2>
      <p class="muted">Auth is proxied to Supabase Auth. Send the returned <code>access_token</code> as <code>Authorization: Bearer &lt;token&gt;</code>.</p>
      ${ep('POST', '/api/auth/signup', 'Create an account. Body: { email, password, developer_name? }')}
      ${ep('POST', '/api/auth/login', 'Password sign-in. Body: { email, password } → { session }')}
      ${ep('POST', '/api/auth/magic-link', 'Send a passwordless email sign-in link. Body: { email }')}
      ${ep('POST', '/api/auth/reset-password', 'Send a password reset email. Body: { email }')}
      ${ep('POST', '/api/auth/refresh', 'Exchange a refresh token for a new session. Body: { refresh_token }')}
      ${ep('POST', '/api/auth/logout', 'Revoke the current session.', true)}
      ${ep('GET', '/api/me', 'Current user, developer profile and user profile.', true)}
    </div>

    <div class="card" id="developer-api">
      <h2 class="card-title"><i class="fa-solid fa-code"></i> Developer API</h2>
      ${ep('POST', '/api/developer/register', 'Create or update your developer profile. Body: { developer_name, company_name?, description?, website?, email?, logo_url? }', true)}
      ${ep('GET', '/api/developer/apps', 'All of your apps (drafts included) plus aggregate stats.', true)}
      ${ep('POST', '/api/developer/apps', 'Create an app. Body: { app_name, description, category, version?, icon_url?, download_url?, website?, is_free?, price?, screenshots?, status? }', true)}
      ${ep('PATCH', '/api/developer/apps/:id', 'Update one of your apps. Any listing field, plus status: draft|published.', true)}
      ${ep('DELETE', '/api/developer/apps/:id', 'Delete one of your apps.', true)}
    </div>

    <div class="card" id="examples">
      <h2 class="card-title"><i class="fa-solid fa-terminal"></i> Examples</h2>
      <h3>Fetch the newest 10 productivity apps</h3>
      <pre class="code-block code-block-lg">curl "${esc(origin)}/api/apps?category=Productivity&amp;sort=newest&amp;limit=10"</pre>
      <h3>Sign in and list your apps</h3>
      <pre class="code-block code-block-lg">TOKEN=$(curl -s -X POST "${esc(origin)}/api/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"you@example.com","password":"••••••••"}' | jq -r .session.access_token)

curl "${esc(origin)}/api/developer/apps" -H "Authorization: Bearer $TOKEN"</pre>
      <h3>Publish an app from JavaScript</h3>
      <pre class="code-block code-block-lg">const res = await fetch('/api/developer/apps', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: \`Bearer \${token}\`,
  },
  body: JSON.stringify({
    app_name: 'My App',
    description: 'What it does…',
    category: 'Productivity',
    version: '1.0.0',
    is_free: true,
    status: 'published',
  }),
});
const data = await res.json();</pre>
    </div>

    <div class="card" id="errors">
      <h2 class="card-title"><i class="fa-solid fa-triangle-exclamation"></i> Errors</h2>
      <p class="muted">All endpoints answer with <code>{ success: boolean, error?: string }</code>.</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td><code>400</code></td><td>Invalid or missing fields</td></tr>
            <tr><td><code>401</code></td><td>Missing / expired bearer token</td></tr>
            <tr><td><code>403</code></td><td>Row-level security rejected the operation</td></tr>
            <tr><td><code>404</code></td><td>App or developer not found</td></tr>
            <tr><td><code>500</code></td><td>Upstream database error</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" id="schema">
      <h2 class="card-title"><i class="fa-solid fa-database"></i> Data model</h2>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Table</th><th>Purpose</th><th>Key columns</th></tr></thead>
          <tbody>
            <tr><td><code>apps</code></td><td>App listings</td><td>app_name, app_slug, description, icon_url, category, latest_version, is_free, price, rating, downloads, status, developer_id</td></tr>
            <tr><td><code>developers</code></td><td>Publisher profiles</td><td>developer_name, company_name, website, logo_url, verified, user_id</td></tr>
            <tr><td><code>app_reviews</code></td><td>User ratings &amp; reviews</td><td>app_id, user_id, rating, title, review_text, helpful_count</td></tr>
            <tr><td><code>app_versions</code></td><td>Release history</td><td>app_id, version_number, release_notes, download_url</td></tr>
            <tr><td><code>user_profiles</code></td><td>Account profiles</td><td>username, full_name, avatar_url, account_type</td></tr>
          </tbody>
        </table>
      </div>
      <p class="form-note"><i class="fa-solid fa-shield-halved"></i> Writes are protected by Supabase Row Level Security. If a write returns <code>403</code>, add an RLS policy allowing <code>developer_id IN (SELECT id FROM developers WHERE user_id = auth.uid())</code>.</p>
    </div>
  </div>
</section>
`)
}
