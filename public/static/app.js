/* =========================================================================
   Open App Store — front-end runtime
   Progressive enhancement over server-rendered HTML.
   ========================================================================= */

const BOOT = window.__BOOT__ || {}
const SESSION_KEY = 'oas.session.v1'
const THEME_KEY = 'oas.theme'
const VIEW_KEY = 'oas.view'

/* ------------------------------- utils --------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))

function fmt(n) {
  n = Number(n) || 0
  if (n < 1) return '—'
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K'
  return String(n)
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => (w[0] || '').toUpperCase())
    .join('')
}

function debounce(fn, ms) {
  let t
  return (...a) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
}

function starHtml(rating, cls = 'stars-sm') {
  const r = Math.max(0, Math.min(5, Number(rating) || 0))
  let out = `<span class="stars ${cls}" role="img" aria-label="${r.toFixed(1)} out of 5">`
  for (let i = 1; i <= 5; i++) {
    if (r >= i) out += '<i class="fa-solid fa-star"></i>'
    else if (r >= i - 0.5) out += '<i class="fa-solid fa-star-half-stroke"></i>'
    else out += '<i class="fa-regular fa-star"></i>'
  }
  return out + '</span>'
}

/* ------------------------------- toasts -------------------------------- */
function toast(message, type = 'info', title = '') {
  const host = $('#toast-host')
  if (!host) return alert(message)
  const icons = {
    success: 'fa-circle-check',
    error: 'fa-circle-exclamation',
    warn: 'fa-triangle-exclamation',
    info: 'fa-circle-info',
  }
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.setAttribute('role', type === 'error' ? 'alert' : 'status')
  el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}" aria-hidden="true"></i>
    <div class="toast-body">${title ? `<strong>${escHtml(title)}</strong>` : ''}<p>${escHtml(message)}</p></div>
    <button class="toast-close" type="button" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button>`
  host.appendChild(el)
  const kill = () => {
    el.classList.add('is-leaving')
    setTimeout(() => el.remove(), 240)
  }
  el.querySelector('.toast-close').addEventListener('click', kill)
  setTimeout(kill, type === 'error' ? 7000 : 4200)
}

/* ------------------------------ session -------------------------------- */
const Session = {
  get() {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  },
  set(session) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    } catch {
      /* storage full / disabled */
    }
  },
  clear() {
    try {
      localStorage.removeItem(SESSION_KEY)
    } catch {}
    ME_CACHE = null
  },
  token() {
    return this.get()?.access_token || null
  },
}

/* ------------------------------- api ----------------------------------- */
let refreshInFlight = null

async function tryRefresh() {
  const s = Session.get()
  if (!s?.refresh_token) return false
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.session?.access_token) {
        Session.set(data.session)
        return true
      }
      Session.clear()
      return false
    } catch {
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

async function api(path, opts = {}) {
  const { method = 'GET', body, auth = false, retry = true } = opts
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const t = Session.token()
    if (t) headers.Authorization = `Bearer ${t}`
  }
  let res
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    return { ok: false, status: 0, data: { success: false, error: 'Network error — check your connection.' } }
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    data = { success: res.ok }
  }
  // Expired token → refresh once, then replay.
  if (res.status === 401 && auth && retry && Session.get()?.refresh_token) {
    if (await tryRefresh()) return api(path, { ...opts, retry: false })
  }
  return { ok: res.ok, status: res.status, data }
}

/* ------------------------------- whoami -------------------------------- */
let ME_CACHE = null

async function whoami(force = false) {
  if (!Session.token()) return null
  if (ME_CACHE && !force) return ME_CACHE
  const { ok, data } = await api('/api/me', { auth: true })
  if (!ok || !data?.success) {
    if (!Session.token()) return null
    return null
  }
  ME_CACHE = data
  return ME_CACHE
}

/* ------------------------------- theme --------------------------------- */
function syncThemeIcon(theme) {
  const btn = $('#theme-toggle')
  if (!btn) return
  const i = btn.querySelector('i')
  if (i) i.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon'
  btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode')
}

function initTheme() {
  let theme
  try {
    theme = localStorage.getItem(THEME_KEY)
  } catch {}
  if (!theme) {
    theme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  document.documentElement.setAttribute('data-theme', theme)
  syncThemeIcon(theme)

  $('#theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {}
    syncThemeIcon(next)
  })
}

/* ------------------------------ account -------------------------------- */
async function doLogout() {
  await api('/api/auth/logout', { method: 'POST', auth: true })
  Session.clear()
  toast('You have been signed out.', 'success')
  setTimeout(() => location.reload(), 500)
}

async function initAccount() {
  const slot = $('#account-slot')
  if (!slot) return
  if (!Session.token()) return // keep server-rendered "Sign in" link

  const me = await whoami()
  if (!me) {
    Session.clear()
    return
  }
  const label = me.developer?.developer_name || me.user?.metadata?.developer_name || me.user?.email || 'Account'
  const email = me.user?.email || ''

  slot.innerHTML = `
    <div class="account-chip-wrap">
      <button class="account-chip" type="button" id="account-btn" aria-expanded="false" aria-haspopup="true">
        <span class="account-avatar">${escHtml(initials(label))}</span>
        <span class="account-name">${escHtml(label)}</span>
        <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
      </button>
      <div class="account-menu" id="account-menu" hidden role="menu">
        <div class="account-menu-head">
          <strong>${escHtml(label)}</strong>
          <small>${escHtml(email)}</small>
        </div>
        <a role="menuitem" href="/developer"><i class="fa-solid fa-gauge-high"></i> Developer console</a>
        <a role="menuitem" href="/developer/apps"><i class="fa-solid fa-cubes"></i> My apps</a>
        <a role="menuitem" href="/developer/submit"><i class="fa-solid fa-cloud-arrow-up"></i> Submit an app</a>
        <a role="menuitem" href="/developer/profile"><i class="fa-solid fa-id-badge"></i> Profile settings</a>
        <hr />
        <button role="menuitem" type="button" id="menu-logout"><i class="fa-solid fa-right-from-bracket"></i> Sign out</button>
      </div>
    </div>`

  const btn = $('#account-btn')
  const menu = $('#account-menu')
  const close = () => {
    menu.hidden = true
    btn.setAttribute('aria-expanded', 'false')
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    const open = menu.hidden
    menu.hidden = !open
    btn.setAttribute('aria-expanded', String(open))
  })
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) close()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close()
  })
  $('#menu-logout')?.addEventListener('click', doLogout)
}

/* ------------------------------- search -------------------------------- */
function initSearch() {
  const form = $('#header-search')
  const input = $('#header-search-input')
  const box = $('#search-suggest')
  if (!form || !input || !box) return

  let items = []
  let cursor = -1

  const close = () => {
    box.hidden = true
    box.innerHTML = ''
    items = []
    cursor = -1
  }

  const paint = () => {
    $$('.suggest-item', box).forEach((el, i) => el.classList.toggle('is-active', i === cursor))
  }

  const run = debounce(async () => {
    const q = input.value.trim()
    if (q.length < 2) return close()
    const { ok, data } = await api(`/api/apps?search=${encodeURIComponent(q)}&limit=6`)
    if (!ok || !data?.apps?.length) {
      box.hidden = false
      box.innerHTML = `<p class="suggest-empty">No apps match “${escHtml(q)}”</p>`
      items = []
      cursor = -1
      return
    }
    items = data.apps
    cursor = -1
    box.hidden = false
    box.innerHTML =
      items
        .map(
          (a) => `<a class="suggest-item" role="option" href="/app/${escHtml(a.slug)}">
        ${
          a.icon_url
            ? `<img src="${escHtml(a.icon_url)}" alt="" loading="lazy" />`
            : `<span class="suggest-fallback">${escHtml(initials(a.name))}</span>`
        }
        <span class="suggest-text"><strong>${escHtml(a.name)}</strong><small>${escHtml(a.category)} · ${escHtml(a.developer_name)}</small></span>
        <span class="suggest-price">${a.is_free ? 'Free' : '$' + Number(a.price).toFixed(2)}</span>
      </a>`
        )
        .join('') +
      `<a class="suggest-all" href="/apps?search=${encodeURIComponent(q)}"><i class="fa-solid fa-magnifying-glass"></i> See all results for “${escHtml(q)}”</a>`
  }, 220)

  input.addEventListener('input', run)
  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2) run()
  })

  input.addEventListener('keydown', (e) => {
    if (box.hidden || !items.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      cursor = (cursor + 1) % items.length
      paint()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      cursor = cursor <= 0 ? items.length - 1 : cursor - 1
      paint()
    } else if (e.key === 'Enter' && cursor >= 0) {
      e.preventDefault()
      location.href = `/app/${items[cursor].slug}`
    } else if (e.key === 'Escape') {
      close()
      input.blur()
    }
  })

  document.addEventListener('click', (e) => {
    if (!form.contains(e.target)) close()
  })

  // "/" hotkey focuses search
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase()
    if (e.key === '/' && tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      input.focus()
      input.select()
    }
  })
}

/* -------------------------------- nav ---------------------------------- */
function initNav() {
  const toggle = $('#nav-toggle')
  const nav = $('#primary-nav')
  if (!toggle || !nav) return
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open')
    toggle.setAttribute('aria-expanded', String(open))
    toggle.querySelector('i').className = open ? 'fa-solid fa-xmark' : 'fa-solid fa-bars'
  })
}

/* --------------------------- get / share ------------------------------- */
function initGetButtons() {
  document.addEventListener('click', async (e) => {
    const get = e.target.closest?.('.js-get')
    if (get) {
      e.preventDefault()
      const id = get.dataset.appId
      const name = get.dataset.appName || 'App'
      const fallback = get.dataset.url || ''
      const original = get.innerHTML
      get.disabled = true
      get.innerHTML = '<span class="spinner spinner-xs"></span> Getting…'
      const { ok, data } = await api(`/api/apps/${encodeURIComponent(id)}/download`, { method: 'POST' })
      get.disabled = false
      get.innerHTML = original
      const url = (ok && data?.url) || fallback
      if (url) {
        toast(`Opening download for ${name}…`, 'success', 'Download started')
        window.open(url, '_blank', 'noopener')
      } else {
        toast(`${name} has no download link yet. Check the developer's website.`, 'warn', 'No download URL')
      }
      return
    }

    const share = e.target.closest?.('.js-share')
    if (share) {
      e.preventDefault()
      const title = share.dataset.title || document.title
      const url = location.href
      if (navigator.share) {
        try {
          await navigator.share({ title, url })
        } catch {}
      } else if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(url)
          toast('Link copied to clipboard.', 'success')
        } catch {
          toast('Could not copy the link.', 'error')
        }
      }
    }
  })
}

