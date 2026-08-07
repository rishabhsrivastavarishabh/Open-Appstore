import { raw } from "hono/html";
import { esc } from "./layout.js";
import { CATEGORIES } from "../lib/types.js";
const CAT_OPTIONS = (selected = "") => ["Other", ...CATEGORIES].map((c) => `<option value="${esc(c)}" ${selected === c ? "selected" : ""}>${esc(c)}</option>`).join("");
/**
 * The publishing pipeline, rendered on every console page so a developer always
 * knows what comes next: profile -> submit -> update. `active` is the step this
 * page belongs to; app.js adds `is-done` to step 1 once the profile exists.
 */
const devStepper = (active) => `
<ol class="stepper" id="dev-stepper" aria-label="Publishing steps">
  <li class="step ${active === 1 ? "is-active" : ""}" data-step="profile">
    <span class="step-num">1</span>
    <div><strong>Complete your profile</strong><small>Studio name, contact, logo</small></div>
    <a class="step-link" href="/developer/profile">Open</a>
  </li>
  <li class="step ${active === 2 ? "is-active" : ""}" data-step="submit">
    <span class="step-num">2</span>
    <div><strong>Submit your app</strong><small>Listing, icon, screenshots</small></div>
    <a class="step-link" href="/developer/submit">Open</a>
  </li>
  <li class="step ${active === 3 ? "is-active" : ""}" data-step="update">
    <span class="step-num">3</span>
    <div><strong>Update your app</strong><small>Ship a new version + notes</small></div>
    <a class="step-link" href="/developer/apps">Open</a>
  </li>
</ol>`;
/** Reusable hint telling developers that Drive share links are welcome. */
const driveHint = `<small class="drive-hint"><i class="fa-brands fa-google-drive"></i> A Google&nbsp;Drive share link works \u2014 we convert it to a direct image link automatically. Set sharing to <em>Anyone with the link</em>.</small>`;
const driveDownloadHint = `<small class="drive-hint"><i class="fa-brands fa-google-drive"></i> Drive, Dropbox and GitHub links are converted into direct download links automatically.</small>`;
const authGate = (title, msg) => `
<div id="auth-gate" class="auth-gate" hidden>
  <span class="empty-icon"><i class="fa-solid fa-lock"></i></span>
  <h2>${esc(title)}</h2>
  <p>${esc(msg)}</p>
  <div class="gate-actions">
    <a class="btn btn-primary" href="/auth/login?next=${"${location.pathname}"}" data-next-link><i class="fa-solid fa-right-to-bracket"></i> Sign in</a>
    <a class="btn btn-outline" href="/auth/signup"><i class="fa-solid fa-user-plus"></i> Create account</a>
  </div>
</div>
<div id="auth-loading" class="auth-loading"><span class="spinner"></span><p>Checking your session\u2026</p></div>`;
function devDashboardPage() {
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

${authGate("Developer sign-in required", "Sign in to access your developer console, publish apps and view analytics.")}

<div id="dev-content" hidden>
  <section id="profile-banner-slot"></section>
  <section class="section section-tight">${devStepper(0)}</section>

  <section class="section">
    <div class="metric-grid" id="dev-metrics">
      <div class="metric-card"><span class="metric-icon" style="--m:#3b82f6"><i class="fa-solid fa-cubes"></i></span><div><strong id="m-total">0</strong><small>Total apps</small></div></div>
      <div class="metric-card"><span class="metric-icon" style="--m:#22c55e"><i class="fa-solid fa-circle-check"></i></span><div><strong id="m-published">0</strong><small>Published</small></div></div>
      <div class="metric-card"><span class="metric-icon" style="--m:#f59e0b"><i class="fa-solid fa-pen-ruler"></i></span><div><strong id="m-drafts">0</strong><small>Drafts</small></div></div>
      <div class="metric-card"><span class="metric-icon" style="--m:#8b5cf6"><i class="fa-solid fa-download"></i></span><div><strong id="m-downloads">0</strong><small>Downloads</small></div></div>
      <div class="metric-card"><span class="metric-icon" style="--m:#ec4899"><i class="fa-solid fa-star"></i></span><div><strong id="m-rating">\u2014</strong><small>Avg rating</small></div></div>
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
`);
}
function devAppsPage() {
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

${authGate("Developer sign-in required", "Sign in to manage your app listings.")}

<div id="dev-content" hidden>
  <section id="profile-banner-slot"></section>
  <section class="section section-tight">${devStepper(3)}</section>
  <section class="section">
    <div class="manage-toolbar">
      <div class="input-icon">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="search" id="manage-search" placeholder="Filter your apps\u2026" />
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
      <label class="field"><span>Version</span><input name="version" placeholder="1.0.0" /><small class="drive-hint"><i class="fa-solid fa-circle-info"></i> To ship an update with release notes, use <strong>Update</strong> on the app row instead.</small></label>
      <label class="field"><span>Icon URL</span><input name="icon_url" type="url" placeholder="https://\u2026/icon.png" />${driveHint}</label>
      <label class="field"><span>Download URL</span><input name="download_url" type="url" placeholder="https://\u2026" />${driveDownloadHint}</label>
      <label class="field"><span>Website</span><input name="website_link" type="url" placeholder="https://\u2026" /></label>
      <label class="field"><span>Google Drive share link <small>mirror</small></span><input name="google_drive_link" type="url" placeholder="https://drive.google.com/file/d/FILE_ID/view" />${driveDownloadHint}</label>
      <label class="field"><span>Privacy policy URL</span><input name="privacy_policy_link" type="url" placeholder="https://\u2026/privacy" /></label>
      <label class="field"><span>Support email</span><input name="support_email" type="email" /></label>
      <label class="field"><span>Auto-update</span>
        <select name="auto_update"><option value="true">Enabled — installs refresh automatically</option><option value="false">Disabled — users update manually</option></select>
      </label>
      <label class="field field-full check-field"><input type="checkbox" name="update_available" value="1" /><span>Flag an update as available <small>shows an “Update available” banner on the store page</small></span></label>
      <label class="field field-full"><span>What’s new <small>changelog shown on the store page</small></span><textarea name="change_log" rows="4" placeholder="• Faster sync&#10;• Bug fixes"></textarea></label>
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

<dialog id="release-dialog" class="dialog">
  <form id="release-form" class="dialog-form">
    <header class="dialog-head">
      <h2><i class="fa-solid fa-rocket"></i> Ship an update</h2>
      <button type="button" class="icon-btn" data-close-dialog aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
    </header>
    <div class="dialog-body form-grid">
      <input type="hidden" name="id" />
      <p class="release-current field-full">
        Updating <strong id="release-app-name">\u2014</strong> \u2014 current release
        <span class="pill pill-muted" id="release-current-version">v\u2014</span>
      </p>
      <label class="field"><span>New version *</span><input name="version" required placeholder="1.1.0" pattern="\\d+(\\.\\d+){0,3}([-+][A-Za-z0-9.]+)?" /><small class="drive-hint"><i class="fa-solid fa-circle-info\"></i> Numeric, e.g. <code>1.1.0</code>. Must differ from the current release.</small></label>
      <label class="field"><span>Minimum supported version</span><input name="min_version" placeholder="optional, e.g. 1.0.0" /></label>
      <label class="field field-full"><span>Release notes <small>shown to users on the app page</small></span><textarea name="release_notes" rows="5" placeholder="\u2022 Faster sync&#10;\u2022 Fixed crash on launch&#10;\u2022 New dark theme"></textarea></label>
      <label class="field"><span>Download URL for this build</span><input name="download_url" type="url" placeholder="https://\u2026/app-1.1.0.apk" />${driveDownloadHint}</label>
      <label class="field"><span>Google Drive link for this build</span><input name="drive_link" type="url" placeholder="optional mirror" /></label>
      <label class="field"><span>File size (MB)</span><input name="file_size" type="number" min="1" step="1" placeholder="optional, whole MB" /></label>
      <label class="field"><span>Build number <small>version code</small></span><input name="version_code" type="number" min="1" step="1" placeholder="optional, e.g. 12" /></label>
      <div class="field field-full release-flags">
        <label class="check-field"><input type="checkbox" name="is_auto_update" value="1" checked /><span>Deliver as an auto-update <small>existing installs refresh in the background</small></span></label>
        <label class="check-field"><input type="checkbox" name="force_update" value="1" /><span>Force update <small>older versions are blocked until users install this build</small></span></label>
      </div>
      <div class="field-full">
        <h3 class="release-history-title"><i class="fa-solid fa-clock-rotate-left"></i> Release history</h3>
        <div id="release-history" class="version-list"><p class="muted">Loading\u2026</p></div>
      </div>
    </div>
    <footer class="dialog-foot">
      <button type="button" class="btn btn-ghost" data-close-dialog>Cancel</button>
      <button type="submit" class="btn btn-primary"><i class="fa-solid fa-rocket"></i> Publish update</button>
    </footer>
  </form>
</dialog>
`);
}
function devSubmitPage() {
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

${authGate("Developer sign-in required", "Sign in to submit an app to the store.")}

<div id="dev-content" hidden>
  <section id="profile-banner-slot"></section>
  <section class="section section-tight">${devStepper(2)}</section>

  <section class="section" id="submit-locked" hidden>
    <div class="card locked-card">
      <span class="locked-icon"><i class="fa-solid fa-id-badge"></i></span>
      <h2>Step 1 first: complete your developer profile</h2>
      <p>Every app listing is published <em>under a developer profile</em> \u2014 that is what users see on the app page and on your public developer page. Add your studio name and contact details, then come straight back here.</p>
      <ul class="locked-list">
        <li><i class="fa-solid fa-check"></i> Studio / developer name <small>required</small></li>
        <li><i class="fa-solid fa-check"></i> Contact email <small>so users can reach you</small></li>
        <li><i class="fa-solid fa-check"></i> Logo &amp; website <small>optional, but recommended</small></li>
      </ul>
      <div class="gate-actions">
        <a class="btn btn-primary" href="/developer/profile"><i class="fa-solid fa-arrow-right"></i> Complete my profile</a>
        <a class="btn btn-outline" href="/developer">Back to dashboard</a>
      </div>
    </div>
  </section>

  <section class="section submit-layout" id="submit-stage">
    <form id="submit-form" class="card form-card">
      <h2 class="card-title"><i class="fa-solid fa-circle-info"></i> Listing details</h2>
      <div class="form-grid">
        <label class="field"><span>App name *</span><input name="app_name" required maxlength="120" placeholder="My Awesome App" /></label>
        <label class="field"><span>URL slug</span><input name="app_slug" placeholder="auto-generated" pattern="[a-zA-Z0-9\\-\\s]*" /></label>
        <label class="field field-full"><span>Description * <small>Markdown supported</small></span><textarea name="description" rows="8" required placeholder="What does your app do? Key features, requirements, links\u2026"></textarea></label>
        <label class="field"><span>Category *</span><select name="category" required>${CAT_OPTIONS("Productivity")}</select></label>
        <label class="field"><span>Version</span><input name="version" placeholder="1.0.0" value="1.0.0" /></label>
        <label class="field"><span>Icon URL</span><input name="icon_url" type="url" placeholder="https://\u2026/icon.png" />${driveHint}</label>
        <label class="field"><span>Download URL</span><input name="download_url" type="url" placeholder="https://\u2026/app.apk" />${driveDownloadHint}</label>
        <label class="field"><span>Website</span><input name="website_link" type="url" placeholder="https://myapp.com" /></label>
        <label class="field"><span>Google Drive share link <small>mirror, optional</small></span><input name="google_drive_link" type="url" placeholder="https://drive.google.com/file/d/FILE_ID/view" />${driveDownloadHint}</label>
        <label class="field"><span>Privacy policy URL</span><input name="privacy_policy_link" type="url" placeholder="https://myapp.com/privacy" /></label>
        <label class="field"><span>Support email</span><input name="support_email" type="email" placeholder="support@myapp.com" /></label>
        <label class="field"><span>Auto-update</span><select name="auto_update"><option value="true">Enabled \u2014 installs refresh automatically</option><option value="false">Disabled \u2014 users update manually</option></select></label>
        <label class="field"><span>Pricing</span><select name="is_free" id="submit-is-free"><option value="true">Free</option><option value="false">Paid</option></select></label>
        <label class="field" id="submit-price-field" hidden><span>Price (USD)</span><input name="price" type="number" min="0" step="0.01" value="0" /></label>
        <label class="field field-full"><span>Screenshot URLs <small>one per line, optional</small></span><textarea name="screenshots" rows="3" placeholder="https://\u2026/1.png&#10;https://drive.google.com/file/d/FILE_ID/view"></textarea>${driveHint}</label>
        <label class="field field-full"><span>Release notes for 1.0.0 <small>optional — starts your version history</small></span><textarea name="release_notes" rows="3" placeholder="First public release."></textarea></label>
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
              <span class="pill"><i class="fa-solid fa-download"></i> \u2014</span>
            </div>
            <div class="app-card-foot"><span class="price is-free" id="pv-price">Free</span><span class="btn btn-primary btn-sm">Get</span></div>
          </div>
        </div>
      </div>
      <div class="card tips-card">
        <h2 class="card-title"><i class="fa-solid fa-lightbulb"></i> Listing tips</h2>
        <ul class="tips-list">
          <li><i class="fa-solid fa-check"></i> Use a square PNG icon (512\xD7512) for the crispest result.</li>
          <li><i class="fa-solid fa-check"></i> Open the first paragraph with the single biggest benefit.</li>
          <li><i class="fa-solid fa-check"></i> Use <code>## Headings</code> and <code>- bullets</code> \u2014 markdown renders on the detail page.</li>
          <li><i class="fa-solid fa-check"></i> A working download URL means users can install in one tap.</li>
          <li><i class="fa-solid fa-check"></i> Save as draft to preview privately before going live.</li>
        </ul>
      </div>
    </aside>
  </section>
</div>
`);
}
function devProfilePage() {
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

${authGate("Developer sign-in required", "Sign in to create or edit your developer profile.")}

<div id="dev-content" hidden>
  <section class="section section-tight">${devStepper(1)}</section>
  <section class="section submit-layout">
    <form id="profile-form" class="card form-card">
      <h2 class="card-title"><i class="fa-solid fa-user-tie"></i> Studio information</h2>
      <div class="form-grid">
        <label class="field"><span>Developer / studio name *</span><input name="developer_name" required maxlength="120" placeholder="Tech Studio" /></label>
        <label class="field"><span>Company name</span><input name="company_name" maxlength="120" /></label>
        <label class="field field-full"><span>Bio / description</span><textarea name="description" rows="4" placeholder="Tell users what you build\u2026"></textarea></label>
        <label class="field"><span>Website</span><input name="website" type="url" placeholder="https://\u2026" /></label>
        <label class="field"><span>Contact email *</span><input name="email" type="email" required /></label>
        <label class="field"><span>Logo / avatar URL</span><input name="logo_url" type="url" placeholder="https://\u2026/logo.png" />${driveHint}</label>
      </div>
      <div class="profile-preview">
        <img id="profile-logo-preview" alt="" hidden />
        <span id="profile-logo-fallback" class="dev-avatar-fallback">\u2014</span>
        <div><strong id="profile-preview-name">Your studio</strong><small id="profile-preview-sub">This is how users see you on every listing.</small></div>
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
          <dt>Email</dt><dd id="acct-email">\u2014</dd>
          <dt>User ID</dt><dd><code class="code-inline" id="acct-id">\u2014</code></dd>
          <dt>Verified</dt><dd id="acct-verified">\u2014</dd>
          <dt>Developer ID</dt><dd><code class="code-inline" id="acct-dev-id">\u2014</code></dd>
          <dt>Status</dt><dd id="acct-dev-status">\u2014</dd>
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
`);
}
function authPage(mode) {
  const titles = {
    login: { h: "Welcome back", p: "Sign in to manage your apps and reviews." },
    signup: { h: "Create your account", p: "One account for browsing, reviewing and publishing apps." },
    reset: { h: "Reset your password", p: "We will email you a secure reset link." }
  }[mode];
  return raw(`
<section class="auth-layout">
  <div class="auth-panel">
    <a class="auth-brand" href="/"><img class="brand-mark" src="/static/logo.svg" alt="" width="40" height="40" /> Open App Store</a>
    <h1>${esc(titles.h)}</h1>
    <p class="auth-sub">${esc(titles.p)}</p>

    <div class="auth-tabs">
      <a href="/auth/login" class="${mode === "login" ? "is-active" : ""}">Sign in</a>
      <a href="/auth/signup" class="${mode === "signup" ? "is-active" : ""}">Sign up</a>
    </div>

    ${mode !== "reset" ? `<div class="oauth-block">
      <a class="btn btn-google btn-block btn-lg" id="google-signin" href="/api/auth/google?next=%2Fdeveloper">
        <svg class="google-g" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.8-6.8C35.6 2.4 30.2 0 24 0 14.6 0 6.4 5.4 2.5 13.2l7.9 6.1C12.3 13.3 17.6 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-2.8-.4-4.1H24v8.4h12.4c-.3 2.1-1.6 5.2-4.6 7.3l7.7 6c4.5-4.2 6.6-10.3 6.6-17.6z"/>
          <path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.6 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.5 10.8l7.9-6.1z"/>
          <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.5-5.8l-7.7-6c-2.1 1.4-4.8 2.4-7.8 2.4-6.4 0-11.7-3.8-13.6-9.9l-7.9 6.1C6.4 42.6 14.6 48 24 48z"/>
        </svg>
        Continue with Google
      </a>
      <div class="auth-divider"><span>or use your email</span></div>
    </div>` : ""}

    <form id="auth-form" class="auth-form" data-mode="${mode}">
      ${mode === "signup" ? `<label class="field"><span>Developer / display name</span><input name="developer_name" placeholder="Tech Studio" autocomplete="organization" /></label>` : ""}
      <label class="field"><span>Email address *</span><input name="email" type="email" required autocomplete="email" placeholder="you@example.com" /></label>
      ${mode !== "reset" ? `<label class="field"><span>Password *</span>
        <span class="password-wrap">
          <input name="password" type="password" required minlength="8" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" placeholder="At least 8 characters" />
          <button type="button" class="icon-btn password-toggle" aria-label="Show password"><i class="fa-solid fa-eye"></i></button>
        </span></label>` : ""}
      <button class="btn btn-primary btn-block btn-lg" type="submit">
        <i class="fa-solid ${mode === "login" ? "fa-right-to-bracket" : mode === "signup" ? "fa-user-plus" : "fa-key"}"></i>
        ${mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
      </button>
      <p class="auth-alert" id="auth-alert" hidden></p>
    </form>

    ${mode === "login" ? `<form id="tfa-form" class="auth-form tfa-form" hidden>
      <div class="tfa-head">
        <span class="tfa-icon"><i class="fa-solid fa-shield-halved"></i></span>
        <div>
          <strong>Two-factor authentication</strong>
          <small>Open your authenticator app and enter the current 6-digit code.</small>
        </div>
      </div>
      <input type="hidden" name="challenge" id="tfa-challenge" />
      <div class="otp-inputs" id="tfa-inputs" role="group" aria-label="6-digit authentication code">
        ${[0, 1, 2, 3, 4, 5].map((i) => `<input class="otp-box" type="text" inputmode="numeric" autocomplete="${i === 0 ? "one-time-code" : "off"}" maxlength="1" aria-label="Digit ${i + 1}" data-i="${i}" />`).join("")}
      </div>
      <input type="hidden" name="code" id="tfa-code" />
      <button class="btn btn-primary btn-block btn-lg" type="submit" id="tfa-verify">
        <i class="fa-solid fa-unlock"></i> Verify &amp; sign in
      </button>
      <div class="otp-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="tfa-backup"><i class="fa-solid fa-key"></i> Use a backup code</button>
        <button type="button" class="btn btn-ghost btn-sm" id="tfa-cancel"><i class="fa-solid fa-arrow-left"></i> Start over</button>
      </div>
      <label class="field" id="tfa-backup-field" hidden>
        <span>Backup code</span>
        <input id="tfa-backup-input" placeholder="XXXX-XXXX" autocomplete="one-time-code" />
      </label>
      <p class="auth-alert" id="tfa-alert" hidden></p>
    </form>` : ""}

    <div class="auth-links">
      ${mode === "login" ? '<a href="/auth/reset">Forgot your password?</a>' : ""}
      ${mode === "reset" ? '<a href="/auth/login">Back to sign in</a>' : ""}
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
`);
}

