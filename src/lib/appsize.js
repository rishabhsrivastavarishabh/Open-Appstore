/* Automatic app-size detection.
 *
 * Developers almost never fill the "file size" field in, and when they do it
 * is often wrong — the seed data has a 58.9 MB APK recorded as "54". So rather
 * than trusting the listing, we ask the file host how big the download
 * actually is and cache the answer.
 *
 * The probe is a HEAD request: it returns Content-Length without transferring
 * the payload, so measuring a 60 MB APK costs a few hundred bytes.
 */

/** Formats a byte count the way an app store does (MB for anything app-sized). */
export function formatBytes(bytes) {
  const n = Number(bytes || 0)
  if (!n || !Number.isFinite(n) || n < 0) return null
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

/**
 * Interpret a stored `file_size`, whose unit is ambiguous in this schema:
 * the submit form asks for whole MB, but some rows clearly hold raw bytes.
 * Values above this threshold can only be bytes — no one ships a 100 000 MB
 * app — so we can disambiguate without a migration.
 */
export function normalizeStoredSize(value) {
  const n = Number(value || 0)
  if (!n || !Number.isFinite(n) || n <= 0) return null
  return n > 100000 ? n : n * 1024 * 1024
}

/**
 * Ask the download host how large the file is, without downloading it.
 * Returns bytes, or null when the host does not say (many CDNs omit
 * Content-Length on chunked responses, and Google Drive interstitials never
 * report the real size).
 */
export async function probeDownloadSize(url, { timeoutMs = 4000 } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return null
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    let res
    try {
      res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctl.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return null
    const len = Number(res.headers.get('content-length') || 0)
    if (!len || !Number.isFinite(len)) return null
    // An HTML body means we followed a share/interstitial page rather than the
    // binary, so its length describes the page, not the app.
    const type = (res.headers.get('content-type') || '').toLowerCase()
    if (type.includes('text/html')) return null
    return len
  } catch {
    // A slow or hostile host must never hold up a page render.
    return null
  }
}

/**
 * Resolve the size to display for an app, cheapest source first:
 *   1. a size recorded against a released version,
 *   2. a live HEAD probe of the download URL (cached in KV when available).
 *
 * @returns {Promise<{bytes:number|null, label:string|null, source:string}>}
 */
export async function resolveAppSize(env, { versions = [], downloadUrl = null } = {}) {
  const recorded = versions.map((v) => normalizeStoredSize(v?.file_size)).find(Boolean)
  if (recorded) return { bytes: recorded, label: formatBytes(recorded), source: 'recorded' }

  if (!downloadUrl) return { bytes: null, label: null, source: 'unknown' }

  // Cache on the URL, not the app: two apps pointing at the same build should
  // resolve to the same measurement, and a re-upload changes the URL.
  const key = `appsize:${downloadUrl}`
  const kv = env?.KV
  if (kv) {
    try {
      const hit = await kv.get(key)
      if (hit) {
        const bytes = Number(hit)
        if (bytes > 0) return { bytes, label: formatBytes(bytes), source: 'cache' }
      }
    } catch {
      /* KV is an optimisation; never fail the page over it. */
    }
  }

  const bytes = await probeDownloadSize(downloadUrl)
  if (!bytes) return { bytes: null, label: null, source: 'unknown' }

  if (kv) {
    try {
      // A published build is immutable in practice, but expire anyway so a
      // re-upload behind the same URL is eventually picked up.
      await kv.put(key, String(bytes), { expirationTtl: 60 * 60 * 24 * 7 })
    } catch {
      /* ignore */
    }
  }
  return { bytes, label: formatBytes(bytes), source: 'probe' }
}

/* ------------------------- device compatibility -------------------------- */

/**
 * Decide what this download means for the visitor's device.
 *
 * Deliberately conservative: an APK is only offered as installable to Android.
 * Telling an iPhone user a .apk is "compatible" would be worse than saying
 * nothing, because they would download 60 MB that cannot possibly install.
 */
export function classifyDownload(url) {
  const u = String(url || '').toLowerCase()
  if (/\.apk(\?|$)/.test(u)) return { kind: 'apk', platform: 'Android', label: 'Android APK' }
  if (/\.aab(\?|$)/.test(u)) return { kind: 'aab', platform: 'Android', label: 'Android App Bundle' }
  if (/\.ipa(\?|$)/.test(u)) return { kind: 'ipa', platform: 'iOS', label: 'iOS app' }
  if (/\.exe(\?|$)|\.msi(\?|$)/.test(u)) return { kind: 'exe', platform: 'Windows', label: 'Windows installer' }
  if (/\.dmg(\?|$)|\.pkg(\?|$)/.test(u)) return { kind: 'dmg', platform: 'macOS', label: 'macOS installer' }
  if (/\.deb(\?|$)|\.rpm(\?|$)|\.appimage(\?|$)/.test(u)) return { kind: 'linux', platform: 'Linux', label: 'Linux package' }
  if (/\.zip(\?|$)/.test(u)) return { kind: 'zip', platform: null, label: 'Archive' }
  return { kind: 'other', platform: null, label: 'Download' }
}