/* ------------------------------- browse -------------------------------- */
function initBrowse() {
  const form = $('#filter-form')
  const panel = $('#filter-panel')
  const toggle = $('#filter-toggle')

  // Mobile bottom-sheet filters
  if (toggle && panel) {
    toggle.addEventListener('click', () => {
      const open = panel.classList.toggle('is-open')
      document.body.classList.toggle('no-scroll', open)
      toggle.setAttribute('aria-expanded', String(open))
    })
    panel.addEventListener('click', (e) => {
      if (e.target === panel) {
        panel.classList.remove('is-open')
        document.body.classList.remove('no-scroll')
      }
    })
  }

  // Auto-submit on radio / select change
  if (form) {
    $$('input[type="radio"]', form).forEach((r) => r.addEventListener('change', () => form.submit()))
    $('#filter-sort', form)?.addEventListener('change', () => form.submit())
  }

  // Grid / list view toggle (persisted)
  const container = $('#results-container')
  if (container) {
    let saved = 'grid'
    try {
      saved = localStorage.getItem(VIEW_KEY) || 'grid'
    } catch {}
    const apply = (view) => {
      container.dataset.view = view
      container.className = view === 'list' ? 'app-grid is-list' : 'app-grid'
      $$('.view-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view))
    }
    apply(saved)
    $$('.view-btn').forEach((btn) =>
      btn.addEventListener('click', () => {
        const v = btn.dataset.view
        try {
          localStorage.setItem(VIEW_KEY, v)
        } catch {}
        apply(v)
      })
    )
  }
}

/* ------------------------------- charts -------------------------------- */
function initCharts() {
  const tabs = $$('.tab-btn[data-chart]')
  if (!tabs.length) return
  tabs.forEach((btn) =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.chart
      tabs.forEach((b) => {
        const on = b === btn
        b.classList.toggle('is-active', on)
        b.setAttribute('aria-selected', String(on))
      })
      $$('.chart-panel').forEach((p) => {
        p.hidden = p.id !== `chart-${key}`
      })
    })
  )
}