function devSecurityPage() {
  return raw(`
<section class="dev-head">
  <div class="dev-head-inner">
    <nav class="breadcrumb breadcrumb-light">
      <a href="/developer">Developer</a><i class="fa-solid fa-chevron-right"></i><span>Security</span>
    </nav>
    <h1><i class="fa-solid fa-shield-halved"></i> Security</h1>
    <p>Protect your developer account with two-factor authentication and review where you have signed in.</p>
  </div>
</section>

${authGate("Sign in to manage security", "Two-factor authentication and sign-in history belong to your developer account.")}

<div id="dev-content" hidden>
<div class="dev-body">
  <section class="section">
    <div class="dev-grid-2">
      <div class="card tfa-card" id="tfa-card">
        <h2 class="card-title"><i class="fa-solid fa-mobile-screen-button"></i> Two-factor authentication</h2>

        <div class="tfa-status" id="tfa-status">
          <span class="tfa-badge" id="tfa-badge"><i class="fa-solid fa-circle-notch fa-spin"></i> Checking\u2026</span>
          <p class="muted" id="tfa-status-note">Reading your security settings.</p>
        </div>

        <div id="tfa-off" hidden>
          <p>Add a second step to every sign-in. You will need an authenticator app such as Google Authenticator, Authy, 1Password or Bitwarden.</p>
          <button class="btn btn-primary" id="tfa-start"><i class="fa-solid fa-plus"></i> Set up two-factor authentication</button>
        </div>

        <div id="tfa-setup" hidden>
          <ol class="tfa-steps">
            <li>
              <strong>Scan this QR code</strong>
              <div class="tfa-qr" id="tfa-qr"><span class="spinner spinner-xs"></span></div>
            </li>
            <li>
              <strong>Or type the key by hand</strong>
              <div class="tfa-secret">
                <code id="tfa-secret">\u2014</code>
                <button class="btn btn-ghost btn-sm" id="tfa-copy" type="button"><i class="fa-regular fa-copy"></i> Copy</button>
              </div>
              <small class="muted">Issuer <strong>Open Appstore</strong> \u00b7 time-based \u00b7 6 digits \u00b7 30 seconds</small>
            </li>
            <li>
              <strong>Enter the current code to confirm</strong>
              <form id="tfa-enable-form" class="tfa-confirm">
                <div class="otp-inputs" id="tfa-setup-inputs" role="group" aria-label="6-digit code">
                  ${[0, 1, 2, 3, 4, 5].map((i) => `<input class="otp-box" type="text" inputmode="numeric" maxlength="1" aria-label="Digit ${i + 1}" data-i="${i}" />`).join("")}
                </div>
                <button class="btn btn-primary" type="submit"><i class="fa-solid fa-lock"></i> Turn on 2FA</button>
                <button class="btn btn-ghost" type="button" id="tfa-cancel-setup">Cancel</button>
              </form>
            </li>
          </ol>
          <p class="auth-alert" id="tfa-setup-alert" hidden></p>
        </div>

        <div id="tfa-on" hidden>
          <p class="tfa-on-note"><i class="fa-solid fa-circle-check"></i> Every sign-in now asks for a code from your authenticator app.</p>
          <p class="muted" id="tfa-codes-left"></p>
          <form id="tfa-disable-form" class="tfa-confirm">
            <label class="field">
              <span>Turn it off \u2014 enter a current code or a backup code</span>
              <input id="tfa-disable-code" placeholder="123456 or XXXX-XXXX" autocomplete="one-time-code" required />
            </label>
            <button class="btn btn-outline btn-danger" type="submit"><i class="fa-solid fa-unlock"></i> Disable 2FA</button>
          </form>
          <p class="auth-alert" id="tfa-disable-alert" hidden></p>
        </div>

        <div id="tfa-codes" hidden>
          <h3 class="release-history-title"><i class="fa-solid fa-key"></i> Your backup codes</h3>
          <p class="muted">Each code works once. Save them now \u2014 they are never shown again.</p>
          <ul class="backup-codes" id="backup-codes-list"></ul>
          <div class="form-actions">
            <button class="btn btn-outline btn-sm" id="tfa-copy-codes" type="button"><i class="fa-regular fa-copy"></i> Copy all</button>
            <button class="btn btn-outline btn-sm" id="tfa-download-codes" type="button"><i class="fa-solid fa-download"></i> Download .txt</button>
            <button class="btn btn-primary btn-sm" id="tfa-codes-done" type="button">I have saved them</button>
          </div>
        </div>
      </div>

      <div class="card">
        <h2 class="card-title"><i class="fa-solid fa-clock-rotate-left"></i> Recent activity</h2>
        <h3 class="release-history-title">Devices</h3>
        <ul class="device-list" id="device-list"><li class="muted">Loading\u2026</li></ul>
        <h3 class="release-history-title">Sign-in history</h3>
        <ul class="login-list" id="login-list"><li class="muted">Loading\u2026</li></ul>
      </div>
    </div>
  </section>
</div>
</div>
`);
}

