import { raw } from "hono/html";
import { esc } from "./layout.js";
import {
  appCard,
  appRow,
  categoryTile,
  emptyState,
  formatCount,
  heroCard,
  sectionHead,
  stars,
  appIcon,
  priceLabel,
  catMeta
} from "./components.js";
function homePage(d) {
  const hero = d.featured.length ? d.featured : d.apps.slice(0, 3);
  const spotlight = hero[0];
  const activeCats = d.categories.filter((c) => c.count > 0);
  return raw(`
<section class="hero" id="hero-section">
  <div class="hero-bg" aria-hidden="true"><span></span><span></span><span></span></div>
  <div class="hero-content">
    <p class="hero-eyebrow"><i class="fa-solid fa-sparkles"></i> ${d.stats.total_apps} apps \xB7 ${formatCount(d.stats.total_downloads)} downloads \xB7 ${d.stats.developers} developers</p>
    <h1>Discover apps<br /><span class="grad-text">built in the open.</span></h1>
    <p class="hero-sub">A fast, independent app catalogue. Browse verified developer releases, read real ratings, and publish your own app in minutes \u2014 no gatekeepers.</p>
    <form class="hero-search" action="/apps" method="get" role="search">
      <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
      <input type="search" name="search" placeholder="Search apps \u2014 e.g. productivity, AI, travel\u2026" aria-label="Search apps" />
      <button class="btn btn-primary" type="submit">Search</button>
    </form>
    <div class="hero-quick">
      <span>Popular:</span>
      ${activeCats.slice(0, 5).map((c) => `<a href="/apps?category=${encodeURIComponent(c.name)}" class="quick-chip">${esc(c.name)}</a>`).join("")}
    </div>
    <div class="hero-ctas">
      <a class="btn btn-primary btn-lg" href="/apps"><i class="fa-solid fa-grip"></i> Browse all apps</a>
      <a class="btn btn-outline btn-lg" href="/developer"><i class="fa-solid fa-code"></i> Publish your app</a>
    </div>
  </div>
  ${spotlight ? `<aside class="hero-spotlight" aria-label="Featured app">
    <div class="spotlight-card">
      <span class="spotlight-badge"><i class="fa-solid fa-bolt"></i> Editor's pick</span>
      ${appIcon(spotlight, "app-icon app-icon-xl")}
      <h2>${esc(spotlight.name)}</h2>
      <p class="spotlight-dev">${esc(spotlight.developer_name)}${spotlight.developer_verified ? ' <i class="fa-solid fa-circle-check verified"></i>' : ""}</p>
      <p class="spotlight-desc">${esc(spotlight.short_description)}</p>
      <div class="spotlight-meta">
        ${spotlight.rating > 0 ? `<span>${stars(spotlight.rating, "stars-sm")} <b>${spotlight.rating.toFixed(1)}</b></span>` : "<span>New</span>"}
        <span><i class="fa-solid fa-download"></i> ${formatCount(spotlight.downloads)}</span>
        <span class="price ${spotlight.is_free ? "is-free" : ""}">${priceLabel(spotlight)}</span>
      </div>
      <a class="btn btn-primary btn-block" href="/app/${esc(spotlight.slug)}">View app <i class="fa-solid fa-arrow-right"></i></a>
    </div>
  </aside>` : ""}
</section>

<section class="stats-strip" id="stats-section" aria-label="Store statistics">
  <div class="stat"><i class="fa-solid fa-cubes"></i><div><strong>${d.stats.total_apps}</strong><small>Published apps</small></div></div>
  <div class="stat"><i class="fa-solid fa-download"></i><div><strong>${formatCount(d.stats.total_downloads)}</strong><small>Total downloads</small></div></div>
  <div class="stat"><i class="fa-solid fa-star"></i><div><strong>${d.stats.avg_rating ? d.stats.avg_rating.toFixed(1) : "\u2014"}</strong><small>Average rating</small></div></div>
  <div class="stat"><i class="fa-solid fa-users"></i><div><strong>${d.stats.developers}</strong><small>Developers</small></div></div>
  <div class="stat"><i class="fa-solid fa-layer-group"></i><div><strong>${activeCats.length}</strong><small>Live categories</small></div></div>
</section>

${hero.length ? `<section class="section" id="featured-section">
  ${sectionHead("Featured this week", "Hand-picked apps worth your home screen", { href: "/apps?sort=rated", label: "See all" })}
  <div class="hero-card-row">${hero.slice(0, 3).map(heroCard).join("")}</div>
</section>` : ""}

<section class="section" id="trending-section">
  ${sectionHead("Trending now", "Most downloaded across the store", { href: "/top-charts", label: "Top charts" })}
  ${d.apps.length ? `<div class="app-grid">${d.apps.slice(0, 8).map(appCard).join("")}</div>` : emptyState(null, "No apps yet", "Once developers publish apps they will appear here.", { href: "/developer/submit", label: "Publish the first app" })}
</section>

${activeCats.length ? `<section class="section" id="categories-section">
  ${sectionHead("Browse by category", "Find exactly what you need", { href: "/categories", label: "All categories" })}
  <div class="category-grid">${activeCats.slice(0, 8).map((c) => categoryTile(c.name, c.count)).join("")}</div>
</section>` : ""}

<section class="section section-split" id="charts-preview">
  <div class="split-col">
    ${sectionHead("Top rated", "Highest user ratings")}
    <div class="app-list">${d.topRated.slice(0, 5).map((a, i) => appRow(a, i + 1)).join("") || emptyState("fa-star", "No ratings yet", "Ratings appear as users review apps.")}</div>
  </div>
  <div class="split-col">
    ${sectionHead("New & updated", "Freshly published releases")}
    <div class="app-list">${d.newest.slice(0, 5).map((a) => appRow(a)).join("") || emptyState("fa-clock", "Nothing new", "New releases will show up here.")}</div>
  </div>
</section>

<section class="cta-band" id="developer-cta">
  <div class="cta-band-inner">
    <div>
      <p class="cta-eyebrow"><i class="fa-solid fa-code"></i> For developers</p>
      <h2>Ship your app to the world today</h2>
      <p>Create a developer profile, upload your icon and listing, and publish instantly. Full REST API, version management, and download analytics included \u2014 free.</p>
      <div class="cta-actions">
        <a class="btn btn-light btn-lg" href="/developer/submit"><i class="fa-solid fa-cloud-arrow-up"></i> Submit an app</a>
        <a class="btn btn-ghost-light btn-lg" href="/developer/docs">Read the API docs</a>
      </div>
    </div>
    <ul class="cta-list">
      <li><i class="fa-solid fa-circle-check"></i> Instant publishing \u2014 no review queue</li>
      <li><i class="fa-solid fa-circle-check"></i> Version + changelog management</li>
      <li><i class="fa-solid fa-circle-check"></i> Download &amp; rating analytics</li>
      <li><i class="fa-solid fa-circle-check"></i> Public JSON API for every listing</li>
    </ul>
  </div>
</section>
`);
}
function browsePage(opts) {
  const { apps, categories, search, category, sort, price } = opts;
  const activeCats = categories.filter((c) => c.count > 0);
  return raw(`
<section class="page-head">
  <div class="page-head-inner">
    <nav class="breadcrumb"><a href="/">Home</a><i class="fa-solid fa-chevron-right"></i><span>Browse</span></nav>
    <h1>${search ? `Results for \u201C${esc(search)}\u201D` : category && category !== "All" ? `${esc(category)} apps` : "Browse all apps"}</h1>
    <p id="results-count">${apps.length} ${apps.length === 1 ? "app" : "apps"} found</p>
  </div>
</section>

<section class="browse-layout">
  <aside class="filter-panel" id="filter-panel" aria-label="Filters">
    <form id="filter-form" method="get" action="/apps">
      <div class="filter-block">
        <label class="filter-label" for="filter-search">Search</label>
        <div class="input-icon">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input id="filter-search" type="search" name="search" value="${esc(search)}" placeholder="App name or keyword" />
        </div>
      </div>

      <div class="filter-block">
        <span class="filter-label">Category</span>
        <div class="filter-chips">
          <label class="chip-radio"><input type="radio" name="category" value="All" ${!category || category === "All" ? "checked" : ""} /><span>All</span></label>
          ${activeCats.map(
    (c) => `<label class="chip-radio"><input type="radio" name="category" value="${esc(c.name)}" ${category === c.name ? "checked" : ""} /><span>${esc(c.name)} <b>${c.count}</b></span></label>`
  ).join("")}
        </div>
      </div>

      <div class="filter-block">
        <label class="filter-label" for="filter-sort">Sort by</label>
        <select id="filter-sort" name="sort">
          <option value="popular" ${sort === "popular" ? "selected" : ""}>Most popular</option>
          <option value="newest" ${sort === "newest" ? "selected" : ""}>Newest</option>
          <option value="rated" ${sort === "rated" ? "selected" : ""}>Highest rated</option>
          <option value="name" ${sort === "name" ? "selected" : ""}>Name (A\u2013Z)</option>
        </select>
      </div>

      <div class="filter-block">
        <span class="filter-label">Price</span>
        <div class="filter-chips">
          <label class="chip-radio"><input type="radio" name="price" value="all" ${price === "all" || !price ? "checked" : ""} /><span>All</span></label>
          <label class="chip-radio"><input type="radio" name="price" value="free" ${price === "free" ? "checked" : ""} /><span>Free</span></label>
          <label class="chip-radio"><input type="radio" name="price" value="paid" ${price === "paid" ? "checked" : ""} /><span>Paid</span></label>
        </div>
      </div>

      <div class="filter-actions">
        <button class="btn btn-primary btn-block" type="submit"><i class="fa-solid fa-filter"></i> Apply filters</button>
        <a class="btn btn-ghost btn-block" href="/apps">Reset</a>
      </div>
    </form>
  </aside>

  <div class="browse-results">
    <div class="browse-toolbar">
      <button class="btn btn-outline btn-sm filter-toggle" type="button" id="filter-toggle"><i class="fa-solid fa-sliders"></i> Filters</button>
      <div class="view-switch" role="group" aria-label="Layout">
        <button type="button" class="view-btn is-active" data-view="grid" aria-label="Grid view"><i class="fa-solid fa-grip"></i></button>
        <button type="button" class="view-btn" data-view="list" aria-label="List view"><i class="fa-solid fa-list"></i></button>
      </div>
    </div>
    <div id="results-container" class="app-grid" data-view="grid">
      ${apps.length ? apps.map(appCard).join("") : ""}
    </div>
    ${apps.length ? "" : emptyState(null, "No apps match those filters", "Try a broader search or clear your filters.", {
    href: "/apps",
    label: "Clear filters"
  })}
  </div>
</section>
`);
}
function categoriesPage(categories) {
  const active = categories.filter((c) => c.count > 0);
  const empty = categories.filter((c) => c.count === 0);
  return raw(`
<section class="page-head">
  <div class="page-head-inner">
    <nav class="breadcrumb"><a href="/">Home</a><i class="fa-solid fa-chevron-right"></i><span>Categories</span></nav>
    <h1>All categories</h1>
    <p>${active.length} categories with published apps \xB7 ${categories.length} total</p>
  </div>
</section>
<section class="section">
  ${active.length ? `${sectionHead("With apps available", "Jump straight into a catalogue")}<div class="category-grid category-grid-lg">${active.map((c) => categoryTile(c.name, c.count)).join("")}</div>` : ""}
</section>
${empty.length ? `<section class="section">
  ${sectionHead("Coming soon", "No published apps yet \u2014 be the first")}
  <div class="category-grid category-grid-muted">${empty.map((c) => categoryTile(c.name, c.count)).join("")}</div>
</section>` : ""}
`);
}
function chartsPage(d) {
  const tab = (id, label, icon, apps, ranked = true) => `
  <div class="chart-panel" id="chart-${id}" role="tabpanel" ${id === "popular" ? "" : "hidden"}>
    <div class="app-list app-list-bordered">
      ${apps.length ? apps.map((a, i) => appRow(a, ranked ? i + 1 : void 0)).join("") : emptyState(null, "No data yet", "Charts populate as apps gain downloads and ratings.")}
    </div>
  </div>`;
  return raw(`
<section class="page-head">
  <div class="page-head-inner">
    <nav class="breadcrumb"><a href="/">Home</a><i class="fa-solid fa-chevron-right"></i><span>Top charts</span></nav>
    <h1>Top charts</h1>
    <p>The most downloaded, best rated and newest apps in the store</p>
  </div>
</section>
<section class="section">
  <div class="tabs" role="tablist" aria-label="Chart type">
    <button class="tab-btn is-active" role="tab" data-chart="popular" aria-selected="true"><i class="fa-solid fa-fire"></i> Most downloaded</button>
    <button class="tab-btn" role="tab" data-chart="rated" aria-selected="false"><i class="fa-solid fa-star"></i> Top rated</button>
    <button class="tab-btn" role="tab" data-chart="newest" aria-selected="false"><i class="fa-solid fa-clock"></i> New releases</button>
    <button class="tab-btn" role="tab" data-chart="free" aria-selected="false"><i class="fa-solid fa-gift"></i> Top free</button>
  </div>
  ${tab("popular", "Most downloaded", "fa-fire", d.popular)}
  ${tab("rated", "Top rated", "fa-star", d.topRated)}
  ${tab("newest", "New releases", "fa-clock", d.newest, false)}
  ${tab("free", "Top free", "fa-gift", d.free)}
</section>
`);
}
/** Bytes / megabytes as a short human string. */
function sizeLabel(v) {
  const n = Number(v || 0);
  if (!n) return "";
  if (n > 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} MB`;
}
function appDetailPage(d) {
  const { app, developer, more, similar, reviews } = d;
  const versions = d.versions || [];
  const driveUrl = app.drive_url && app.drive_url !== app.download_url ? app.drive_url : null;
  const siteUrl = app.website_link || app.website || null;
  // Deep link into the companion Android client (application id com.app.store).
  // Chrome's intent: syntax falls back to this very page when the app is absent.
  const pkg = d.packageName || "com.app.store";
  const webUrl = `${d.origin || ""}/app/${app.slug}`;
  const appLink =
    `intent://app/${encodeURIComponent(app.slug)}#Intent;scheme=openappstore;package=${pkg};` +
    `S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
  const m = catMeta(app.category);
  const descHtml = renderDescription(app.description);
  const updated = app.updated_at ? new Date(app.updated_at).toLocaleDateString(void 0, { year: "numeric", month: "short", day: "numeric" }) : "\u2014";
  const created = app.created_at ? new Date(app.created_at).toLocaleDateString(void 0, { year: "numeric", month: "short", day: "numeric" }) : "\u2014";
  return raw(`
<section class="app-hero" style="--cat-color:${m.color}">
  <div class="app-hero-bg" aria-hidden="true"></div>
  <div class="app-hero-inner">
    <nav class="breadcrumb breadcrumb-light">
      <a href="/">Home</a><i class="fa-solid fa-chevron-right"></i>
      <a href="/apps?category=${encodeURIComponent(app.category)}">${esc(app.category)}</a><i class="fa-solid fa-chevron-right"></i>
      <span>${esc(app.name)}</span>
    </nav>
    <div class="app-hero-main">
      ${appIcon(app, "app-icon app-icon-xl app-hero-icon")}
      <div class="app-hero-info">
        <h1>${esc(app.name)}</h1>
        <p class="app-hero-dev">
          ${developer ? `<a href="/developer-profile/${esc(developer.id)}">${esc(app.developer_name)}</a>` : esc(app.developer_name)}
          ${app.developer_verified ? '<i class="fa-solid fa-circle-check verified" title="Verified developer"></i>' : ""}
        </p>
        <div class="app-hero-tags">
          <span class="pill pill-cat" style="--cat-color:${m.color}"><i class="fa-solid ${m.icon}"></i> ${esc(app.category)}</span>
          <span class="pill">v${esc(app.version)}</span>
          <span class="pill ${app.is_free ? "pill-free" : ""}">${priceLabel(app)}</span>
          ${app.update_available ? '<span class="pill pill-update"><i class="fa-solid fa-arrows-rotate"></i> Update available</span>' : ""}
          ${app.status !== "published" ? `<span class="pill pill-warn">${esc(app.status)}</span>` : ""}
        </div>
        <div class="app-hero-actions">
          <button class="btn btn-primary btn-lg js-get" data-app-id="${esc(app.id)}" data-app-name="${esc(app.name)}" data-url="${esc(app.download_url || app.drive_url || app.website || "")}" data-slug="${esc(app.slug)}">
            <i class="fa-solid fa-download"></i> ${app.is_free ? "Get it now" : `Buy $${app.price.toFixed(2)}`}
          </button>
          <a class="btn btn-outline-light btn-lg" href="${esc(appLink)}" data-open-in-app="${esc(app.slug)}"><i class="fa-brands fa-android"></i> Open in app</a>
          ${siteUrl ? `<a class="btn btn-outline-light btn-lg" href="${esc(siteUrl)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-globe"></i> Website</a>` : ""}
          <button class="btn btn-ghost-light btn-lg js-share" data-title="${esc(app.name)}"><i class="fa-solid fa-share-nodes"></i> Share</button>
        </div>
      </div>
    </div>
    <div class="app-hero-stats">
      <div><strong>${app.rating > 0 ? app.rating.toFixed(1) : "\u2014"}</strong><small>${app.rating > 0 ? stars(app.rating, "stars-sm") : "No ratings"}</small></div>
      <div><strong>${formatCount(app.downloads)}</strong><small>Downloads</small></div>
      <div><strong>${app.total_ratings || reviews.length || 0}</strong><small>Reviews</small></div>
      <div><strong>${esc(app.version)}</strong><small>Version</small></div>
    </div>
  </div>
</section>

<section class="app-detail-layout">
  <div class="app-detail-main">
    ${app.screenshots.length ? `<div class="card">
      <h2 class="card-title"><i class="fa-solid fa-images"></i> Screenshots</h2>
      <div class="screenshot-rail">${app.screenshots.map((s, i) => `<img src="${esc(s)}" alt="${esc(app.name)} screenshot ${i + 1}" loading="lazy" />`).join("")}</div>
    </div>` : ""}

    ${app.update_available ? `<div class="card update-card">
      <div class="update-head">
        <span class="update-icon"><i class="fa-solid fa-arrows-rotate"></i></span>
        <div>
          <strong>Update available — v${esc(app.version)}</strong>
          <small>${app.auto_update ? "Auto-update is enabled for this app, so installs refresh in the background." : "Auto-update is off — grab the new build manually below."}</small>
        </div>
        <span class="pill ${app.auto_update ? "pill-free" : "pill-warn"}">${app.auto_update ? "Auto-update on" : "Manual update"}</span>
      </div>
      ${app.change_log ? `<div class="prose update-log">${renderDescription(app.change_log)}</div>` : ""}
      <button class="btn btn-primary btn-sm js-get" data-app-id="${esc(app.id)}" data-app-name="${esc(app.name)}" data-url="${esc(app.download_url || app.drive_url || app.website || "")}" data-slug="${esc(app.slug)}"><i class="fa-solid fa-cloud-arrow-down"></i> Update to v${esc(app.version)}</button>
    </div>` : ""}

    <div class="card">
      <h2 class="card-title"><i class="fa-solid fa-circle-info"></i> About this app</h2>
      <div class="prose">${descHtml}</div>
      ${!app.update_available && app.change_log ? `<details class="changelog"><summary><i class="fa-solid fa-list-check"></i> What's new in v${esc(app.version)}</summary><div class="prose">${renderDescription(app.change_log)}</div></details>` : ""}
    </div>

    ${versions.length ? `<div class="card">
      <h2 class="card-title"><i class="fa-solid fa-clock-rotate-left"></i> Version history</h2>
      <ol class="version-list">
        ${versions.map((v, i) => {
    const when = v.release_date || v.created_at;
    const size = sizeLabel(v.file_size);
    return `<li class="version-item${i === 0 ? " is-latest" : ""}">
          <div class="version-head">
            <strong>v${esc(v.version_number)}</strong>
            ${i === 0 ? '<span class="pill pill-free">Latest</span>' : ""}
            ${when ? `<time datetime="${esc(when)}">${new Date(when).toLocaleDateString(void 0, { year: "numeric", month: "short", day: "numeric" })}</time>` : ""}
            ${size ? `<span class="pill pill-muted">${esc(size)}</span>` : ""}
          </div>
          ${v.release_notes ? `<p class="version-notes">${esc(v.release_notes)}</p>` : '<p class="version-notes muted">No release notes for this version.</p>'}
          ${v.download_url ? `<a class="btn btn-outline btn-sm js-get" data-exact="1" data-app-id="${esc(app.id)}" data-app-name="${esc(app.name)} v${esc(v.version_number)}" data-url="${esc(v.download_url)}" data-slug="${esc(app.slug)}"><i class="fa-solid fa-download"></i> Download v${esc(v.version_number)}</a>` : ""}
        </li>`;
  }).join("")}
      </ol>
    </div>` : ""}

    <div class="card">
      <h2 class="card-title"><i class="fa-solid fa-star"></i> Ratings &amp; reviews</h2>
      <div class="rating-summary">
        <div class="rating-big">
          <strong>${app.rating > 0 ? app.rating.toFixed(1) : "\u2014"}</strong>
          ${stars(app.rating)}
          <small>${app.total_ratings || reviews.length || 0} ratings</small>
        </div>
        <div class="rating-bars">
          ${[5, 4, 3, 2, 1].map((n) => {
    const count = reviews.filter((r) => Number(r.rating) === n).length;
    const pct = reviews.length ? Math.round(count / reviews.length * 100) : 0;
    return `<div class="rating-bar"><span>${n}<i class="fa-solid fa-star"></i></span><div class="bar"><i style="width:${pct}%"></i></div><small>${count}</small></div>`;
  }).join("")}
        </div>
      </div>
      <div id="reviews-list" class="reviews-list">
        ${reviews.length ? reviews.map(
    (r) => `<article class="review">
          <header>${stars(Number(r.rating) || 0, "stars-sm")} <strong>${esc(r.title || "Review")}</strong>
          <time>${r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}</time></header>
          <p>${esc(r.review_text || "")}</p>
        </article>`
  ).join("") : `<p class="muted">No reviews yet \u2014 be the first to share your experience.</p>`}
      </div>
      <details class="review-form-wrap">
        <summary class="btn btn-outline btn-sm"><i class="fa-solid fa-pen"></i> Write a review</summary>
        <form id="review-form" class="review-form" data-app-id="${esc(app.id)}">
          <div class="star-picker" id="star-picker" role="radiogroup" aria-label="Your rating">
            ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star-pick" data-value="${n}" aria-label="${n} stars"><i class="fa-regular fa-star"></i></button>`).join("")}
          </div>
          <input type="hidden" name="rating" id="review-rating" value="0" />
          <input type="text" name="title" placeholder="Headline (optional)" maxlength="120" />
          <textarea name="review_text" rows="4" placeholder="What did you like or dislike?"></textarea>
          <button class="btn btn-primary" type="submit">Submit review</button>
          <p class="form-note">You need to be signed in to post a review.</p>
        </form>
      </details>
    </div>

    ${similar.length ? `<div class="card">
      <h2 class="card-title"><i class="fa-solid fa-shuffle"></i> Similar apps in ${esc(app.category)}</h2>
      <div class="app-list">${similar.slice(0, 5).map((a) => appRow(a)).join("")}</div>
    </div>` : ""}
  </div>

  <aside class="app-detail-side">
    <div class="card">
      <h2 class="card-title"><i class="fa-solid fa-table-list"></i> Information</h2>
      <dl class="info-list">
        <dt>Developer</dt><dd>${developer ? `<a href="/developer-profile/${esc(developer.id)}">${esc(app.developer_name)}</a>` : esc(app.developer_name)}</dd>
        <dt>Category</dt><dd><a href="/apps?category=${encodeURIComponent(app.category)}">${esc(app.category)}</a></dd>
        <dt>Version</dt><dd>${esc(app.version)}</dd>
        <dt>Price</dt><dd>${priceLabel(app)}</dd>
        <dt>Released</dt><dd>${created}</dd>
        <dt>Updated</dt><dd>${updated}</dd>
        <dt>App ID</dt><dd><code class="code-inline">${esc(app.slug)}</code></dd>
        ${app.support_email ? `<dt>Support</dt><dd><a href="mailto:${esc(app.support_email)}">${esc(app.support_email)}</a></dd>` : ""}
        ${siteUrl ? `<dt>Website</dt><dd><a href="${esc(siteUrl)}" target="_blank" rel="noopener noreferrer">Visit site</a></dd>` : ""}
        ${app.download_host ? `<dt>Hosted on</dt><dd>${esc(app.download_host)}</dd>` : ""}
        ${app.min_version ? `<dt>Requires</dt><dd>v${esc(app.min_version)} or newer</dd>` : ""}
        ${app.version_code ? `<dt>Build</dt><dd><code class="code-inline">${esc(String(app.version_code))}</code></dd>` : ""}
        <dt>Auto-update</dt><dd>${app.auto_update ? "Enabled" : "Disabled"}</dd>
      </dl>
    </div>

    <div class="card link-card">
      <h2 class="card-title"><i class="fa-solid fa-link"></i> Links &amp; downloads</h2>
      ${app.download_url ? `<a class="link-tile js-get" data-app-id="${esc(app.id)}" data-app-name="${esc(app.name)}" data-url="${esc(app.download_url)}" data-slug="${esc(app.slug)}" href="${esc(app.download_url)}" ${app.download_is_drive ? 'style="--tile:#f9ab00"' : 'style="--tile:#22c55e"'}>
        <span><i class="fa-${app.download_is_drive ? "brands fa-google-drive" : "solid fa-download"}"></i></span>
        <div><strong>${app.download_is_drive ? "Download from Drive" : "Direct download"}</strong><small>${esc(app.download_host || "Latest build")}</small></div>
        <i class="fa-solid fa-chevron-right"></i>
      </a>` : ""}
      ${driveUrl ? `<a class="link-tile js-get" data-exact="1" data-app-id="${esc(app.id)}" data-app-name="${esc(app.name)}" data-url="${esc(driveUrl)}" data-slug="${esc(app.slug)}" href="${esc(driveUrl)}" style="--tile:#f9ab00">
        <span><i class="fa-brands fa-google-drive"></i></span>
        <div><strong>Google Drive mirror</strong><small>Direct download from Drive</small></div>
        <i class="fa-solid fa-chevron-right"></i>
      </a>` : ""}
      ${siteUrl ? `<a class="link-tile" href="${esc(siteUrl)}" target="_blank" rel="noopener noreferrer" style="--tile:#3b82f6">
        <span><i class="fa-solid fa-globe"></i></span>
        <div><strong>Visit website</strong><small>Docs, changelog &amp; support</small></div>
        <i class="fa-solid fa-arrow-up-right-from-square"></i>
      </a>` : ""}
      ${app.support_email ? `<a class="link-tile" href="mailto:${esc(app.support_email)}" style="--tile:#8b5cf6">
        <span><i class="fa-solid fa-envelope"></i></span>
        <div><strong>Contact developer</strong><small>${esc(app.support_email)}</small></div>
        <i class="fa-solid fa-chevron-right"></i>
      </a>` : ""}
      <a class="link-tile" href="${esc(appLink)}" data-open-in-app="${esc(app.slug)}" style="--tile:#0f9d58">
        <span><i class="fa-brands fa-android"></i></span>
        <div><strong>Open in the Open Appstore app</strong><small>${esc(pkg)}</small></div>
        <i class="fa-solid fa-chevron-right"></i>
      </a>
      <a class="link-tile" href="${esc(app.privacy_policy_link || "/legal/privacy")}" ${app.privacy_policy_link ? 'target="_blank" rel="noopener noreferrer"' : ""} style="--tile:#64748b">
        <span><i class="fa-solid fa-shield-halved"></i></span>
        <div><strong>Privacy policy</strong><small>${app.privacy_policy_link ? "Published by the developer" : "How data is handled on this store"}</small></div>
        <i class="fa-solid fa-${app.privacy_policy_link ? "arrow-up-right-from-square" : "chevron-right"}"></i>
      </a>
      <p class="open-in-app">
        <i class="fa-brands fa-google-play"></i>
        <span>Have the client installed? Listings open straight in it. <span class="pkg">${esc(pkg)}</span></span>
        <a class="btn btn-outline btn-sm" href="https://play.google.com/store/apps/details?id=${esc(pkg)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-arrow-up-right-from-square"></i> Get the app</a>
      </p>
    </div>

    ${developer ? `<div class="card dev-card">
      <h2 class="card-title"><i class="fa-solid fa-user-tie"></i> Developer</h2>
      <div class="dev-card-head">
        ${developer.logo_url || developer.avatar_url ? `<img class="dev-logo" src="${esc(developer.logo_url || developer.avatar_url)}" alt="${esc(developer.developer_name)}" loading="lazy" />` : `<span class="dev-logo dev-logo-fallback">${esc((developer.developer_name || "?")[0])}</span>`}
        <div>
          <strong>${esc(developer.developer_name)}${developer.verified ? ' <i class="fa-solid fa-circle-check verified"></i>' : ""}</strong>
          ${developer.company_name ? `<small>${esc(developer.company_name)}</small>` : ""}
        </div>
      </div>
      ${developer.description ? `<p class="muted">${esc(developer.description)}</p>` : ""}
      <a class="btn btn-outline btn-block btn-sm" href="/developer-profile/${esc(developer.id)}">View all apps</a>
    </div>` : ""}

    ${more.length ? `<div class="card">
      <h2 class="card-title"><i class="fa-solid fa-boxes-stacked"></i> More from this developer</h2>
      <div class="app-list app-list-compact">${more.slice(0, 4).map((a) => appRow(a)).join("")}</div>
    </div>` : ""}

    <div class="card card-api">
      <h2 class="card-title"><i class="fa-solid fa-code"></i> API</h2>
      <p class="muted">Fetch this listing as JSON:</p>
      <code class="code-block">GET /api/apps/${esc(app.slug)}</code>
      <a class="btn btn-ghost btn-sm btn-block" href="/api/apps/${esc(app.slug)}" target="_blank" rel="noopener">Open JSON <i class="fa-solid fa-arrow-up-right-from-square"></i></a>
    </div>
  </aside>
</section>
`);
}
function renderDescription(md) {
  if (!md) return '<p class="muted">No description provided.</p>';
  const lines = esc(md).split(/\r?\n/);
  const out = [];
  let inList = false;
  let inCode = false;
  const inline = (s) => s.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\[\d+(?:,\s*\d+)*\]/g, "");
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^```/.test(line.trim())) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      out.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(rawLine);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      const lvl = Math.min(h[1].length + 2, 6);
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      continue;
    }
    const li = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    if (!line.trim()) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}