/* ---------------------------- review form ------------------------------ */
function initReviewForm() {
  const form = $('#review-form')
  if (!form) return
  const hidden = $('#review-rating')
  const picker = $('#star-picker')

  const paint = (val) => {
    $$('.star-pick', picker).forEach((b) => {
      const on = Number(b.dataset.value) <= val
      b.classList.toggle('is-on', on)
      b.querySelector('i').className = on ? 'fa-solid fa-star' : 'fa-regular fa-star'
    })
  }

  if (picker) {
    $$('.star-pick', picker).forEach((btn) => {
      btn.addEventListener('click', () => {
        hidden.value = btn.dataset.value
        paint(Number(btn.dataset.value))
      })
      btn.addEventListener('mouseenter', () => paint(Number(btn.dataset.value)))
    })
    picker.addEventListener('mouseleave', () => paint(Number(hidden.value) || 0))
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!Session.token()) {
      toast('Sign in to post a review.', 'warn', 'Not signed in')
      setTimeout(() => (location.href = `/auth/login?next=${encodeURIComponent(location.pathname)}`), 900)
      return
    }
    const rating = Number(hidden.value) || 0
    if (rating < 1) return toast('Pick a star rating first.', 'warn')

    const fd = new FormData(form)
    const btn = form.querySelector('button[type="submit"]')
    btn.disabled = true
    const label = btn.innerHTML
    btn.innerHTML = '<span class="spinner spinner-xs"></span> Posting…'

    const { ok, data } = await api(`/api/apps/${encodeURIComponent(form.dataset.appId)}/reviews`, {
      method: 'POST',
      auth: true,
      body: {
        rating,
        title: String(fd.get('title') || '').trim(),
        review_text: String(fd.get('review_text') || '').trim(),
      },
    })

    btn.disabled = false
    btn.innerHTML = label

    if (!ok || !data?.success) {
      toast(data?.hint || data?.error || 'Could not post your review.', 'error', 'Review failed')
      return
    }
    toast('Thanks — your review is live!', 'success', 'Review posted')
    const list = $('#reviews-list')
    if (list) {
      const muted = list.querySelector('.muted')
      if (muted) muted.remove()
      const art = document.createElement('article')
      art.className = 'review is-new'
      art.innerHTML = `<header>${starHtml(rating)} <strong>${escHtml(fd.get('title') || 'Review')}</strong>
        <time>${new Date().toLocaleDateString()}</time></header>
        <p>${escHtml(fd.get('review_text') || '')}</p>`
      list.prepend(art)
    }
    form.reset()
    hidden.value = '0'
    paint(0)
    form.closest('details')?.removeAttribute('open')
  })
}