function authCallbackPage() {
  return raw(`
<section class="auth-layout auth-callback">
  <div class="auth-panel">
    <a class="auth-brand" href="/"><img class="brand-mark" src="/static/logo.svg" alt="" width="40" height="40" /> Open Appstore</a>
    <div class="callback-state" id="callback-state">
      <span class="callback-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
      <h1>Finishing sign-in\u2026</h1>
      <p class="auth-sub" id="callback-note">Completing your Google sign-in. This only takes a moment.</p>
    </div>
    <p class="auth-alert" id="callback-alert" hidden></p>
    <div class="auth-links">
      <a href="/auth/login">Back to sign in</a>
      <a href="/">Continue browsing</a>
    </div>
  </div>
</section>
`);
}

/** /developer/api-keys — mint, list and revoke keys for the /api/v1 surface. */
function devApiKeysPage() {
  return raw(`
<section class="dev-head">
  <div class="dev-head-inner">
    <nav class="breadcrumb breadcrumb-light">
      <a href="/developer">Developer</a><i class="fa-solid fa-chevron-right"></i><span>API keys</span>
    </nav>
    <h1><i class="fa-solid fa-key"></i> API keys</h1>
    <p>Keys authenticate the Developer API v1 &mdash; publish apps, ship versions and read analytics from your own scripts and CI.</p>
  </div>
</section>

${authGate("Sign in to manage API keys", "API keys belong to your developer account.")}

<div id="dev-content" hidden>
<div class="dev-body">
  <section class="section">
    <div class="card">
      <h2 class="card-title"><i class="fa-solid fa-plus"></i> Create a key</h2>
      <p class="muted">Give the key a name you will recognise later &mdash; for example the machine or pipeline that will use it.</p>
      <form id="key-form" class="form-row-inline" autocomplete="off">
        <div class="field">
          <label for="key-name">Key name</label>
          <input type="text" id="key-name" name="name" maxlength="60" placeholder="CI pipeline" required />
        </div>
        <button class="btn btn-primary" type="submit" id="key-create">
          <i class="fa-solid fa-key"></i> Create key
        </button>
      </form>
      <p class="form-error" id="key-error" hidden></p>

      <div class="key-reveal" id="key-reveal" hidden>
        <p class="key-reveal-head"><i class="fa-solid fa-circle-exclamation"></i> Copy this key now &mdash; it is shown only once.</p>
        <div class="key-reveal-row">
          <code id="key-value">&mdash;</code>
          <button class="btn btn-outline btn-sm" type="button" id="key-copy"><i class="fa-solid fa-copy"></i> Copy</button>
        </div>
        <p class="muted">Store it in a secret manager or your CI settings. If it leaks, revoke it here and create a new one.</p>
      </div>
    </div>

    <div class="card">
      <h2 class="card-title"><i class="fa-solid fa-list"></i> Your keys</h2>
      <div id="keys-list"><span class="spinner"></span></div>
      <p class="form-note" id="keys-tier"></p>
    </div>

    <div class="card">
      <h2 class="card-title"><i class="fa-solid fa-terminal"></i> Using your key</h2>
      <pre class="code-block code-block-lg">curl "${"${location.origin}"}/api/v1/whoami" \\
  -H "Authorization: Bearer dev_your_key_here"</pre>
      <p><a class="btn btn-outline" href="/developer/docs#v1"><i class="fa-solid fa-book"></i> Read the API reference</a></p>
    </div>
  </section>
</div>
</div>
`);
}