function developersPage(devs) {
  return raw(`
<section class="page-head">
  <div class="page-head-inner">
    <nav class="breadcrumb"><a href="/">Home</a><i class="fa-solid fa-chevron-right"></i><span>Developers</span></nav>
    <h1>Developers</h1>
    <p>${devs.length} studios &amp; independent creators publishing on Open App Store</p>
  </div>
</section>
<section class="section">
  ${devs.length ? `<div class="dev-grid">${devs.map(
    (d) => `<a class="dev-tile" href="/developer-profile/${esc(d.id)}">
    ${d.logo_url || d.avatar_url ? `<img class="dev-logo" src="${esc(d.logo_url || d.avatar_url)}" alt="${esc(d.developer_name)}" loading="lazy" />` : `<span class="dev-logo dev-logo-fallback">${esc((d.developer_name || "?")[0])}</span>`}
    <strong>${esc(d.developer_name)}${d.verified ? ' <i class="fa-solid fa-circle-check verified"></i>' : ""}</strong>
    ${d.company_name ? `<small>${esc(d.company_name)}</small>` : "<small>Independent developer</small>"}
    <p>${esc(d.description || "No bio provided.")}</p>
    <div class="dev-tile-stats"><span><i class="fa-solid fa-cubes"></i> ${d.apps_count} apps</span><span><i class="fa-solid fa-download"></i> ${formatCount(d.total_downloads)}</span></div>
  </a>`
  ).join("")}</div>` : emptyState("fa-users", "No developers yet", "Register a developer profile to be listed here.", { href: "/developer", label: "Become a developer" })}
</section>
`);
}
function developerProfilePage(d) {
  const { developer, apps } = d;
  const downloads = apps.reduce((s, a) => s + a.downloads, 0);
  const rated = apps.filter((a) => a.rating > 0);
  const avg = rated.length ? rated.reduce((s, a) => s + a.rating, 0) / rated.length : 0;
  return raw(`
<section class="profile-hero">
  <div class="profile-hero-inner">
    <nav class="breadcrumb breadcrumb-light"><a href="/">Home</a><i class="fa-solid fa-chevron-right"></i><a href="/developers">Developers</a><i class="fa-solid fa-chevron-right"></i><span>${esc(developer.developer_name)}</span></nav>
    <div class="profile-head">
      ${developer.logo_url || developer.avatar_url ? `<img class="profile-logo" src="${esc(developer.logo_url || developer.avatar_url)}" alt="${esc(developer.developer_name)}" />` : `<span class="profile-logo profile-logo-fallback">${esc((developer.developer_name || "?")[0])}</span>`}
      <div>
        <h1>${esc(developer.developer_name)}${developer.verified ? ' <i class="fa-solid fa-circle-check verified"></i>' : ""}</h1>
        ${developer.company_name ? `<p class="profile-company">${esc(developer.company_name)}</p>` : ""}
        ${developer.description ? `<p class="profile-bio">${esc(developer.description)}</p>` : ""}
        <div class="profile-links">
          ${developer.website ? `<a class="btn btn-outline-light btn-sm" href="${esc(developer.website)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-globe"></i> Website</a>` : ""}
          ${developer.email ? `<a class="btn btn-ghost-light btn-sm" href="mailto:${esc(developer.email)}"><i class="fa-solid fa-envelope"></i> Contact</a>` : ""}
        </div>
      </div>
    </div>
    <div class="app-hero-stats">
      <div><strong>${apps.length}</strong><small>Published apps</small></div>
      <div><strong>${formatCount(downloads)}</strong><small>Downloads</small></div>
      <div><strong>${avg ? avg.toFixed(1) : "\u2014"}</strong><small>Avg rating</small></div>
      <div><strong>${developer.verified ? "Verified" : "Standard"}</strong><small>Account</small></div>
    </div>
  </div>
</section>
<section class="section">
  ${sectionHead(`Apps by ${developer.developer_name}`, `${apps.length} published`)}
  ${apps.length ? `<div class="app-grid">${apps.map(appCard).join("")}</div>` : emptyState("fa-box-open", "No published apps", "This developer has not published any apps yet.")}
</section>
`);
}
function legalPage(title, sections) {
  return raw(`
<section class="page-head">
  <div class="page-head-inner">
    <nav class="breadcrumb"><a href="/">Home</a><i class="fa-solid fa-chevron-right"></i><span>${esc(title)}</span></nav>
    <h1>${esc(title)}</h1>
    <p>Last updated ${(/* @__PURE__ */ new Date()).toLocaleDateString(void 0, { year: "numeric", month: "long", day: "numeric" })}</p>
  </div>
</section>
<section class="section">
  <div class="card prose prose-wide">
    ${sections.map((s) => `<h3>${esc(s.h)}</h3>${s.p.map((p) => `<p>${esc(p)}</p>`).join("")}`).join("")}
  </div>
</section>
`);
}
export {
  appDetailPage,
  browsePage,
  categoriesPage,
  chartsPage,
  developerProfilePage,
  developersPage,
  homePage,
  legalPage,
  renderDescription
};