/* ------------------------------ auth pages ----------------------------- */
function initAuthPage(mode) {
  const form = $('#auth-form')
  if (!form) return
  const alertBox = $('#auth-alert')
  const next = BOOT.next || ''

  const say = (msg, kind = 'error') => {
    if (!alertBox) return toast(msg, kind)
    alertBox.hidden = false
    alertBox.className = `auth-alert is-${kind}`
    alertBox.textContent = msg
  }

  // password visibility
  $$('.password-toggle', form).forEach((btn) =>
    btn.addEventListener('click', () => {
      const input = btn.closest('.password-wrap')?.querySelector('input')
      if (!input) return
      const show = input.type === 'password'
      input.type = show ? 'text' : 'password'
      btn.querySelector('i').className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password')
    })
  )

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (alertBox) alertBox.hidden = true
    const fd = new FormData(form)
    const email = String(fd.get('email') || '').trim()
    const password = String(fd.get('password') || '')
    const submit = form.querySelector('button[type="submit"]')
    const label = submit.innerHTML
    submit.disabled = true
    submit.innerHTML = '<span class="spinner spinner-xs"></span> Working…'

    const restore = () => {
      submit.disabled = false
      submit.innerHTML = label
    }

    if (mode === 'reset') {
      const { ok, data } = await api('/api/auth/reset-password', { method: 'POST', body: { email } })
      restore()
      if (!ok || !data?.success) return say(data?.error || 'Could not send the reset email.')
      say('Reset link sent — check your inbox.', 'success')
      return
    }

    const path = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login'
    const body = { email, password }
    if (mode === 'signup') body.developer_name = String(fd.get('developer_name') || '').trim()

    const { ok, data } = await api(path, { method: 'POST', body })
    restore()

    if (!ok || !data?.success) {
      let msg = data?.error || 'Something went wrong.'
      if (/email not confirmed|email_not_confirmed/i.test(msg)) {
        msg = 'Your email is not confirmed yet. Open the confirmation link we emailed you, then sign in.'
      } else if (/invalid login credentials/i.test(msg)) {
        msg = 'Wrong email or password. If you just signed up, confirm your email first.'
      }
      return say(msg)
    }

    if (mode === 'signup' && data.needs_confirmation) {
      say(data.message || 'Account created. Confirm your email address, then sign in.', 'success')
      form.reset()
      return
    }

    if (data.session?.access_token) {
      Session.set(data.session)
      say(mode === 'signup' ? 'Account created — taking you to your console…' : 'Signed in — redirecting…', 'success')
      setTimeout(() => (location.href = next || '/developer'), 650)
    } else {
      say('Signed in, but no session was returned. Please try signing in again.', 'warn')
    }
  })

  // magic link
  $('#magic-link-btn')?.addEventListener('click', async () => {
    const email = String(new FormData(form).get('email') || '').trim()
    if (!email) return say('Enter your email address first, then request a link.', 'warn')
    const btn = $('#magic-link-btn')
    btn.disabled = true
    const { ok, data } = await api('/api/auth/magic-link', { method: 'POST', body: { email } })
    btn.disabled = false
    if (!ok || !data?.success) return say(data?.error || 'Could not send the sign-in link.')
    say(data.message || 'Sign-in link sent — check your inbox.', 'success')
  })
}

/* ==================== DEVELOPER CONSOLE ==================== */

/** Resolve auth for a console page. Returns `me` or null (gate shown). */
async function devGate() {
  const loading = $('#auth-loading')
  const gate = $('#auth-gate')
  const content = $('#dev-content')

  const showGate = () => {
    if (loading) loading.hidden = true
    if (gate) {
      gate.hidden = false
      const link = gate.querySelector('[data-next-link]')
      if (link) link.href = `/auth/login?next=${encodeURIComponent(location.pathname)}`
    }
    if (content) content.hidden = true
  }

  if (!Session.token()) {
    showGate()
    return null
  }
  const me = await whoami()
  if (!me) {
    Session.clear()
    showGate()
    return null
  }
  if (loading) loading.hidden = true
  if (gate) gate.hidden = true
  if (content) content.hidden = false
  return me
}