function devDocsPage(origin) {
  const ep = (method, path, desc, auth = false) => `
  <div class="endpoint">
    <div class="endpoint-head">
      <span class="method method-${method.toLowerCase()}">${method}</span>
      <code>${esc(path)}</code>
      ${auth ? '<span class="pill pill-warn"><i class="fa-solid fa-lock"></i> Auth</span>' : '<span class="pill pill-free">Public</span>'}
    </div>
    <p>${esc(desc)}</p>
  </div>`;
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
    <a href="#api-keys">API keys</a>
    <a href="#v1">Developer API v1</a>
    <a href="#v1-apps">Apps</a>
    <a href="#v1-analytics">Analytics</a>
    <a href="#v1-reviews">Reviews</a>
    <a href="#v1-versions">Versions</a>
    <a href="#v1-profile">Profile &amp; stats</a>
    <a href="#v1-errors">Error codes</a>
    <a href="#v1-limits">Rate limits</a>
    <a href="#cli">CLI</a>
    <a href="#public-api">Public API</a>
    <a href="#auth-api">Authentication</a>
    <a href="#developer-api">Session API</a>
    <a href="#examples">Examples</a>
    <a href="#errors">Errors</a>
    <a href="#schema">Data model</a>
  </nav>

  <div class="docs-body">
    <div class="card" id="api-keys">
      <h2 class="card-title"><i class="fa-solid fa-key"></i> API keys</h2>
      <p>The Developer API is authenticated with a personal API key, not a login session. Keys look like <code>dev_…</code> and never expire — revoke them instead.</p>
      <p><a class="btn btn-primary" href="/developer/api-keys"><i class="fa-solid fa-plus"></i> Create an API key</a></p>
      <pre class="code-block code-block-lg">Authorization: Bearer dev_your_key_here</pre>
      <p class="form-note"><i class="fa-solid fa-triangle-exclamation"></i> The full key is shown <strong>once</strong>, at creation. Store it in a secret manager or your CI settings. Never commit it, and never ship it in client-side code &mdash; a key carries full write access to your listings.</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Requirement</th><th>Detail</th></tr></thead>
          <tbody>
            <tr><td>Base URL</td><td><code>${esc(origin)}/api/v1</code></td></tr>
            <tr><td>Auth header</td><td><code>Authorization: Bearer dev_…</code> (or <code>X-API-Key</code>)</td></tr>
            <tr><td>Content type</td><td><code>application/json</code> on every request with a body</td></tr>
            <tr><td>Prerequisite</td><td>A developer profile must exist, else <code>403 no_developer_profile</code></td></tr>
            <tr><td>Max active keys</td><td>10 per account</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" id="v1">
      <h2 class="card-title"><i class="fa-solid fa-rocket"></i> Developer API v1</h2>
      <p>Programmatic access to your own listings: create and publish apps, ship versions, read analytics, and reply to reviews. Every response uses the same envelope, so a client only ever branches on <code>success</code>.</p>
      <h3>Success</h3>
      <pre class="code-block code-block-lg">{
  "success": true,
  "data": { … },
  "meta": { "limit": 20, "offset": 0, "total": 42, "has_more": true }
}</pre>
      <h3>Failure</h3>
      <pre class="code-block code-block-lg">{
  "success": false,
  "error": {
    "code": "validation_failed",
    "message": "One or more fields are invalid.",
    "details": { "app_name": "App name is required." }
  }
}</pre>
      <p class="muted">Scoping is enforced server-side: a key can only ever see and mutate the apps belonging to its own developer profile. Requesting another developer's app id returns <code>404</code>, never their data.</p>
      ${ep("GET", "/api/v1", "Service descriptor: version, base URL, rate limits and the full endpoint list. No key required.")}
      ${ep("GET", "/api/v1/whoami", "Confirm a key works. Returns your developer id, tier and rate limit.", true)}
    </div>

    <div class="card" id="v1-apps">
      <h2 class="card-title"><i class="fa-solid fa-mobile-screen"></i> Apps</h2>
      ${ep("GET", "/api/v1/apps", "List your apps, drafts included. Query: limit (1-100, default 20), offset, status=draft|published, category, search, sort=newest|oldest|name|downloads|rating", true)}
      ${ep("POST", "/api/v1/apps", "Create an app. Required: app_name, description. Returns 201 and seeds version history.", true)}
      ${ep("GET", "/api/v1/apps/{id}", "One app. Accepts the uuid or the app_slug.", true)}
      ${ep("PUT", "/api/v1/apps/{id}", "Update an app. PATCH is accepted identically. Only supplied fields change.", true)}
      ${ep("DELETE", "/api/v1/apps/{id}", "Delete an app permanently.", true)}
      ${ep("POST", "/api/v1/apps/{id}/publish", "Make an app live. 422 if app_name, description or download_url is missing.", true)}
      ${ep("POST", "/api/v1/apps/{id}/unpublish", "Return an app to draft, removing it from the store.", true)}
      <h3>Writable fields</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Field</th><th>Type</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><td><code>app_name</code></td><td>string</td><td>Required on create, max 100 chars</td></tr>
            <tr><td><code>description</code></td><td>string</td><td>Required on create, max 4000 chars, Markdown allowed</td></tr>
            <tr><td><code>category</code></td><td>string</td><td>Must be a known category, else <code>422</code></td></tr>
            <tr><td><code>version</code></td><td>string</td><td>Numeric, e.g. <code>1.2.0</code></td></tr>
            <tr><td><code>version_code</code></td><td>integer</td><td>Positive integer, must increase per release</td></tr>
            <tr><td><code>is_free</code> / <code>price</code></td><td>bool / number</td><td><code>price</code> is forced to 0 when <code>is_free</code></td></tr>
            <tr><td><code>icon_url</code></td><td>url</td><td>Google Drive / Dropbox share links are rewritten to direct URLs</td></tr>
            <tr><td><code>screenshots</code></td><td>url[]</td><td>Array; same URL rewriting applies</td></tr>
            <tr><td><code>download_url</code></td><td>url</td><td>Required before publishing</td></tr>
            <tr><td><code>google_drive_link</code></td><td>url</td><td>Optional mirror</td></tr>
            <tr><td><code>website</code>, <code>website_link</code>, <code>privacy_policy_link</code></td><td>url</td><td>Optional</td></tr>
            <tr><td><code>support_email</code></td><td>email</td><td>Shown on the listing</td></tr>
            <tr><td><code>min_version</code></td><td>string</td><td>Minimum OS version</td></tr>
            <tr><td><code>auto_update</code></td><td>bool</td><td>Allow silent updates</td></tr>
            <tr><td><code>change_log</code></td><td>string</td><td>What changed in this release</td></tr>
            <tr><td><code>status</code></td><td>enum</td><td><code>draft</code> or <code>published</code></td></tr>
          </tbody>
        </table>
      </div>
      <h3>Create an app</h3>
      <pre class="code-block code-block-lg">curl -X POST "${esc(origin)}/api/v1/apps" \\
  -H "Authorization: Bearer $OAS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "app_name": "My App",
    "description": "What it does\\u2026",
    "category": "Productivity",
    "version": "1.0.0",
    "download_url": "https://example.com/app.apk",
    "is_free": true
  }'</pre>
    </div>

    <div class="card" id="v1-analytics">
      <h2 class="card-title"><i class="fa-solid fa-chart-line"></i> Analytics</h2>
      ${ep("GET", "/api/v1/apps/{id}/analytics", "Downloads, ratings and platform split. Query: period=7d|30d|90d|all (default 30d)", true)}
      <p class="muted">The daily series is gap-filled &mdash; every day in the window is present, with <code>0</code> where there were no downloads, so you can chart it without patching holes.</p>
      <pre class="code-block code-block-lg">{
  "success": true,
  "data": {
    "app_id": "…", "app_name": "My App", "period": "30d",
    "downloads": {
      "total": 15420,          // lifetime
      "in_period": 1832,       // within the window
      "daily_average": 61.07,
      "timeseries": [{ "date": "2026-08-01", "downloads": 54 }]
    },
    "ratings": {
      "average": 4.6, "total": 312,
      "distribution": { "1": 4, "2": 6, "3": 18, "4": 82, "5": 202 }
    },
    "platforms": [{ "name": "Android", "count": 1401 }]
  }
}</pre>
    </div>

    <div class="card" id="v1-reviews">
      <h2 class="card-title"><i class="fa-solid fa-comments"></i> Reviews</h2>
      ${ep("GET", "/api/v1/apps/{id}/reviews", "Reviews for your app, newest first. Query: limit, offset, rating=1..5", true)}
      ${ep("POST", "/api/v1/apps/{id}/reviews/{review_id}/respond", "Publish a public reply. Body: { response } (max 1000 chars). Posting again replaces the previous reply.", true)}
      <pre class="code-block code-block-lg">curl -X POST "${esc(origin)}/api/v1/apps/$APP_ID/reviews/$REVIEW_ID/respond" \\
  -H "Authorization: Bearer $OAS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"response":"Thanks! Fixed in 1.2.1."}'</pre>
      <p class="muted">On read, each review carries <code>response: { body, responded_at }</code> (or <code>null</code>). The reviewer's own <code>body</code> is always returned unmodified.</p>
    </div>

    <div class="card" id="v1-versions">
      <h2 class="card-title"><i class="fa-solid fa-code-branch"></i> Versions</h2>
      ${ep("GET", "/api/v1/apps/{id}/versions", "Full release history, newest first.", true)}
      ${ep("POST", "/api/v1/apps/{id}/versions", "Ship a release. Body: { version, release_notes?, download_url?, file_size?, force_update?, min_version? }. Returns 201.", true)}
      <p class="muted">Shipping a version bumps the app's <code>latest_version</code>, increments <code>version_code</code>, and flags <code>update_available</code> so installed clients pick it up. Re-posting the current version returns <code>409 conflict</code>.</p>
      <pre class="code-block code-block-lg">curl -X POST "${esc(origin)}/api/v1/apps/$APP_ID/versions" \\
  -H "Authorization: Bearer $OAS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"version":"1.2.0","release_notes":"Faster sync.","force_update":false}'</pre>
    </div>

    <div class="card" id="v1-profile">
      <h2 class="card-title"><i class="fa-solid fa-id-badge"></i> Profile &amp; stats</h2>
      ${ep("GET", "/api/v1/developer/profile", "Your developer profile, verification state and tier.", true)}
      ${ep("PUT", "/api/v1/developer/profile", "Update developer_name, company_name, description, website, email, avatar_url.", true)}
      ${ep("GET", "/api/v1/developer/stats", "Portfolio rollup: app counts, downloads, average rating, per-category split and top 5 apps.", true)}
      <p class="form-note"><i class="fa-solid fa-shield-halved"></i> <code>verified</code> is read-only over the API &mdash; a studio cannot grant itself the verified badge or the higher rate-limit tier.</p>
    </div>

    <div class="card" id="v1-errors">
      <h2 class="card-title"><i class="fa-solid fa-triangle-exclamation"></i> Error codes</h2>
      <p class="muted">Branch on <code>error.code</code>, not on the message &mdash; messages may be reworded.</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Code</th><th>Status</th><th>Meaning &amp; fix</th></tr></thead>
          <tbody>
            <tr><td><code>missing_api_key</code></td><td><code>401</code></td><td>No <code>Authorization</code> header. Add <code>Bearer dev_…</code></td></tr>
            <tr><td><code>invalid_api_key</code></td><td><code>401</code></td><td>Malformed or wrong signature. Check for truncation on copy.</td></tr>
            <tr><td><code>revoked_api_key</code></td><td><code>401</code></td><td>Key was revoked. Create a new one.</td></tr>
            <tr><td><code>no_developer_profile</code></td><td><code>403</code></td><td>Create your developer profile in the console first.</td></tr>
            <tr><td><code>forbidden</code></td><td><code>403</code></td><td>Row-level security rejected the write.</td></tr>
            <tr><td><code>not_found</code></td><td><code>404</code></td><td>No such resource, or it is not yours.</td></tr>
            <tr><td><code>method_not_allowed</code></td><td><code>405</code></td><td>Wrong verb for that path.</td></tr>
            <tr><td><code>conflict</code></td><td><code>409</code></td><td>Already in that state (e.g. re-publishing, duplicate version).</td></tr>
            <tr><td><code>validation_failed</code></td><td><code>422</code></td><td>Read <code>error.details</code> for the per-field reasons.</td></tr>
            <tr><td><code>rate_limited</code></td><td><code>429</code></td><td>Back off until <code>X-RateLimit-Reset</code>; see <code>Retry-After</code>.</td></tr>
            <tr><td><code>internal_error</code></td><td><code>500</code></td><td>Upstream failure. Retry with backoff; contact support if it persists.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" id="v1-limits">
      <h2 class="card-title"><i class="fa-solid fa-gauge-high"></i> Rate limits</h2>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Tier</th><th>Limit</th><th>Who</th></tr></thead>
          <tbody>
            <tr><td><code>free</code></td><td>1,000 requests / hour</td><td>All developers by default</td></tr>
            <tr><td><code>verified</code></td><td>5,000 requests / hour</td><td>Verified studios</td></tr>
          </tbody>
        </table>
      </div>
      <p>Every response carries the current budget:</p>
      <pre class="code-block code-block-lg">X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 987
