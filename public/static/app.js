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

/**
 * Client-side twin of src/lib/media.js. The server rewrites share links when it
 * stores/reads them; this copy exists purely so the *live preview* on the submit
 * form shows the real image the moment a Drive link is pasted.
 */
function driveId(url) {
  if (!url) return null
  const s = String(url).trim()
  if (!/(?:drive|docs)\.google\.com|drive\.usercontent\.google\.com/i.test(s)) return null
  let m = /\/(?:file|document|presentation|spreadsheets)\/d\/([A-Za-z0-9_-]{10,})/.exec(s)
  if (m) return m[1]
  m = /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s)
  if (m) return m[1]
  m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(s)
  return m ? m[1] : null
}

function directImage(url, width = 1600) {
  if (!url) return ''
  const s = String(url).trim()
  const id = driveId(s)
  if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w${width}`
  if (/^https?:\/\/(www\.)?dropbox\.com\//i.test(s)) {
    return s.replace(/[?&](dl|raw)=\d/g, '') + (s.includes('?') ? '&raw=1' : '?raw=1')
  }
  if (/^https?:\/\/github\.com\/.+\/blob\//i.test(s)) {
    return s.replace('//github.com/', '//raw.githubusercontent.com/').replace('/blob/', '/')
  }
  return /^https?:\/\//i.test(s) ? s : ''
}

function isDrive(url) {
  return !!driveId(url)
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
      // A version-history row links to that exact build, so it must win over
      // the app-level "latest" URL the API hands back.
      const url = get.dataset.exact ? fallback || (ok && data?.url) : (ok && data?.url) || fallback
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
  let startTfa = null

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

    // Password was right but the account is 2FA-protected: hand over to the
    // code form with the sealed challenge instead of storing a session.
    if (data.requires_2fa && data.challenge) {
      if (alertBox) alertBox.hidden = true
      if (startTfa) return startTfa(data.challenge, data.message)
      return say('Two-factor authentication is required, but the code form failed to load. Reload the page.', 'warn')
    }

    if (data.session?.access_token) {
      Session.set(data.session)
      say(mode === 'signup' ? 'Account created — taking you to your console…' : 'Signed in — redirecting…', 'success')
      setTimeout(() => (location.href = next || '/developer'), 650)
    } else {
      say('Signed in, but no session was returned. Please try signing in again.', 'warn')
    }
  })

  startTfa = initTfa(next)
}

/* ------------------------ shared 6-digit code boxes ---------------------- */
/**
 * Turn a row of single-character inputs into one keyboard-friendly field:
 * typing advances, backspace retreats, arrows move, and a pasted code spreads
 * itself across every box. `onComplete` fires once all boxes are filled.
 */
function wireDigits(container, onComplete) {
  const boxes = $$('.otp-box', container)
  if (!boxes.length) return { boxes, value: () => '', clear: () => {}, focus: () => {} }

  const value = () => boxes.map((b) => b.value.trim()).join('')
  const clear = () => boxes.forEach((b) => (b.value = ''))
  const focus = () => boxes[0]?.focus()

  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      const digits = box.value.replace(/\D/g, '')
      if (digits.length > 1) {
        digits.split('').forEach((d, k) => {
          if (boxes[i + k]) boxes[i + k].value = d
        })
        boxes[Math.min(i + digits.length, boxes.length - 1)].focus()
      } else {
        box.value = digits
        if (digits && boxes[i + 1]) boxes[i + 1].focus()
      }
      if (value().length === boxes.length) onComplete?.(value())
    })
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && boxes[i - 1]) {
        boxes[i - 1].focus()
        boxes[i - 1].value = ''
        e.preventDefault()
      }
      if (e.key === 'ArrowLeft' && boxes[i - 1]) boxes[i - 1].focus()
      if (e.key === 'ArrowRight' && boxes[i + 1]) boxes[i + 1].focus()
    })
  })

  return { boxes, value, clear, focus }
}

/* ------------------- two-factor step of the sign-in flow ---------------- */
/**
 * Second half of a 2FA-gated login. The password step returns a sealed
 * `challenge` instead of a session; this form trades that challenge plus a
 * TOTP (or single-use backup) code for the real session.
 * Returns the function that reveals it, or null when the form is absent.
 */
function initTfa(next) {
  const pwForm = $('#auth-form')
  const form = $('#tfa-form')
  if (!form || !pwForm) return null

  const alertBox = $('#tfa-alert')
  const challengeInput = $('#tfa-challenge')
  const hidden = $('#tfa-code')
  const backupField = $('#tfa-backup-field')
  const backupInput = $('#tfa-backup-input')
  const digitWrap = $('#tfa-inputs')

  const say = (msg, kind = 'error') => {
    if (!alertBox) return toast(msg, kind)
    alertBox.hidden = false
    alertBox.className = `auth-alert is-${kind}`
    alertBox.textContent = msg
  }

  const digits = wireDigits(digitWrap, () => {
    if (hidden) hidden.value = digits.value()
    form.requestSubmit()
  })

  let usingBackup = false
  const setBackupMode = (on) => {
    usingBackup = on
    if (backupField) backupField.hidden = !on
    if (digitWrap) digitWrap.hidden = on
    const btn = $('#tfa-backup')
    if (btn) {
      btn.innerHTML = on
        ? '<i class="fa-solid fa-mobile-screen-button"></i> Use my authenticator app'
        : '<i class="fa-solid fa-key"></i> Use a backup code'
    }
    if (on) backupInput?.focus()
    else digits.focus()
  }

  $('#tfa-backup')?.addEventListener('click', () => setBackupMode(!usingBackup))

  $('#tfa-cancel')?.addEventListener('click', () => {
    form.hidden = true
    pwForm.hidden = false
    digits.clear()
    if (backupInput) backupInput.value = ''
    if (alertBox) alertBox.hidden = true
    setBackupMode(false)
    pwForm.elements.password?.focus()
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const challenge = challengeInput?.value || ''
    const code = usingBackup ? String(backupInput?.value || '').trim() : digits.value()
    if (!challenge) return say('This sign-in attempt expired. Start again.')
    if (!code || (!usingBackup && code.length < 6)) {
      return say(usingBackup ? 'Enter one of your backup codes.' : 'Enter all six digits.', 'warn')
    }

    const btn = $('#tfa-verify')
    const label = btn.innerHTML
    btn.disabled = true
    btn.innerHTML = '<span class="spinner spinner-xs"></span> Verifying…'

    const { ok, data } = await api('/api/auth/2fa/verify', { method: 'POST', body: { challenge, code } })
    btn.disabled = false
    btn.innerHTML = label

    if (!ok || !data?.success) {
      digits.clear()
      digits.focus()
      return say(data?.error || 'That code was not accepted.')
    }
    if (!data.session?.access_token) return say('Verified, but no session came back. Try again.', 'warn')

    Session.set(data.session)
    if (data.used_backup_code) {
      toast(`Backup code used — ${data.backup_codes_left ?? 0} left.`, 'warn', 'Backup code')
    }
    say('Verified — taking you to your console…', 'success')
    setTimeout(() => (location.href = next || '/developer'), 600)
  })

  return (challenge, message) => {
    if (challengeInput) challengeInput.value = challenge || ''
    pwForm.hidden = true
    form.hidden = false
    setBackupMode(false)
    digits.clear()
    if (message) say(message, 'info')
    digits.focus()
  }
}

/* ---------------------- Google OAuth return handler --------------------- */
/**
 * Lands here after Supabase finishes the Google handshake. Supabase either
 * drops tokens in the URL fragment (implicit) or a `?code=` we exchange
 * server-side (PKCE). Either way we store the session and move on.
 */
async function initAuthCallback() {
  const note = $('#callback-note')
  const state = $('#callback-state')
  const alertBox = $('#callback-alert')
  const next = BOOT.next || '/developer'

  const fail = (msg) => {
    if (state) {
      state.innerHTML = `<span class="callback-spinner is-error"><i class="fa-solid fa-circle-exclamation"></i></span>
        <h1>Sign-in did not complete</h1>
        <p class="auth-sub">${escHtml(msg)}</p>
        <a class="btn btn-primary" href="/auth/login"><i class="fa-solid fa-right-to-bracket"></i> Back to sign in</a>`
    }
    if (alertBox) {
      alertBox.hidden = false
      alertBox.className = 'auth-alert is-error'
      alertBox.textContent = msg
    }
  }

  const done = () => {
    if (state) {
      state.innerHTML = `<span class="callback-spinner is-ok"><i class="fa-solid fa-circle-check"></i></span>
        <h1>You are signed in</h1>
        <p class="auth-sub">Taking you to your console…</p>`
    }
    setTimeout(() => (location.href = next), 500)
  }

  const hash = new URLSearchParams(location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(location.search)

  const errDesc = hash.get('error_description') || query.get('error_description') || hash.get('error') || query.get('error')
  if (errDesc) return fail(decodeURIComponent(errDesc.replace(/\+/g, ' ')))

  const accessToken = hash.get('access_token')
  if (accessToken) {
    Session.set({
      access_token: accessToken,
      refresh_token: hash.get('refresh_token') || '',
      expires_in: Number(hash.get('expires_in') || 3600),
      token_type: hash.get('token_type') || 'bearer'
    })
    history.replaceState(null, '', location.pathname + location.search)
    const me = await whoami(true)
    if (!me) return fail('Signed in with Google, but the session was rejected. Try again.')
    return done()
  }

  const code = query.get('code')
  if (code) {
    if (note) note.textContent = 'Exchanging your Google authorization…'
    const { ok, data } = await api('/api/auth/oauth/exchange', { method: 'POST', body: { code } })
    if (!ok || !data?.success || !data.session?.access_token) {
      return fail(data?.error || 'Google sign-in could not be completed.')
    }
    Session.set(data.session)
    return done()
  }

  if (Session.token()) return done()
  fail('No sign-in details came back from Google. Please start again.')
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

/**
 * Reflect real progress on the 1-2-3 stepper: the profile step is only "done"
 * once a developers row exists, and the submit step only once an app exists.
 */
function paintStepper(me, appCount) {
  const stepper = $('#dev-stepper')
  if (!stepper) return
  const hasProfile = !!me?.developer
  const mark = (name, done, blocked) => {
    const li = stepper.querySelector(`[data-step="${name}"]`)
    if (!li) return
    li.classList.toggle('is-done', !!done)
    li.classList.toggle('is-blocked', !!blocked)
    const num = li.querySelector('.step-num')
    if (num) num.innerHTML = done ? '<i class="fa-solid fa-check"></i>' : num.dataset.n || num.textContent
  }
  $$('.step-num', stepper).forEach((n) => {
    if (!n.dataset.n) n.dataset.n = n.textContent.trim()
  })
  mark('profile', hasProfile, false)
  mark('submit', hasProfile && appCount > 0, !hasProfile)
  mark('update', appCount > 0, !hasProfile || !appCount)
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
          : `<button class="btn btn-outline btn-sm js-edit" type="button" title="Edit listing"><i class="fa-solid fa-pen-to-square"></i></button>
             <button class="btn btn-primary btn-sm js-release" type="button" title="Ship an update"><i class="fa-solid fa-rocket"></i> Update</button>
             <button class="btn btn-ghost btn-sm js-toggle" type="button" title="${published ? 'Unpublish' : 'Publish'}">
               <i class="fa-solid ${published ? 'fa-eye-slash' : 'fa-cloud-arrow-up'}"></i>
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
  paintStepper(me, (data?.apps || []).length)

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
  const releaseDialog = $('#release-dialog')
  const releaseForm = $('#release-form')
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
    paintStepper(me, apps.length)
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
  $$('[data-close-dialog]', releaseDialog || document).forEach((b) =>
    b.addEventListener('click', () => releaseDialog?.close())
  )

  /* ------------------- app update (release) handling -------------------- */

  const bumpPatch = (v) => {
    const parts = String(v || '1.0.0').split('.')
    while (parts.length < 3) parts.push('0')
    const last = parseInt(parts[parts.length - 1], 10)
    parts[parts.length - 1] = String((Number.isNaN(last) ? 0 : last) + 1)
    return parts.join('.')
  }

  const versionItem = (v, i) => {
    const when = v.released_at || v.release_date || v.created_at
    const num = v.version || v.version_number
    return `<li class="version-item${i === 0 ? ' is-latest' : ''}">
      <div class="version-head">
        <strong>v${escHtml(num)}</strong>
        ${i === 0 ? '<span class="pill pill-free">Latest</span>' : ''}
        ${when ? `<time>${new Date(when).toLocaleDateString()}</time>` : ''}
      </div>
      ${v.release_notes ? `<p class="version-notes">${escHtml(v.release_notes)}</p>` : '<p class="version-notes muted">No release notes.</p>'}
    </li>`
  }

  const loadHistory = async (appId) => {
    const box = $('#release-history')
    if (!box) return
    box.innerHTML = '<p class="muted">Loading…</p>'
    const { ok, data } = await api(`/api/developer/apps/${encodeURIComponent(appId)}/versions`, { auth: true })
    const versions = (ok && data?.versions) || []
    box.innerHTML = versions.length
      ? versions.map(versionItem).join('')
      : '<p class="muted">No releases recorded yet. Publishing this update creates the first entry.</p>'
  }

  const openRelease = async (app) => {
    if (!releaseForm || !releaseDialog) return
    releaseForm.reset()
    releaseForm.elements.id.value = app.id
    releaseForm.elements.version.value = bumpPatch(app.version)
    releaseForm.elements.download_url.value = app.download_url || ''
    const nameEl = $('#release-app-name')
    if (nameEl) nameEl.textContent = app.name
    const curEl = $('#release-current-version')
    if (curEl) curEl.textContent = `v${app.version || '1.0.0'}`
    releaseDialog.showModal()
    await loadHistory(app.id)
  }

  releaseForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(releaseForm)
    const id = String(fd.get('id'))
    const body = {
      version: String(fd.get('version') || '').trim(),
      min_version: String(fd.get('min_version') || '').trim() || undefined,
      release_notes: String(fd.get('release_notes') || '').trim() || undefined,
      download_url: String(fd.get('download_url') || '').trim() || undefined,
      drive_link: String(fd.get('drive_link') || '').trim() || undefined,
      file_size: fd.get('file_size') ? Number(fd.get('file_size')) : undefined,
      version_code: fd.get('version_code') ? Number(fd.get('version_code')) : undefined,
      is_auto_update: fd.get('is_auto_update') === '1',
      force_update: fd.get('force_update') === '1',
    }
    if (!body.version) return toast('A new version number is required.', 'warn')

    const btn = releaseForm.querySelector('button[type="submit"]')
    btn.disabled = true
    const { ok, data } = await api(`/api/developer/apps/${encodeURIComponent(id)}/versions`, {
      method: 'POST',
      auth: true,
      body,
    })
    btn.disabled = false

    if (!ok || !data?.success) {
      return toast(data?.hint || data?.error || 'Could not publish the update.', 'error', 'Update failed')
    }
    toast(
      `Version ${body.version} published${data.previous_version ? ` (was ${data.previous_version})` : ''}.`,
      'success',
      'Update live'
    )
    await loadHistory(id)
    releaseForm.elements.version.value = bumpPatch(body.version)
    await load()
  })

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
      editForm.elements.website_link.value = app.website_link || app.website || ''
      editForm.elements.google_drive_link.value = app.drive_share_url || ''
      editForm.elements.privacy_policy_link.value = app.privacy_policy_link || ''
      editForm.elements.change_log.value = app.change_log || ''
      editForm.elements.auto_update.value = app.auto_update === false ? 'false' : 'true'
      editForm.elements.update_available.checked = app.update_available === true
      editForm.elements.support_email.value = app.support_email || ''
      editForm.elements.is_free.value = app.is_free ? 'true' : 'false'
      editForm.elements.price.value = app.price ?? 0
      editForm.elements.status.value = app.status === 'published' ? 'published' : 'draft'
      syncEditPrice()
      dialog?.showModal()
      return
    }

    if (e.target.closest('.js-release')) {
      await openRelease(app)
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
      website_link: String(fd.get('website_link') || '').trim(),
      google_drive_link: String(fd.get('google_drive_link') || '').trim(),
      privacy_policy_link: String(fd.get('privacy_policy_link') || '').trim(),
      change_log: String(fd.get('change_log') || '').trim(),
      auto_update: fd.get('auto_update') !== 'false',
      update_available: fd.get('update_available') === '1',
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

  // Step 1 is mandatory: without a developers row the insert would be rejected
  // by RLS anyway, so show the "complete your profile" card instead of a form
  // that cannot succeed.
  const locked = $('#submit-locked')
  const stage = $('#submit-stage')
  if (!me.developer) {
    if (locked) locked.hidden = false
    if (stage) stage.hidden = true
    paintStepper(me, 0)
    return
  }
  if (locked) locked.hidden = true
  if (stage) stage.hidden = false
  paintStepper(me, 1)

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

    // Screenshot strip preview — Drive share links are rewritten so the
    // developer sees the real thumbnail before submitting.
    const shots = String(fd.get('screenshots') || '')
      .split(/\r?\n/)
      .map((s) => directImage(s.trim(), 640))
      .filter(Boolean)
    let rail = $('#pv-shots')
    if (!rail && shots.length) {
      rail = document.createElement('div')
      rail.id = 'pv-shots'
      rail.className = 'preview-shots'
      $('#live-preview')?.appendChild(rail)
    }
    if (rail) {
      rail.hidden = !shots.length
      rail.innerHTML = shots
        .slice(0, 6)
        .map((s) => `<img src="${escHtml(s)}" alt="" loading="lazy" />`)
        .join('')
    }

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
        $('#pv-icon').src = directImage(icon, 256)
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
      website_link: String(fd.get('website_link') || '').trim(),
      google_drive_link: String(fd.get('google_drive_link') || '').trim(),
      privacy_policy_link: String(fd.get('privacy_policy_link') || '').trim(),
      auto_update: fd.get('auto_update') !== 'false',
      support_email: String(fd.get('support_email') || '').trim(),
      is_free: free,
      price: free ? 0 : Number(fd.get('price')) || 0,
      screenshots,
      release_notes: String(fd.get('release_notes') || '').trim() || undefined,
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
  paintStepper(me, me.developer ? 1 : 0)

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
    form.elements.logo_url.value = d.avatar_url || d.logo_url || ''
  } else if (form) {
    form.elements.developer_name.value = me.user?.metadata?.developer_name || ''
    form.elements.email.value = me.user?.email || ''
  }

  // Live preview of how the studio appears on listings.
  const paintProfilePreview = () => {
    if (!form) return
    const fd = new FormData(form)
    const name = String(fd.get('developer_name') || '').trim() || 'Your studio'
    const company = String(fd.get('company_name') || '').trim()
    const logo = directImage(String(fd.get('logo_url') || '').trim(), 256)
    const nameEl = $('#profile-preview-name')
    if (nameEl) nameEl.textContent = name
    const subEl = $('#profile-preview-sub')
    if (subEl) subEl.textContent = company || 'This is how users see you on every listing.'
    const img = $('#profile-logo-preview')
    const fb = $('#profile-logo-fallback')
    if (img && fb) {
      img.hidden = !logo
      fb.hidden = !!logo
      if (logo) img.src = logo
      else fb.textContent = initials(name)
    }
  }
  form?.addEventListener('input', debounce(paintProfilePreview, 150))
  paintProfilePreview()

  form?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const body = {
      developer_name: String(fd.get('developer_name') || '').trim(),
      company_name: String(fd.get('company_name') || '').trim(),
      description: String(fd.get('description') || '').trim(),
      website: String(fd.get('website') || '').trim(),
      email: String(fd.get('email') || '').trim(),
      // Stored as developers.avatar_url; logo_url is accepted as an alias.
      avatar_url: directImage(String(fd.get('logo_url') || '').trim(), 512),
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
    toast(
      data.created ? 'Profile created — step 2: submit your first app.' : 'Profile updated.',
      'success'
    )
    ME_CACHE = null
    const fresh = await whoami(true)
    paintStepper(fresh, fresh?.developer ? 1 : 0)
    if (data.created) {
      const slot = $('#profile-status')
      if (slot) {
        slot.innerHTML =
          'Developer profile created. <a href="/developer/submit"><strong>Submit your first app \u2192</strong></a>'
        slot.className = 'form-note is-success'
      }
    }
    if (fresh?.developer) {
      set('#acct-dev-id', fresh.developer.developer_id || '—')
      set('#acct-dev-status', fresh.developer.verified ? 'Verified developer' : 'Registered')
      if (publicLink) publicLink.href = `/developer-profile/${fresh.developer.id}`
    }
  })

  $('#logout-btn')?.addEventListener('click', doLogout)
}