/** Banner prompting profile creation when the developer row is missing. */
function profileBanner(me) {
  const slot = $('#profile-banner-slot')
  if (!slot) return
  if (me.developer) {
    slot.innerHTML = ''
    return
  }
  slot.innerHTML = `<div class="banner banner-warn">
    <i class="fa-solid fa-triangle-exclamation"></i>
    <div>
      <strong>Finish your developer profile</strong>
      <p>Add a studio name before publishing your first app.</p>
    </div>
    <a class="btn btn-primary btn-sm" href="/developer/profile"><i class="fa-solid fa-id-badge"></i> Create profile</a>
  </div>`
}

/** One row in the developer app lists. */
function devAppRow(a, compact = false) {
  const published = a.status === 'published'
  return `<article class="dev-app-row" data-id="${escHtml(a.id)}" data-status="${escHtml(a.status)}" data-name="${escHtml(String(a.name).toLowerCase())}">
    ${
      a.icon_url
        ? `<img class="app-icon" src="${escHtml(a.icon_url)}" alt="" loading="lazy" />`
        : `<span class="app-icon app-icon-fallback">${escHtml(initials(a.name))}</span>`
    }
    <div class="dev-app-main">
      <h3>${escHtml(a.name)}
        <span class="status-dot ${published ? 'is-live' : 'is-draft'}">${published ? 'Published' : 'Draft'}</span>
      </h3>
      <p>${escHtml(a.short_description || a.category)}</p>
      <div class="dev-app-meta">
        <span><i class="fa-solid fa-tag"></i> ${escHtml(a.category)}</span>
        <span><i class="fa-solid fa-code-branch"></i> v${escHtml(a.version)}</span>
        <span><i class="fa-solid fa-download"></i> ${fmt(a.downloads)}</span>
        <span>${a.rating > 0 ? starHtml(a.rating) + ' ' + Number(a.rating).toFixed(1) : '<em class="muted">No ratings</em>'}</span>
        <span class="price ${a.is_free ? 'is-free' : ''}">${a.is_free ? 'Free' : '$' + Number(a.price).toFixed(2)}</span>
      </div>
    </div>
    <div class="dev-app-actions">
      ${published ? `<a class="btn btn-ghost btn-sm" href="/app/${escHtml(a.slug)}" target="_blank" rel="noopener" title="View in store"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>` : ''}
      ${
        compact
          ? `<a class="btn btn-outline btn-sm" href="/developer/apps"><i class="fa-solid fa-pen-to-square"></i></a>`
          : `<button class="btn btn-outline btn-sm js-edit" type="button" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
             <button class="btn btn-ghost btn-sm js-toggle" type="button" title="${published ? 'Unpublish' : 'Publish'}">
               <i class="fa-solid ${published ? 'fa-eye-slash' : 'fa-rocket'}"></i>
             </button>
             <button class="btn btn-danger btn-sm js-delete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>`
      }
    </div>
  </article>`
}

/* --------------------------- dev dashboard ----------------------------- */
async function initDevDashboard() {
  const me = await devGate()
  if (!me) return
  profileBanner(me)

  const greet = $('#dev-greeting')
  if (greet) {
    const name = me.developer?.developer_name || me.user?.metadata?.developer_name
    greet.textContent = name ? `Welcome back, ${name}` : 'Dashboard'
  }
  const sub = $('#dev-subtitle')
  if (sub && me.user?.email) sub.textContent = `Signed in as ${me.user.email}`

  const { ok, data } = await api('/api/developer/apps', { auth: true })
  const list = $('#dev-app-list')

  if (!ok || !data?.success) {
    if (list) list.innerHTML = `<div class="banner banner-error"><i class="fa-solid fa-circle-exclamation"></i><div><strong>Could not load your apps</strong><p>${escHtml(data?.error || 'Unknown error')}</p></div></div>`
    return
  }

  const s = data.stats || {}
  const set = (id, v) => {
    const el = $(id)
    if (el) el.textContent = v
  }
  set('#m-total', s.total_apps ?? 0)
  set('#m-published', s.published ?? 0)
  set('#m-drafts', s.drafts ?? 0)
  set('#m-downloads', fmt(s.total_downloads))
  set('#m-rating', s.avg_rating ? Number(s.avg_rating).toFixed(1) : '—')

  if (list) {
    const apps = data.apps || []
    list.innerHTML = apps.length
      ? apps.slice(0, 6).map((a) => devAppRow(a, true)).join('')
      : `<div class="empty-state empty-state-sm">
          <span class="empty-icon"><i class="fa-solid fa-cube"></i></span>
          <h3>No apps yet</h3>
          <p>Publish your first listing and it appears in the store instantly.</p>
          <a class="btn btn-primary" href="/developer/submit"><i class="fa-solid fa-plus"></i> Submit your first app</a>
        </div>`
  }
}

/* ------------------------------ my apps -------------------------------- */
async function initDevApps() {
  const me = await devGate()
  if (!me) return
  profileBanner(me)

  const list = $('#manage-list')
  const dialog = $('#edit-dialog')
  const editForm = $('#edit-form')
  let apps = []
  let filter = 'all'
  let query = ''

  const render = () => {
    const shown = apps.filter(
      (a) =>
        (filter === 'all' || (filter === 'published' ? a.status === 'published' : a.status !== 'published')) &&
        (!query || String(a.name).toLowerCase().includes(query) || String(a.category).toLowerCase().includes(query))
    )
    list.innerHTML = shown.length
      ? shown.map((a) => devAppRow(a)).join('')
      : `<div class="empty-state empty-state-sm">
          <span class="empty-icon"><i class="fa-solid fa-magnifying-glass"></i></span>
          <h3>${apps.length ? 'Nothing matches that filter' : 'No apps yet'}</h3>
          <p>${apps.length ? 'Try a different tab or clear the search.' : 'Create your first listing to get started.'}</p>
          ${apps.length ? '' : '<a class="btn btn-primary" href="/developer/submit"><i class="fa-solid fa-plus"></i> Submit an app</a>'}
        </div>`
  }

  const load = async () => {
    const { ok, data } = await api('/api/developer/apps', { auth: true })
    if (!ok || !data?.success) {
      list.innerHTML = `<div class="banner banner-error"><i class="fa-solid fa-circle-exclamation"></i><div><strong>Could not load your apps</strong><p>${escHtml(data?.error || 'Unknown error')}</p></div></div>`
      return
    }
    apps = data.apps || []
    render()
  }

  await load()

  $$('.tab-btn[data-status]').forEach((btn) =>
    btn.addEventListener('click', () => {
      $$('.tab-btn[data-status]').forEach((b) => b.classList.toggle('is-active', b === btn))
      filter = btn.dataset.status
      render()
    })
  )

  $('#manage-search')?.addEventListener(
    'input',
    debounce((e) => {
      query = e.target.value.trim().toLowerCase()
      render()
    }, 160)
  )

  // Pricing field visibility inside the edit dialog
  const editIsFree = $('#edit-is-free')
  const editPriceField = $('#edit-price-field')
  const syncEditPrice = () => {
    if (editPriceField) editPriceField.hidden = editIsFree?.value !== 'false'
  }
  editIsFree?.addEventListener('change', syncEditPrice)

  $$('[data-close-dialog]', dialog || document).forEach((b) => b.addEventListener('click', () => dialog?.close()))

  // Row actions
  list.addEventListener('click', async (e) => {
    const row = e.target.closest('.dev-app-row')
    if (!row) return
    const id = row.dataset.id
    const app = apps.find((a) => String(a.id) === id)
    if (!app) return

    if (e.target.closest('.js-edit')) {
      editForm.elements.id.value = app.id
      editForm.elements.app_name.value = app.name || ''
      editForm.elements.category.value = app.category || 'Other'
      editForm.elements.description.value = app.description || ''
      editForm.elements.version.value = app.version || ''
      editForm.elements.icon_url.value = app.icon_url || ''
      editForm.elements.download_url.value = app.download_url || ''
      editForm.elements.website.value = app.website || ''
      editForm.elements.support_email.value = app.support_email || ''
      editForm.elements.is_free.value = app.is_free ? 'true' : 'false'
      editForm.elements.price.value = app.price ?? 0
      editForm.elements.status.value = app.status === 'published' ? 'published' : 'draft'
      syncEditPrice()
      dialog?.showModal()
      return
    }

    if (e.target.closest('.js-toggle')) {
      const next = app.status === 'published' ? 'draft' : 'published'
      const { ok, data } = await api(`/api/developer/apps/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        auth: true,
        body: { status: next },
      })
      if (!ok || !data?.success) return toast(data?.hint || data?.error || 'Update failed.', 'error')
      toast(next === 'published' ? `${app.name} is live in the store.` : `${app.name} moved to drafts.`, 'success')
      await load()
      return
    }

    if (e.target.closest('.js-delete')) {
      if (!confirm(`Delete “${app.name}”? This cannot be undone.`)) return
      const { ok, data } = await api(`/api/developer/apps/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true })
      if (!ok || !data?.success) return toast(data?.error || 'Delete failed.', 'error')
      toast(`${app.name} deleted.`, 'success')
      await load()
    }
  })

  // Save from the edit dialog
  editForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(editForm)
    const id = String(fd.get('id'))
    const isFree = fd.get('is_free') === 'true'
    const body = {
      app_name: String(fd.get('app_name') || '').trim(),
      category: fd.get('category'),
      description: String(fd.get('description') || '').trim(),
      version: String(fd.get('version') || '').trim(),
      icon_url: String(fd.get('icon_url') || '').trim(),
      download_url: String(fd.get('download_url') || '').trim(),
      website: String(fd.get('website') || '').trim(),
      support_email: String(fd.get('support_email') || '').trim(),
      is_free: isFree,
      price: isFree ? 0 : Number(fd.get('price')) || 0,
      status: fd.get('status'),
    }
    const btn = editForm.querySelector('button[type="submit"]')
    btn.disabled = true
    const { ok, data } = await api(`/api/developer/apps/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      auth: true,
      body,
    })
    btn.disabled = false
    if (!ok || !data?.success) return toast(data?.hint || data?.error || 'Could not save changes.', 'error', 'Save failed')
    dialog?.close()
    toast('Changes saved.', 'success')
    await load()
  })
}