X-RateLimit-Reset: 1786095652   # unix seconds</pre>
      <p class="muted">Limits are counted per API key in a fixed one-hour window. On <code>429</code> the response adds <code>Retry-After</code> in seconds &mdash; sleep for that long rather than retrying immediately.</p>
      <h3>Recommended backoff</h3>
      <pre class="code-block code-block-lg">async function callApi(path, init, attempt = 0) {
  const res = await fetch(path, init);
  if (res.status !== 429 || attempt >= 5) return res;
  const wait = Number(res.headers.get('Retry-After') ?? 2 ** attempt);
  await new Promise((r) => setTimeout(r, wait * 1000));
  return callApi(path, init, attempt + 1);
}</pre>
    </div>

    <div class="card" id="cli">
      <h2 class="card-title"><i class="fa-solid fa-terminal"></i> Command line</h2>
      <p>The API is plain REST, so <code>curl</code> plus <code>jq</code> is enough for CI. Export your key once:</p>
      <pre class="code-block code-block-lg">export OAS_API_KEY="dev_…"
export OAS_BASE="${esc(origin)}/api/v1"

# List your apps
curl -s "$OAS_BASE/apps" -H "Authorization: Bearer $OAS_API_KEY" | jq '.data[] | {name, status, downloads}'

# Ship a release, then publish
curl -s -X POST "$OAS_BASE/apps/$APP_ID/versions" \\
  -H "Authorization: Bearer $OAS_API_KEY" -H "Content-Type: application/json" \\
  -d '{"version":"1.3.0","release_notes":"CI release"}' | jq .