/* ------------------------- companion-app deep links --------------------- */
/**
 * `intent://` URLs only mean something to Android browsers. Everywhere else we
 * point the same control at the Play listing for com.app.store so the button is
 * never a dead end.
 */
const PACKAGE_NAME = 'com.app.store'

function initDeepLinks() {
  const links = $$('[data-open-in-app]')
  if (!links.length) return
  const isAndroid = /android/i.test(navigator.userAgent)
  if (isAndroid) return
  const play = `https://play.google.com/store/apps/details?id=${PACKAGE_NAME}`
  links.forEach((a) => {
    a.href = play
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.title = `Get the Open Appstore app (${PACKAGE_NAME})`
  })
}

/* ------------------------------- security ------------------------------- */
/** Load a classic (non-module) script once, resolving to true on success. */
function loadScript(src) {
  return new Promise((resolve) => {
    if ($(`script[data-src="${src}"]`)) return resolve(true)
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.dataset.src = src
    el.onload = () => resolve(true)
    el.onerror = () => resolve(false)
    document.head.appendChild(el)
  })
}

function whenLabel(value) {
  if (!value) return 'unknown time'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * /developer/security — turn 2FA on or off and review recent sign-ins.
 * Enrolment is a three-step flow: mint a secret, scan/type it, confirm a live
 * code. Backup codes are rendered once, immediately after enabling.
 */
async function initDevSecurity() {
  const me = await devGate()
  if (!me) return

  const badge = $('#tfa-badge')
  const statusNote = $('#tfa-status-note')
  const paneOff = $('#tfa-off')
  const paneSetup = $('#tfa-setup')
  const paneOn = $('#tfa-on')
  const paneCodes = $('#tfa-codes')
  const setupAlert = $('#tfa-setup-alert')
  const disableAlert = $('#tfa-disable-alert')

  const alertIn = (box, msg, kind = 'error') => {
    if (!box) return toast(msg, kind)
    box.hidden = false
    box.className = `auth-alert is-${kind}`
    box.textContent = msg
  }

  const paint = (state, info = {}) => {
    if (paneOff) paneOff.hidden = state !== 'off'
    if (paneSetup) paneSetup.hidden = state !== 'setup'
    if (paneOn) paneOn.hidden = state !== 'on'
    if (badge) {
      const map = {
        off: ['is-off', '<i class="fa-solid fa-shield-halved"></i> Not protected'],
        setup: ['is-pending', '<i class="fa-solid fa-hourglass-half"></i> Finishing setup'],
        on: ['is-on', '<i class="fa-solid fa-circle-check"></i> Protected']
      }
      const [cls, label] = map[state] || map.off
      badge.className = `tfa-badge ${cls}`
      badge.innerHTML = label
    }
    if (statusNote) {
      statusNote.textContent =
        state === 'on'
          ? 'Two-factor authentication is on for this account.'
          : state === 'setup'
            ? 'Scan the key and confirm a code to finish switching it on.'
            : 'Anyone with your password can sign in. Add a second step below.'
    }
    if (state === 'on' && $('#tfa-codes-left')) {
      const left = info.backup_codes_left ?? 0
      $('#tfa-codes-left').textContent = left
        ? `${left} backup code${left === 1 ? '' : 's'} remaining.`
        : 'No backup codes left — turn 2FA off and on again to mint a fresh set.'
    }
  }

  const refresh = async () => {
    const { ok, data } = await api('/api/auth/2fa', { auth: true })
    if (!ok || !data?.success) {
      paint('off')
      if (badge) {
        badge.className = 'tfa-badge is-off'
        badge.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Unavailable'
      }
      if (statusNote) statusNote.textContent = data?.error || 'Could not read your security settings.'
      return null
    }
    paint(data.enabled ? 'on' : 'off', data)
    return data
  }

  /* ---- enrolment ---- */
  let pendingSecret = ''

  const renderQr = async (uri) => {
    const canvas = $('#tfa-qr-canvas')
    const wrap = $('#tfa-qr')
    if (!canvas || !wrap) return
    const ready = await loadScript('https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js')
    if (!ready || !window.QRCode?.toCanvas) {
      wrap.innerHTML = '<p class="muted"><i class="fa-solid fa-triangle-exclamation"></i> QR code unavailable offline — type the key below instead.</p>'
      return
    }
    window.QRCode.toCanvas(canvas, uri, { width: 180, margin: 1 }, (err) => {
      if (err) wrap.innerHTML = '<p class="muted">Could not draw the QR code — type the key below instead.</p>'
    })
  }

  $('#tfa-start')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    const label = btn.innerHTML
    btn.disabled = true
    btn.innerHTML = '<span class="spinner spinner-xs"></span> Preparing…'
    const { ok, data } = await api('/api/auth/2fa/setup', { method: 'POST', auth: true, body: {} })
    btn.disabled = false
    btn.innerHTML = label
    if (!ok || !data?.success) return toast(data?.error || 'Could not start 2FA setup.', 'error', 'Setup failed')
    pendingSecret = data.secret
    if ($('#tfa-secret')) $('#tfa-secret').textContent = data.secret.replace(/(.{4})/g, '$1 ').trim()
    paint('setup')
    await renderQr(data.otpauth_uri)
    setupDigits.clear()
    setupDigits.focus()
  })

  $('#tfa-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pendingSecret)
      toast('Secret key copied.', 'success')
    } catch {
      toast('Copy failed — select the key manually.', 'warn')
    }
  })

  $('#tfa-cancel-setup')?.addEventListener('click', async () => {
    if (setupAlert) setupAlert.hidden = true
    await refresh()
  })

  const enableForm = $('#tfa-enable-form')
  const setupDigits = wireDigits($('#tfa-setup-inputs'), () => enableForm?.requestSubmit())

  enableForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (setupAlert) setupAlert.hidden = true
    const code = setupDigits.value()
    if (code.length < 6) return alertIn(setupAlert, 'Enter all six digits of the current code.', 'warn')
    const btn = enableForm.querySelector('button[type="submit"]')
    const label = btn.innerHTML
    btn.disabled = true
    btn.innerHTML = '<span class="spinner spinner-xs"></span> Turning on…'
    const { ok, data } = await api('/api/auth/2fa/enable', { method: 'POST', auth: true, body: { code } })
    btn.disabled = false
    btn.innerHTML = label
    if (!ok || !data?.success) {
      setupDigits.clear()
      setupDigits.focus()
      return alertIn(setupAlert, data?.error || 'That code did not match.')
    }
    showBackupCodes(data.backup_codes || [])
    toast(data.message || 'Two-factor authentication is on.', 'success', '2FA enabled')
    await refresh()
    await loadActivity()
  })

  /* ---- backup codes ---- */
  let lastCodes = []
  const showBackupCodes = (codes) => {
    lastCodes = codes
    const list = $('#backup-codes-list')
    if (!list) return
    list.innerHTML = codes.map((c) => `<li><code>${escHtml(c)}</code></li>`).join('')
    if (paneCodes) paneCodes.hidden = !codes.length
  }

  $('#tfa-copy-codes')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(lastCodes.join('\n'))
      toast('Backup codes copied.', 'success')
    } catch {
      toast('Copy failed — select them manually.', 'warn')
    }
  })

  $('#tfa-download-codes')?.addEventListener('click', () => {
    const body = [
      'Open Appstore — two-factor backup codes',
      `Account: ${me.user?.email || ''}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      ...lastCodes,
      '',
      'Each code works once. Keep this file somewhere safe.'
    ].join('\n')
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'open-appstore-backup-codes.txt'
    a.click()
    URL.revokeObjectURL(url)
  })

  $('#tfa-codes-done')?.addEventListener('click', () => {
    if (paneCodes) paneCodes.hidden = true
    lastCodes = []
  })

  /* ---- disable ---- */
  const disableForm = $('#tfa-disable-form')
  disableForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (disableAlert) disableAlert.hidden = true
    const code = String($('#tfa-disable-code')?.value || '').trim()
    if (!code) return alertIn(disableAlert, 'Enter a current authenticator code or a backup code.', 'warn')
    const btn = disableForm.querySelector('button[type="submit"]')
    const label = btn.innerHTML
    btn.disabled = true
    btn.innerHTML = '<span class="spinner spinner-xs"></span> Disabling…'
    const { ok, data } = await api('/api/auth/2fa/disable', { method: 'POST', auth: true, body: { code } })
    btn.disabled = false
    btn.innerHTML = label
    if (!ok || !data?.success) return alertIn(disableAlert, data?.error || 'Could not switch 2FA off.')
    if ($('#tfa-disable-code')) $('#tfa-disable-code').value = ''
    if (paneCodes) paneCodes.hidden = true
    toast(data.message || 'Two-factor authentication switched off.', 'warn', '2FA disabled')
    await refresh()
    await loadActivity()
  })

  /* ---- devices + history ---- */
  const loadActivity = async () => {
    const devices = $('#device-list')
    const logins = $('#login-list')
    const { ok, data } = await api('/api/auth/sessions', { auth: true })
    if (!ok || !data?.success) {
      const msg = `<li class="muted">${escHtml(data?.error || 'Could not load recent activity.')}</li>`
      if (devices) devices.innerHTML = msg
      if (logins) logins.innerHTML = ''
      return
    }
    if (devices) {
      devices.innerHTML = (data.devices || []).length
        ? data.devices
            .map(
              (d) => `<li>
        <span class="dev-icon"><i class="fa-solid ${/(iphone|android|mobile)/i.test(d.device_name || '') ? 'fa-mobile-screen-button' : 'fa-laptop'}"></i></span>
        <div><strong>${escHtml(d.device_name || 'Unknown device')}</strong>
        <small class="muted">${escHtml(d.ip_address || 'no IP')} · last seen ${escHtml(whenLabel(d.last_login || d.created_at))}</small></div>
      </li>`
            )
            .join('')
        : '<li class="muted">No devices recorded yet.</li>'
    }
    if (logins) {
      logins.innerHTML = (data.history || []).length
        ? data.history
            .map(
              (h) => `<li class="${h.success ? 'is-ok' : 'is-bad'}">
        <i class="fa-solid ${h.success ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
        <div><strong>${escHtml(h.reason || (h.success ? 'Signed in' : 'Failed attempt'))}</strong>
        <small class="muted">${escHtml(whenLabel(h.login_time))} · ${escHtml(h.ip_address || 'no IP')}</small></div>
      </li>`
            )
            .join('')
        : '<li class="muted">No sign-ins recorded yet.</li>'
    }
  }

  await refresh()
  await loadActivity()
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
  initDeepLinks()
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
    case 'dev-security':
      initDevSecurity()
      break
    case 'auth-callback':
      initAuthCallback()
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
