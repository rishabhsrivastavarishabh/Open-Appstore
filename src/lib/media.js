/**
 * Media URL normalisation.
 *
 * Developers naturally paste a Google Drive *share* link when asked for an
 * icon or screenshot URL. Those links point at Drive's HTML viewer, not at the
 * image bytes, so putting one straight into <img src> renders nothing.
 * This module rewrites the common "sharing" URL shapes into their direct,
 * embeddable equivalents so previews just work.
 */

/** Pull a Drive file id out of any of Google's URL shapes. */
export function extractDriveId(url) {
  if (!url) return null
  const s = String(url).trim()
  if (!/(?:drive|docs)\.google\.com|drive\.usercontent\.google\.com/i.test(s)) return null

  // https://drive.google.com/file/d/<ID>/view  |  /d/<ID>/preview
  let m = /\/(?:file|document|presentation|spreadsheets)\/d\/([A-Za-z0-9_-]{10,})/.exec(s)
  if (m) return m[1]

  // .../open?id=<ID> | /uc?id=<ID> | /thumbnail?id=<ID> | /download?id=<ID>
  m = /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s)
  if (m) return m[1]

  // https://drive.google.com/d/<ID>
  m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(s)
  if (m) return m[1]

  return null
}

/**
 * Direct, hot-linkable image URL for a Drive file.
 * `thumbnail` is used rather than `uc?export=view` because it is served with
 * permissive CORS/caching headers and honours a width hint.
 */
export function driveImageUrl(id, width = 1600) {
  return `https://drive.google.com/thumbnail?id=${id}&sz=w${width}`
}

/**
 * Normalise any user-supplied image URL into something an <img> can render.
 * Unknown hosts are returned untouched. Non-http(s) values are rejected so a
 * pasted `javascript:` or `data:` URL can never reach the DOM.
 */
export function normalizeImageUrl(url, width = 1600) {
  if (!url) return null
  const s = String(url).trim()
  if (!s) return null

  const driveId = extractDriveId(s)
  if (driveId) return driveImageUrl(driveId, width)

  // Dropbox share links need raw=1 to serve the file itself.
  if (/^https?:\/\/(www\.)?dropbox\.com\//i.test(s)) {
    return s.replace(/[?&]dl=\d/, '').replace(/[?&]raw=\d/, '') + (s.includes('?') ? '&raw=1' : '?raw=1')
  }

  // OneDrive / SharePoint share links.
  if (/^https?:\/\/1drv\.ms\//i.test(s)) return s

  // GitHub blob → raw.
  if (/^https?:\/\/github\.com\/.+\/blob\//i.test(s)) {
    return s.replace('//github.com/', '//raw.githubusercontent.com/').replace('/blob/', '/')
  }

  if (!/^https?:\/\//i.test(s)) return null
  return s
}

/** Normalise a list of image URLs, dropping anything unusable. */
export function normalizeImageList(list, width = 1600) {
  if (!Array.isArray(list)) return []
  return list.map((u) => normalizeImageUrl(u, width)).filter(Boolean)
}

/**
 * Normalise a *download* URL (an .apk / .zip / installer) where we want the
 * bytes, not a viewer page. Drive needs `uc?export=download`; the thumbnail
 * endpoint would hand back a JPEG preview of the file instead.
 */
export function normalizeDownloadUrl(url) {
  if (!url) return null
  const s = String(url).trim()
  if (!s) return null

  const driveId = extractDriveId(s)
  if (driveId) return `https://drive.google.com/uc?export=download&id=${driveId}`

  if (/^https?:\/\/(www\.)?dropbox\.com\//i.test(s)) {
    return s.replace(/[?&]dl=\d/, '').replace(/[?&]raw=\d/, '') + (s.includes('?') ? '&dl=1' : '?dl=1')
  }

  if (/^https?:\/\/github\.com\/.+\/blob\//i.test(s)) {
    return s.replace('//github.com/', '//raw.githubusercontent.com/').replace('/blob/', '/')
  }

  if (!/^https?:\/\//i.test(s)) return null
  return s
}

/** Human-readable label for where a link lives ("Google Drive", "Dropbox", host). */
export function linkHost(url) {
  if (!url) return ''
  if (extractDriveId(url)) return 'Google Drive'
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(url).trim())
  if (!m) return ''
  const host = m[1].replace(/^www\./i, '')
  if (/dropbox\.com$/i.test(host)) return 'Dropbox'
  if (/github(usercontent)?\.com$/i.test(host)) return 'GitHub'
  return host
}

/** True when the URL is a Google Drive link in any form. */
export function isDriveUrl(url) {
  return !!extractDriveId(url)
}
