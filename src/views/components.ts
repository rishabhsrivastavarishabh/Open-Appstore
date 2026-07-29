import { esc } from './layout'
import { CATEGORY_META, type AppView } from '../lib/types'

export function formatCount(n: number): string {
  if (!n || n < 1) return '—'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`
  return String(n)
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('')
}

export function catMeta(cat: string) {
  return CATEGORY_META[cat] || CATEGORY_META.Other
}

export function appIcon(app: AppView, cls = 'app-icon'): string {
  if (app.icon_url) {
    return `<img class="${cls}" src="${esc(app.icon_url)}" alt="${esc(app.name)} icon" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'${cls} app-icon-fallback',textContent:'${esc(initials(app.name))}'}))" />`
  }
  return `<span class="${cls} app-icon-fallback">${esc(initials(app.name))}</span>`
}

export function stars(rating: number, size = ''): string {
  const r = Math.max(0, Math.min(5, rating))
  let out = `<span class="stars ${size}" role="img" aria-label="${r.toFixed(1)} out of 5 stars">`
  for (let i = 1; i <= 5; i++) {
    if (r >= i) out += '<i class="fa-solid fa-star"></i>'
    else if (r >= i - 0.5) out += '<i class="fa-solid fa-star-half-stroke"></i>'
    else out += '<i class="fa-regular fa-star"></i>'
  }
  return `${out}</span>`
}

export function priceLabel(app: AppView): string {
  return app.is_free ? 'Free' : `$${app.price.toFixed(2)}`
}

/** Standard grid card */
export function appCard(app: AppView): string {
  const m = catMeta(app.category)
  return `<article class="app-card" data-category="${esc(app.category)}" data-name="${esc(app.name.toLowerCase())}">
  <a class="app-card-link" href="/app/${esc(app.slug)}" aria-label="${esc(app.name)} details">
    <div class="app-card-banner" style="--cat-color:${m.color}">
      <i class="fa-solid ${m.icon}" aria-hidden="true"></i>
      ${app.is_featured ? '<span class="chip chip-featured"><i class="fa-solid fa-bolt"></i> Featured</span>' : ''}
    </div>
    <div class="app-card-head">
      ${appIcon(app)}
      <div class="app-card-title">
        <h3>${esc(app.name)}</h3>
        <p class="app-card-dev">${esc(app.developer_name)}${app.developer_verified ? ' <i class="fa-solid fa-circle-check verified" title="Verified developer"></i>' : ''}</p>
      </div>
    </div>
    <p class="app-card-desc">${esc(app.short_description || 'No description provided.')}</p>
    <div class="app-card-meta">
      <span class="pill pill-cat" style="--cat-color:${m.color}"><i class="fa-solid ${m.icon}"></i> ${esc(app.category)}</span>
      ${app.rating > 0 ? `<span class="pill">${stars(app.rating, 'stars-sm')} <b>${app.rating.toFixed(1)}</b></span>` : '<span class="pill pill-muted">New</span>'}
      <span class="pill"><i class="fa-solid fa-download"></i> ${formatCount(app.downloads)}</span>
    </div>
  </a>
  <div class="app-card-foot">
    <span class="price ${app.is_free ? 'is-free' : ''}">${priceLabel(app)}</span>
    <button class="btn btn-primary btn-sm js-get" data-app-id="${esc(app.id)}" data-app-name="${esc(app.name)}" data-url="${esc(app.download_url || app.website || '')}" data-slug="${esc(app.slug)}">
      <i class="fa-solid fa-download"></i> Get
    </button>
  </div>
</article>`
}

/** Compact list row (charts / search results) */
export function appRow(app: AppView, rank?: number): string {
  const m = catMeta(app.category)
  return `<a class="app-row" href="/app/${esc(app.slug)}">
  ${rank !== undefined ? `<span class="app-row-rank">${rank}</span>` : ''}
  ${appIcon(app, 'app-icon app-icon-sm')}
  <span class="app-row-body">
    <strong>${esc(app.name)}</strong>
    <small>${esc(app.category)} · ${esc(app.developer_name)}</small>
    <span class="app-row-stats">
      ${app.rating > 0 ? `${stars(app.rating, 'stars-sm')} <b>${app.rating.toFixed(1)}</b>` : '<em>New</em>'}
      <span><i class="fa-solid fa-download"></i> ${formatCount(app.downloads)}</span>
    </span>
  </span>
  <span class="app-row-side" style="--cat-color:${m.color}">
    <span class="price ${app.is_free ? 'is-free' : ''}">${priceLabel(app)}</span>
    <i class="fa-solid fa-chevron-right"></i>
  </span>
</a>`
}

/** Big hero feature card */
export function heroCard(app: AppView): string {
  const m = catMeta(app.category)
  return `<a class="hero-card" href="/app/${esc(app.slug)}" style="--cat-color:${m.color}">
  <div class="hero-card-glow"></div>
  <span class="hero-card-tag"><i class="fa-solid ${m.icon}"></i> ${esc(app.category)}</span>
  ${appIcon(app, 'app-icon app-icon-lg')}
  <h3>${esc(app.name)}</h3>
  <p class="hero-card-dev">${esc(app.developer_name)}${app.developer_verified ? ' <i class="fa-solid fa-circle-check verified"></i>' : ''}</p>
  <p class="hero-card-desc">${esc(app.short_description)}</p>
  <div class="hero-card-meta">
    ${app.rating > 0 ? `<span>${stars(app.rating, 'stars-sm')} ${app.rating.toFixed(1)}</span>` : '<span>New release</span>'}
    <span><i class="fa-solid fa-download"></i> ${formatCount(app.downloads)}</span>
    <span class="price ${app.is_free ? 'is-free' : ''}">${priceLabel(app)}</span>
  </div>
  <span class="hero-card-cta">View app <i class="fa-solid fa-arrow-right"></i></span>
</a>`
}

export function categoryTile(name: string, count: number): string {
  const m = catMeta(name)
  return `<a class="category-tile" href="/apps?category=${encodeURIComponent(name)}" style="--cat-color:${m.color}">
  <span class="category-tile-icon"><i class="fa-solid ${m.icon}"></i></span>
  <span class="category-tile-body">
    <strong>${esc(name)}</strong>
    <small>${count} ${count === 1 ? 'app' : 'apps'}</small>
  </span>
  <i class="fa-solid fa-chevron-right category-tile-arrow"></i>
</a>`
}

export function sectionHead(title: string, subtitle?: string, link?: { href: string; label: string }): string {
  return `<div class="section-head">
  <div>
    <h2>${esc(title)}</h2>
    ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
  </div>
  ${link ? `<a class="section-link" href="${esc(link.href)}">${esc(link.label)} <i class="fa-solid fa-arrow-right"></i></a>` : ''}
</div>`
}

export function emptyState(icon: string, title: string, msg: string, cta?: { href: string; label: string }): string {
  return `<div class="empty-state">
  <span class="empty-icon"><i class="fa-solid ${icon}"></i></span>
  <h3>${esc(title)}</h3>
  <p>${esc(msg)}</p>
  ${cta ? `<a class="btn btn-primary" href="${esc(cta.href)}">${esc(cta.label)}</a>` : ''}
</div>`
}

export function skeletonGrid(n = 8): string {
  return `<div class="app-grid">${Array.from({ length: n }, () => '<div class="skeleton-card"></div>').join('')}</div>`
}