curl -s -X POST "$OAS_BASE/apps/$APP_ID/publish" \\
  -H "Authorization: Bearer $OAS_API_KEY" | jq .</pre>
      <p class="form-note"><i class="fa-solid fa-circle-info"></i> Store the key as a masked CI secret (GitHub Actions: <code>secrets.OAS_API_KEY</code>). A key in a build log is a compromised key &mdash; revoke it in the console and issue a new one.</p>
    </div>

    <div class="card" id="public-api">
      <h2 class="card-title"><i class="fa-solid fa-globe"></i> Public API</h2>
      ${ep("GET", "/api/apps", "List published apps. Query: limit, offset, category, search, sort=popular|newest|rated|name, featured=true")}
      ${ep("GET", "/api/apps/:slugOrId", "Full app detail including developer, reviews, similar apps and other apps by the developer.")}
      ${ep("GET", "/api/apps/stats", "Aggregate store statistics: app count, downloads, average rating, per-category counts.")}
      ${ep("GET", "/api/categories", "All categories with a live count of published apps.")}
      ${ep("GET", "/api/developers", "Public developer directory with app counts and total downloads.")}
      ${ep("GET", "/api/developers/:id", "A developer profile plus all of their published apps.")}
      ${ep("GET", "/api/apps/:id/reviews", "Reviews for an app, newest first.")}
      ${ep("POST", "/api/apps/:id/download", "Register a download and return the resolved download URL.")}
    </div>

    <div class="card" id="auth-api">
      <h2 class="card-title"><i class="fa-solid fa-key"></i> Authentication</h2>
      <p class="muted">Auth is proxied to Supabase Auth. Send the returned <code>access_token</code> as <code>Authorization: Bearer &lt;token&gt;</code>.</p>
      ${ep("POST", "/api/auth/signup", "Create an account. Body: { email, password, developer_name? }")}
      ${ep("POST", "/api/auth/login", "Password sign-in. Body: { email, password } \u2192 { session }, or { requires_2fa: true, challenge } when 2FA is armed")}
      ${ep("GET", "/api/auth/google", "Start Google sign-in. Query: next?. Redirects to Google and returns to /auth/callback")}
      ${ep("POST", "/api/auth/oauth/exchange", "Exchange a PKCE authorization code for a session. Body: { code }")}
      ${ep("POST", "/api/auth/reset-password", "Send a password reset email. Body: { email }")}
      ${ep("POST", "/api/auth/refresh", "Exchange a refresh token for a new session. Body: { refresh_token }")}
      ${ep("POST", "/api/auth/logout", "Revoke the current session.", true)}
      ${ep("GET", "/api/me", "Current user, developer profile and user profile.", true)}
    </div>

    <div class="card" id="tfa-api">
      <h2 class="card-title"><i class="fa-solid fa-shield-halved"></i> Two-factor authentication</h2>
      <p class="muted">Time-based one-time passwords (RFC&nbsp;6238, SHA-1, 6 digits, 30&nbsp;s) with ten single-use backup codes. Email one-time codes and email sign-in links are no longer supported.</p>
      ${ep("GET", "/api/auth/2fa", "Enrolment state: { enabled, pending, backup_codes_left }", true)}
      ${ep("POST", "/api/auth/2fa/setup", "Mint a secret. Returns { secret, otpauth_uri } \u2014 nothing is enforced yet.", true)}
      ${ep("POST", "/api/auth/2fa/enable", "Confirm a live code and arm 2FA. Body: { code } \u2192 { backup_codes } (shown once)", true)}
      ${ep("POST", "/api/auth/2fa/disable", "Switch 2FA off. Body: { code } \u2014 authenticator or backup code.", true)}
      ${ep("POST", "/api/auth/2fa/verify", "Finish a gated sign-in. Body: { challenge, code } \u2192 { session }")}
      ${ep("GET", "/api/auth/sessions", "Known devices and the last 15 sign-in attempts.", true)}
    </div>

    <div class="card" id="developer-api">
      <h2 class="card-title"><i class="fa-solid fa-code"></i> Developer API</h2>
      ${ep("POST", "/api/developer/register", "Create or update your developer profile. Body: { developer_name, company_name?, description?, website?, email?, avatar_url? }", true)}
      ${ep("GET", "/api/developer/apps", "All of your apps (drafts included) plus aggregate stats.", true)}
      ${ep("POST", "/api/developer/apps", "Create an app. Body: { app_name, description, category, version?, icon_url?, download_url?, website?, is_free?, price?, screenshots?, status? }", true)}
      ${ep("PATCH", "/api/developer/apps/:id", "Update one of your apps. Any listing field, plus status: draft|published.", true)}
      ${ep("DELETE", "/api/developer/apps/:id", "Delete one of your apps.", true)}
    </div>

    <div class="card" id="examples">
      <h2 class="card-title"><i class="fa-solid fa-terminal"></i> Examples</h2>
      <h3>Fetch the newest 10 productivity apps</h3>
      <pre class="code-block code-block-lg">curl "${esc(origin)}/api/apps?category=Productivity&amp;sort=newest&amp;limit=10"</pre>
      <h3>Sign in and list your apps</h3>
      <pre class="code-block code-block-lg">TOKEN=$(curl -s -X POST "${esc(origin)}/api/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"you@example.com","password":"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}' | jq -r .session.access_token)

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
    description: 'What it does\u2026',
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
            <tr><td><code>developers</code></td><td>Publisher profiles</td><td>developer_name, company_name, website, avatar_url, verified, user_id</td></tr>
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
`);
}
export {
  authCallbackPage,
  authPage,
  devApiKeysPage,
  devAppsPage,
  devDashboardPage,
  devDocsPage,
  devProfilePage,
  devSecurityPage,
  devSubmitPage
};