/* ------------------------------- submit -------------------------------- */
const CAT_COLORS = {
  Games: '#ef4444',
  Productivity: '#3b82f6',
  Social: '#8b5cf6',
  Entertainment: '#ec4899',
  Education: '#f59e0b',
  Business: '#0ea5e9',
  Finance: '#22c55e',
  Health: '#14b8a6',
  Travel: '#06b6d4',
  Photography: '#a855f7',
  Music: '#f43f5e',
  News: '#64748b',
  Shopping: '#eab308',
  Sports: '#84cc16',
  Utilities: '#6366f1',
  Other: '#6366f1',
}

async function initDevSubmit() {
  const me = await devGate()
  if (!me) return
  profileBanner(me)

  const form = $('#submit-form')
  if (!form) return

  const devName = me.developer?.developer_name || me.user?.metadata?.developer_name || 'Your studio'
  const pvDev = $('#pv-dev')
  if (pvDev) pvDev.textContent = devName

  const isFree = $('#submit-is-free')
  const priceField = $('#submit-price-field')
  const syncPrice = () => {
    if (priceField) priceField.hidden = isFree?.value !== 'false'
  }
  isFree?.addEventListener('change', () => {
    syncPrice()
    paintPreview()
  })
  syncPrice()

  function paintPreview() {
    const fd = new FormData(form)
    const name = String(fd.get('app_name') || '').trim() || 'My Awesome App'
    const desc = String(fd.get('description') || '').trim() || 'Your description preview appears here as you type.'
    const cat = String(fd.get('category') || 'Productivity')
    const free = fd.get('is_free') === 'true'
    const price = Number(fd.get('price')) || 0
    const icon = String(fd.get('icon_url') || '').trim()
    const color = CAT_COLORS[cat] || CAT_COLORS.Other

    const nameEl = $('#pv-name')
    if (nameEl) nameEl.textContent = name
    const descEl = $('#pv-desc')
    if (descEl) descEl.textContent = desc.replace(/[#*`_>]/g, '').slice(0, 160)
    const catEl = $('#pv-cat')
    if (catEl) {
      catEl.textContent = cat
      catEl.style.setProperty('--cat-color', color)
    }
    const priceEl = $('#pv-price')
    if (priceEl) {
      priceEl.textContent = free ? 'Free' : `$${price.toFixed(2)}`
      priceEl.classList.toggle('is-free', free)
    }
    const banner = $('#live-preview .app-card-banner')
    if (banner) banner.style.setProperty('--cat-color', color)

    const iconEl = $('#pv-icon')
    if (iconEl) {
      if (icon) {
        if (iconEl.tagName !== 'IMG') {
          const img = document.createElement('img')
          img.className = 'app-icon'
          img.id = 'pv-icon'
          img.alt = ''
          iconEl.replaceWith(img)
        }
        $('#pv-icon').src = icon
      } else {
        if (iconEl.tagName === 'IMG') {
          const span = document.createElement('span')
          span.className = 'app-icon app-icon-fallback'
          span.id = 'pv-icon'
          iconEl.replaceWith(span)
        }
        $('#pv-icon').textContent = initials(name)
      }
    }
  }

  form.addEventListener('input', debounce(paintPreview, 120))
  form.addEventListener('change', paintPreview)
  paintPreview()

  // Which submit button was pressed decides draft vs published
  let intent = 'draft'
  $$('button[name="intent"]', form).forEach((b) =>
    b.addEventListener('click', () => {
      intent = b.value
    })
  )

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!me.developer) {
      toast('Create your developer profile before submitting an app.', 'warn', 'Profile required')
      setTimeout(() => (location.href = '/developer/profile'), 1200)
      return
    }
    const fd = new FormData(form)
    const free = fd.get('is_free') === 'true'
    const screenshots = String(fd.get('screenshots') || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)

    const body = {
      app_name: String(fd.get('app_name') || '').trim(),
      app_slug: String(fd.get('app_slug') || '').trim(),
      description: String(fd.get('description') || '').trim(),
      category: fd.get('category') || 'Other',
      version: String(fd.get('version') || '1.0.0').trim(),
      icon_url: String(fd.get('icon_url') || '').trim(),
      download_url: String(fd.get('download_url') || '').trim(),
      website: String(fd.get('website') || '').trim(),
      support_email: String(fd.get('support_email') || '').trim(),
      is_free: free,
      price: free ? 0 : Number(fd.get('price')) || 0,
      screenshots,
      status: intent === 'published' ? 'published' : 'draft',
    }

    const buttons = $$('button[type="submit"]', form)
    buttons.forEach((b) => (b.disabled = true))
    const { ok, data } = await api('/api/developer/apps', { method: 'POST', auth: true, body })
    buttons.forEach((b) => (b.disabled = false))

    if (!ok || !data?.success) {
      toast(data?.hint || data?.error || 'Could not create the app.', 'error', 'Submission failed')
      return
    }
    toast(
      body.status === 'published' ? `${body.app_name} is live in the store!` : `${body.app_name} saved as a draft.`,
      'success',
      'App created'
    )
    setTimeout(() => (location.href = '/developer/apps'), 900)
  })
}

