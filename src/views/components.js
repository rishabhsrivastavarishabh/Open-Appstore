import { esc } from "./layout.js";
import { CATEGORY_META } from "../lib/types.js";
function formatCount(n) {
  if (!n || n < 1) return "\u2014";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(n);
}
function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");
}
function catMeta(cat) {
  return CATEGORY_META[cat] || CATEGORY_META.Other;
}
function appIcon(app, cls = "app-icon") {
  if (app.icon_url) {
    return `<img class="${cls}" src="${esc(app.icon_url)}" alt="${esc(app.name)} icon" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'${cls} app-icon-fallback',textContent:'${esc(initials(app.name))}'}))" />`;
  }
  return `<span class="${cls} app-icon-fallback">${esc(initials(app.name))}</span>`;
}
function stars(rating, size = "") {
  const r = Math.max(0, Math.min(5, rating));
  let out = `<span class="stars ${size}" role="img" aria-label="${r.toFixed(1)} out of 5 stars">`;
  for (let i = 1; i <= 5; i++) {
    if (r >= i) out += '<i class="fa-solid fa-star"></i>';
    else if (r >= i - 0.5) out += '<i class="fa-solid fa-star-half-stroke"></i>';
    else out += '<i class="fa-regular fa-star"></i>';
  }
  return `${out}</span>`;
}
function priceLabel(app) {
  return app.is_free ? "Free" : `$${app.price.toFixed(2)}`;
}
function appCard(app) {
  const m = catMeta(app.category);
  return `<article class="app-card" data-category="${esc(app.category)}" data-name="${esc(app.name.toLowerCase())}">
  <a class="app-card-link" href="/app/${esc(app.slug)}" aria-label="${esc(app.name)} details">
    <div class="app-card-banner" style="--cat-color:${m.color}">
      <i class="fa-solid ${m.icon}" aria-hidden="true"></i>
      ${app.is_featured ? '<span class="chip chip-featured"><i class="fa-solid fa-bolt"></i> Featured</span>' : ""}
    </div>
    <div class="app-card-head">
      ${appIcon(app)}
      <div class="app-card-title">
        <h3>${esc(app.name)}</h3>
        <p class="app-card-dev">${esc(app.developer_name)}${app.developer_verified ? ' <i class="fa-solid fa-circle-check verified" title="Verified developer"></i>' : ""}</p>
      </div>
    </div>
    <p class="app-card-desc">${esc(app.short_description || "No description provided.")}</p>
    <div class="app-card-meta">
      <span class="pill pill-cat" style="--cat-color:${m.color}"><i class="fa-solid ${m.icon}"></i> ${esc(app.category)}</span>
      ${app.rating > 0 ? `<span class="pill">${stars(app.rating, "stars-sm")} <b>${app.rating.toFixed(1)}</b></span>` : '<span class="pill pill-muted">New</span>'}
      <span class="pill"><i class="fa-solid fa-download"></i> ${formatCount(app.downloads)}</span>
    </div>
  </a>
  <div class="app-card-foot">
    <span class="price ${app.is_free ? "is-free" : ""}">${priceLabel(app)}</span>
    <button class="btn btn-primary btn-sm js-get" data-app-id="${esc(app.id)}" data-app-name="${esc(app.name)}" data-url="${esc(app.download_url || app.website || "")}" data-slug="${esc(app.slug)}">
      <i class="fa-solid fa-download"></i> Get
    </button>
  </div>
</article>`;
}
function appRow(app, rank) {
  const m = catMeta(app.category);
  return `<a class="app-row" href="/app/${esc(app.slug)}">
  ${rank !== void 0 ? `<span class="app-row-rank">${rank}</span>` : ""}
  ${appIcon(app, "app-icon app-icon-sm")}
  <span class="app-row-body">
    <strong>${esc(app.name)}</strong>
    <small>${esc(app.category)} \xB7 ${esc(app.developer_name)}</small>
    <span class="app-row-stats">
      ${app.rating > 0 ? `${stars(app.rating, "stars-sm")} <b>${app.rating.toFixed(1)}</b>` : "<em>New</em>"}
      <span><i class="fa-solid fa-download"></i> ${formatCount(app.downloads)}</span>
    </span>
  </span>
  <span class="app-row-side" style="--cat-color:${m.color}">
    <span class="price ${app.is_free ? "is-free" : ""}">${priceLabel(app)}</span>
    <i class="fa-solid fa-chevron-right"></i>
  </span>
</a>`;
}
function heroCard(app) {
  const m = catMeta(app.category);
  return `<a class="hero-card" href="/app/${esc(app.slug)}" style="--cat-color:${m.color}">
  <div class="hero-card-glow"></div>
  <span class="hero-card-tag"><i class="fa-solid ${m.icon}"></i> ${esc(app.category)}</span>
  ${appIcon(app, "app-icon app-icon-lg")}
  <h3>${esc(app.name)}</h3>
  <p class="hero-card-dev">${esc(app.developer_name)}${app.developer_verified ? ' <i class="fa-solid fa-circle-check verified"></i>' : ""}</p>
  <p class="hero-card-desc">${esc(app.short_description)}</p>
  <div class="hero-card-meta">
    ${app.rating > 0 ? `<span>${stars(app.rating, "stars-sm")} ${app.rating.toFixed(1)}</span>` : "<span>New release</span>"}
    <span><i class="fa-solid fa-download"></i> ${formatCount(app.downloads)}</span>
    <span class="price ${app.is_free ? "is-free" : ""}">${priceLabel(app)}</span>
  </div>
  <span class="hero-card-cta">View app <i class="fa-solid fa-arrow-right"></i></span>
</a>`;
}
function categoryTile(name, count) {
  const m = catMeta(name);
  return `<a class="category-tile" href="/apps?category=${encodeURIComponent(name)}" style="--cat-color:${m.color}">
  <span class="category-tile-icon"><i class="fa-solid ${m.icon}"></i></span>
  <span class="category-tile-body">
    <strong>${esc(name)}</strong>
    <small>${count} ${count === 1 ? "app" : "apps"}</small>
  </span>
  <i class="fa-solid fa-chevron-right category-tile-arrow"></i>
</a>`;
}
function sectionHead(title, subtitle, link) {
  return `<div class="section-head">
  <div>
    <h2>${esc(title)}</h2>
    ${subtitle ? `<p>${esc(subtitle)}</p>` : ""}
  </div>
  ${link ? `<a class="section-link" href="${esc(link.href)}">${esc(link.label)} <i class="fa-solid fa-arrow-right"></i></a>` : ""}
</div>`;
}
function notFoundArt(cls = "notfound-art") {
  return `<svg class="${cls}" viewBox="0 0 512 512" role="img" aria-label="No app found" focusable="false">
  <path fill="currentColor" fill-rule="evenodd" d="M82.50 510.36C78.65 509.55 71.22 506.83 66.00 504.31C57.99 500.45 55.15 498.38 47.91 491.12C35.28 478.45 29.41 466.68 27.04 449.31C24.98 434.22 25.76 431.16 50.12 358.50C62.28 322.20 73.99 288.90 76.12 284.50C83.00 270.33 93.87 259.58 108.50 252.48C124.68 244.64 117.57 245.00 255.87 245.00C394.47 245.00 387.86 244.67 403.50 252.41C418.27 259.73 429.03 270.40 435.88 284.50C438.01 288.90 449.71 322.20 461.88 358.50C486.24 431.16 487.02 434.24 484.96 449.31C482.59 466.69 476.71 478.46 464.09 491.10C456.90 498.30 453.95 500.46 446.00 504.32C425.03 514.52 404.21 514.53 383.10 504.35C375.24 500.55 372.28 498.40 365.02 491.16C360.24 486.39 354.80 479.80 352.93 476.50C351.05 473.20 346.09 460.38 341.89 448.00L334.26 425.50L256.00 425.50L177.74 425.50L170.11 448.00C165.91 460.38 160.94 473.20 159.06 476.50C157.18 479.80 151.79 486.38 147.07 491.12C139.83 498.40 137.02 500.44 129.00 504.31C113.67 511.68 98.30 513.69 82.50 510.36Z M107.20 488.89C120.89 486.04 134.03 476.24 140.24 464.26C142.17 460.54 147.44 446.37 151.95 432.78C158.95 411.65 160.59 407.68 163.15 405.53L166.15 403.00L256.00 403.00L345.85 403.00L348.85 405.53C351.41 407.68 353.05 411.65 360.05 432.78C369.79 462.15 373.12 469.04 381.13 476.46C405.54 499.06 443.44 492.11 458.20 462.34C462.22 454.21 462.39 453.49 462.76 442.70L463.14 431.50L440.57 364.64C428.16 327.87 416.62 295.20 414.94 292.05C411.25 285.11 404.52 278.33 396.66 273.62C385.19 266.75 390.50 267.00 256.00 267.00C121.50 267.00 126.81 266.75 115.34 273.62C107.48 278.33 100.75 285.11 97.06 292.05C95.38 295.20 83.84 327.87 71.43 364.64L48.86 431.50L49.24 442.70C49.61 453.49 49.78 454.21 53.80 462.34C63.82 482.55 85.63 493.39 107.20 488.89Z M227.53 205.73C224.60 202.80 224.00 201.48 224.00 197.98C224.00 194.04 224.55 193.19 232.18 185.38L240.35 177.00L232.18 168.62C224.55 160.81 224.00 159.96 224.00 156.02C224.00 152.55 224.61 151.19 227.40 148.40C230.19 145.61 231.55 145.00 235.02 145.00C238.96 145.00 239.81 145.55 247.62 153.18L256.00 161.35L264.38 153.18C272.19 145.55 273.04 145.00 276.98 145.00C280.48 145.00 281.80 145.60 284.73 148.53C287.98 151.78 288.21 152.41 287.74 156.64C287.27 160.77 286.42 162.04 279.41 169.09L271.60 176.95L279.80 185.35C287.45 193.19 288.00 194.04 288.00 197.98C288.00 201.48 287.40 202.80 284.47 205.73C281.22 208.98 280.59 209.21 276.36 208.74C272.23 208.27 270.96 207.42 263.88 200.38L256.00 192.55L248.12 200.38C241.04 207.42 239.77 208.27 235.64 208.74C231.41 209.21 230.78 208.98 227.53 205.73Z"/>
  <path fill="#33CCCC" fill-rule="evenodd" d="M340.37 362.23C337.16 359.63 336.00 356.67 336.00 351.07L336.00 346.00L331.40 346.00C325.14 346.00 320.52 343.61 318.48 339.33C316.24 334.59 317.21 329.84 321.11 326.56C323.63 324.44 325.18 324.00 330.08 324.00L336.00 324.00L336.00 318.02C336.00 312.89 336.40 311.59 338.75 308.98C341.87 305.52 346.99 304.26 351.25 305.89C355.33 307.46 357.99 312.53 358.00 318.75L358.00 324.00L363.78 324.00C370.50 324.00 373.56 325.70 375.59 330.57C377.42 334.93 376.46 339.19 372.89 342.60C370.57 344.83 368.85 345.46 364.11 345.80L358.22 346.22L357.79 352.26C357.41 357.51 356.94 358.67 354.16 361.15C350.36 364.54 343.85 365.05 340.37 362.23Z M142.50 345.05C139.86 343.96 136.40 340.07 135.54 337.23C134.58 334.05 136.67 328.40 139.71 326.02C142.11 324.13 143.72 324.00 165.06 324.00L187.85 324.00L190.89 326.56C194.79 329.84 195.76 334.59 193.52 339.33C190.64 345.39 187.96 346.01 164.85 345.94C153.66 345.90 143.60 345.50 142.50 345.05Z M199.38 134.58C195.02 132.66 193.00 129.34 193.00 124.08C193.00 119.97 193.43 119.20 198.23 114.69C222.88 91.55 260.77 85.49 291.31 99.80C301.39 104.52 306.66 108.01 313.77 114.69C318.57 119.20 319.00 119.97 319.00 124.08C319.00 129.45 316.95 132.71 312.36 134.62C307.79 136.53 304.48 135.55 298.50 130.50C290.59 123.81 284.11 120.12 275.55 117.42C254.17 110.66 232.25 114.96 214.92 129.32C207.58 135.39 204.00 136.60 199.38 134.58Z M166.26 101.97C165.02 101.48 163.11 99.59 162.01 97.78C157.23 89.94 160.50 84.78 178.88 71.15C192.97 60.70 211.67 52.37 230.00 48.38C241.99 45.77 270.01 45.77 282.00 48.38C299.05 52.09 314.86 58.80 329.50 68.54C339.61 75.26 350.67 85.65 351.55 89.25C353.15 95.85 348.79 101.93 341.91 102.71C337.47 103.21 337.21 103.07 328.48 95.68C307.60 78.00 286.60 69.55 260.39 68.27C232.07 66.89 206.29 76.21 182.69 96.34C174.59 103.26 171.82 104.21 166.26 101.97Z M134.38 69.56C130.02 67.67 128.00 64.34 128.00 59.07C128.00 54.88 128.42 54.18 134.25 48.51C186.88 -2.65 270.84 -14.62 337.10 19.60C352.67 27.65 372.82 42.34 380.90 51.53C386.60 58.04 384.44 67.38 376.63 69.96C371.90 71.52 369.39 70.29 359.28 61.45C337.56 42.46 313.14 30.48 284.56 24.78C268.84 21.65 243.16 21.65 227.44 24.78C198.93 30.47 174.32 42.57 152.61 61.60C145.27 68.04 140.56 71.10 138.18 70.96C137.81 70.94 136.10 70.31 134.38 69.56Z"/>
</svg>`;
}
function emptyState(icon, title, msg, cta) {
  // Pass icon as null (or "art") to use the "no app found" illustration
  // instead of a Font Awesome glyph.
  const art = !icon || icon === "art";
  return `<div class="empty-state${art ? " empty-state-art" : ""}">
  <span class="empty-icon">${art ? notFoundArt() : `<i class="fa-solid ${icon}"></i>`}</span>
  <h3>${esc(title)}</h3>
  <p>${esc(msg)}</p>
  ${cta ? `<a class="btn btn-primary" href="${esc(cta.href)}">${esc(cta.label)}</a>` : ""}
</div>`;
}
function skeletonGrid(n = 8) {
  return `<div class="app-grid">${Array.from({ length: n }, () => '<div class="skeleton-card"></div>').join("")}</div>`;
}
export {
  appCard,
  appIcon,
  appRow,
  catMeta,
  categoryTile,
  emptyState,
  notFoundArt,
  formatCount,
  heroCard,
  initials,
  priceLabel,
  sectionHead,
  skeletonGrid,
  stars
};
