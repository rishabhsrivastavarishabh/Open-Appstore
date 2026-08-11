/* QR rendering for the app-share dialog.
 *
 * Self-hosted rather than pointing an <img> at a QR web service: every shared
 * app URL would otherwise be handed to a third party, which leaks what
 * visitors are looking at, and the code would break the day that host changed
 * its API. Self-hosting the library (rather than a CDN <script>) keeps that
 * property with no runtime third-party dependency at all.
 *
 * A hand-rolled encoder was tried first and rejected: it produced symbols that
 * looked correct but decoded as nothing in a real scanner. Verified encoders
 * are not worth reimplementing for a share button.
 */
import qrcode from '/static/qrcode-generator.js'

/** Render `text` into `canvas` as a QR code, including the required quiet zone. */
export function drawQr(canvas, text) {
  // Error-correction level L: these codes are read off a screen at a
  // comfortable size, so the redundancy of M/Q/H would only shrink the modules.
  const qr = qrcode(0, 'L') // 0 = pick the smallest version that fits
  qr.addData(text)
  qr.make()

  const n = qr.getModuleCount()
  const px = canvas.width
  const quiet = 4 // modules; required by the spec for reliable scanning
  const scale = Math.floor(px / (n + quiet * 2))
  if (scale < 1) throw new Error('canvas too small for this QR code')
  const offset = Math.floor((px - scale * n) / 2)

  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, px, px)
  ctx.fillStyle = '#000000'
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(offset + c * scale, offset + r * scale, scale, scale)
    }
  }
}