/* ------------------------------- profile ------------------------------- */
async function initDevProfile() {
  const me = await devGate()
  if (!me) return

  const form = $('#profile-form')
  const status = $('#profile-status')
  const set = (id, v) => {
    const el = $(id)
    if (el) el.textContent = v
  }

  set('#acct-email', me.user?.email || '—')
  set('#acct-id', me.user?.id || '—')
  set('#acct-verified', me.user?.email_confirmed_at ? 'Yes' : 'Not confirmed')
  set('#acct-dev-id', me.developer?.developer_id || 'Not registered')
  set('#acct-dev-status', me.developer ? (me.developer.verified ? 'Verified developer' : 'Registered') : 'No profile yet')

  const publicLink = $('#view-public-profile')
  if (publicLink && me.developer?.id) publicLink.href = `/developer-profile/${me.developer.id}`

  if (form && me.developer) {
    const d = me.developer
    form.elements.developer_name.value = d.developer_name || ''
    form.elements.company_name.value = d.company_name || ''
    form.elements.description.value = d.description || ''
    form.elements.website.value = d.website || ''
    form.elements.email.value = d.email || me.user?.email || ''
    form.elements.phone.value = d.phone || ''
    form.elements.logo_url.value = d.logo_url || ''
  } else if (form) {
    form.elements.developer_name.value = me.user?.metadata?.developer_name || ''
    form.elements.email.value = me.user?.email || ''
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const body = {
      developer_name: String(fd.get('developer_name') || '').trim(),
      company_name: String(fd.get('company_name') || '').trim(),
      description: String(fd.get('description') || '').trim(),
      website: String(fd.get('website') || '').trim(),
      email: String(fd.get('email') || '').trim(),
      phone: String(fd.get('phone') || '').trim(),
      logo_url: String(fd.get('logo_url') || '').trim(),
    }
    if (!body.developer_name) return toast('A developer / studio name is required.', 'warn')

    const btn = form.querySelector('button[type="submit"]')
    btn.disabled = true
    const { ok, data } = await api('/api/developer/register', { method: 'POST', auth: true, body })
    btn.disabled = false

    if (!ok || !data?.success) {
      const msg = data?.hint || data?.error || 'Could not save your profile.'
      if (status) {
        status.textContent = msg
        status.className = 'form-note is-error'
      }
      toast(msg, 'error', 'Save failed')
      return
    }
    if (status) {
      status.textContent = data.created ? 'Developer profile created.' : 'Profile updated.'
      status.className = 'form-note is-success'
    }
    toast(data.created ? 'Developer profile created!' : 'Profile updated.', 'success')
    ME_CACHE = null
    const fresh = await whoami(true)
    if (fresh?.developer) {
      set('#acct-dev-id', fresh.developer.developer_id || '—')
      set('#acct-dev-status', fresh.developer.verified ? 'Verified developer' : 'Registered')
      if (publicLink) publicLink.href = `/developer-profile/${fresh.developer.id}`
    }
  })

  $('#logout-btn')?.addEventListener('click', doLogout)
}

/* --------------------------------- docs -------------------------------- */
function initDocs() {
  // Scroll-spy for the docs side nav
  const links = $$('.docs-nav a')
  if (!links.length) return
  const targets = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean)
  if (!('IntersectionObserver' in window) || !targets.length) return
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return
        links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${en.target.id}`))
      })
    },
    { rootMargin: '-96px 0px -70% 0px' }
  )
  targets.forEach((t) => io.observe(t))
}

/* ------------------------------ bootstrap ------------------------------ */
function boot() {
  initTheme()
  initNav()
  initSearch()
  initGetButtons()
  initAccount()

  switch (BOOT.page) {
    case 'browse':
      initBrowse()
      break
    case 'charts':
      initCharts()
      break
    case 'app':
      initReviewForm()
      break
    case 'auth-login':
      initAuthPage('login')
      break
    case 'auth-signup':
      initAuthPage('signup')
      break
    case 'auth-reset':
      initAuthPage('reset')
      break
    case 'dev-dashboard':
      initDevDashboard()
      break
    case 'dev-apps':
      initDevApps()
      break
    case 'dev-submit':
      initDevSubmit()
      break
    case 'dev-profile':
      initDevProfile()
      break
    case 'dev-docs':
      initDocs()
      break
    default:
      break
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}
