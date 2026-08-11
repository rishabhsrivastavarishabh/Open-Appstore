/* Minimal byte-mode QR encoder (ISO/IEC 18004), error-correction level L.
 *
 * Why this exists instead of an <img> pointing at a QR web service: every
 * shared app URL would otherwise be handed to a third party, which leaks what
 * visitors are looking at, and the code would silently stop rendering the day
 * that host changed its API. This is ~4 KB and lazy-loaded only when someone
 * actually opens the QR panel, so it costs nothing on a normal page view.
 *
 * Level L is chosen deliberately: these codes are displayed on a screen at a
 * comfortable size, not printed on a scuffed package, so the extra redundancy
 * of M/Q/H would only make the modules smaller and harder to scan.
 */

/* --- capacity/EC tables for versions 1..10, level L ---------------------- */
const CAPACITY = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271] // byte-mode chars
const EC_PER_BLOCK = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18]
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346]
const EC_BLOCKS = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4]
// Alignment-pattern centre coordinates per version.
const ALIGN_POS = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
]

/* --- GF(256) tables, built once ----------------------------------------- */
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d // primitive polynomial for QR
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
})()

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

function generatorPoly(degree) {
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], EXP[i])
      next[j + 1] ^= poly[j]
    }
    poly = next
  }
  return poly
}

function reedSolomon(block, ecLen) {
  const gen = generatorPoly(ecLen)
  const rem = new Array(ecLen).fill(0)
  for (const byte of block) {
    const factor = byte ^ rem[0]
    rem.shift()
    rem.push(0)
    for (let j = 0; j < ecLen; j++) rem[j] ^= gfMul(gen[j + 1], factor)
  }
  return rem
}

/* --- mask patterns ------------------------------------------------------- */
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
]

/**
 * Encode `text` as a QR symbol.
 * @returns {{size:number, modules:number[][]}} 1 = dark module.
 */
export function qrEncode(text) {
  const data = new TextEncoder().encode(text)

  let version = 0
  for (let v = 1; v <= CAPACITY.length; v++) {
    if (data.length <= CAPACITY[v - 1]) { version = v; break }
  }
  if (!version) throw new Error('payload too long for a version-10 QR code')

  const vi = version - 1
  const blocks = EC_BLOCKS[vi]
  const ecLen = EC_PER_BLOCK[vi]
  const dataCodewords = TOTAL_CODEWORDS[vi] - ecLen * blocks

  /* --- bit stream: mode indicator + char count + payload + padding ------- */
  const bits = []
  const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1) }
  push(0b0100, 4) // byte mode
  push(data.length, version < 10 ? 8 : 16)
  for (const b of data) push(b, 8)

  const capacityBits = dataCodewords * 8
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0) // terminator
  while (bits.length % 8) bits.push(0)

  const codewords = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]
    codewords.push(byte)
  }
  // Pad bytes alternate 0xEC / 0x11 starting from the first pad position.
  const PAD = [0xec, 0x11]
  for (let p = 0; codewords.length < dataCodewords; p++) codewords.push(PAD[p % 2])

  /* --- split into blocks, add EC, interleave ----------------------------- */
  const shortLen = Math.floor(dataCodewords / blocks)
  const longCount = dataCodewords % blocks
  const dataBlocks = []
  const ecBlocks = []
  let pos = 0
  for (let i = 0; i < blocks; i++) {
    const len = shortLen + (i >= blocks - longCount ? 1 : 0)
    const blk = codewords.slice(pos, pos + len)
    pos += len
    dataBlocks.push(blk)
    ecBlocks.push(reedSolomon(blk, ecLen))
  }
  const finalCodewords = []
  const maxLen = Math.max(...dataBlocks.map((b) => b.length))
  for (let i = 0; i < maxLen; i++) {
    for (const b of dataBlocks) if (i < b.length) finalCodewords.push(b[i])
  }
  for (let i = 0; i < ecLen; i++) {
    for (const b of ecBlocks) finalCodewords.push(b[i])
  }

  /* --- matrix + function patterns ---------------------------------------- */
  const n = version * 4 + 17
  const modules = Array.from({ length: n }, () => new Array(n).fill(0))
  // Tracked separately so masking and data placement can tell a function
  // module from a data module that merely happens to be light.
  const reserved = Array.from({ length: n }, () => new Array(n).fill(false))

  const setModule = (r, c, dark) => {
    if (r < 0 || r >= n || c < 0 || c >= n) return
    modules[r][c] = dark ? 1 : 0
    reserved[r][c] = true
  }

  const placeFinder = (row, col) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inner = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6
        const dark = inner &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6 ||
            (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4))
        setModule(row + dr, col + dc, dark)
      }
    }
  }
  placeFinder(0, 0)
  placeFinder(0, n - 7)
  placeFinder(n - 7, 0)

  // Timing patterns. These run the FULL span between the finder separators —
  // stopping short (e.g. at n-8) leaves part of row/column 6 unreserved, and
  // the data placement then writes payload bits straight over the timing line.
  for (let i = 8; i < n - 8; i++) {
    setModule(6, i, i % 2 === 0)
    setModule(i, 6, i % 2 === 0)
  }
  // The finder blocks above already cover i < 8 and i >= n-8, but only as part
  // of their own 8x8 footprint; re-assert column/row 6 across the whole symbol
  // so every module of the timing line is marked reserved.
  for (let i = 0; i < n; i++) {
    if (!reserved[6][i]) setModule(6, i, i % 2 === 0)
    if (!reserved[i][6]) setModule(i, 6, i % 2 === 0)
  }

  // Alignment patterns, skipping the three that collide with finders.
  const centres = ALIGN_POS[version] || []
  const last = centres[centres.length - 1]
  for (const r of centres) {
    for (const c of centres) {
      if ((r === 6 && c === 6) || (r === 6 && c === last) || (r === last && c === 6)) continue
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setModule(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1)
        }
      }
    }
  }

  // Dark module — always set for every symbol.
  setModule(n - 8, 8, true)

  // Reserve the two format-information areas (contents written after masking).
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) setModule(8, i, false)
    if (!reserved[i][8]) setModule(i, 8, false)
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][n - 1 - i]) setModule(8, n - 1 - i, false)
    if (!reserved[n - 1 - i][8]) setModule(n - 1 - i, 8, false)
  }

  /* --- place data in the zig-zag pattern --------------------------------- */
  const stream = []
  for (const b of finalCodewords) for (let i = 7; i >= 0; i--) stream.push((b >> i) & 1)

  let idx = 0
  let upward = true
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col-- // the vertical timing column is never a data column
    for (let i = 0; i < n; i++) {
      const row = upward ? n - 1 - i : i
      for (let k = 0; k < 2; k++) {
        const cc = col - k
        if (reserved[row][cc]) continue
        modules[row][cc] = idx < stream.length ? stream[idx++] : 0
      }
    }
    upward = !upward
  }

  /* --- choose the mask with the lowest penalty --------------------------- */
  let bestMask = 0
  let bestPenalty = Infinity
  let bestGrid = null
  for (let m = 0; m < 8; m++) {
    const grid = modules.map((row) => row.slice())
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!reserved[r][c] && MASKS[m](r, c)) grid[r][c] ^= 1
      }
    }
    writeFormat(grid, n, m)
    const p = penalty(grid, n)
    if (p < bestPenalty) { bestPenalty = p; bestMask = m; bestGrid = grid }
  }
  void bestMask

  return { size: n, modules: bestGrid }
}

/** Format info = EC level L (01) + mask, BCH(15,5) protected and XOR-masked. */
function writeFormat(grid, n, mask) {
  const data = (0b01 << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537)
  const fmt = (((data << 10) | rem) ^ 0x5412) & 0x7fff

  // Placement verified module-by-module against a reference encoder. Note the
  // orientation: copy 1's LOW bits run DOWN column 8 and its HIGH bits run
  // LEFT along row 8 — the transpose of this is a very easy mistake to make
  // and produces a symbol that looks perfectly plausible but scans as nothing.
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >> i) & 1
    // Copy 1: around the top-left finder (index 6 skips the timing line).
    if (i < 6) grid[i][8] = bit
    else if (i === 6) grid[7][8] = bit
    else if (i === 7) grid[8][8] = bit
    else if (i === 8) grid[8][7] = bit
    else grid[8][14 - i] = bit
    // Copy 2: low 8 bits run leftwards along row 8 from the right edge, high
    // 7 bits run down column 8 from the bottom edge.
    if (i < 8) grid[8][n - 1 - i] = bit
    else grid[n - 15 + i][8] = bit
  }
  grid[n - 8][8] = 1 // dark module
}

/** Penalty scoring per the spec — picks the most scannable mask. */
function penalty(grid, n) {
  let score = 0

  // Rule 1: runs of 5+ same-coloured modules in a row or column.
  for (let i = 0; i < n; i++) {
    let runRow = 1
    let runCol = 1
    for (let j = 1; j < n; j++) {
      runRow = grid[i][j] === grid[i][j - 1] ? runRow + 1 : 1
      if (runRow === 5) score += 3
      else if (runRow > 5) score += 1
      runCol = grid[j][i] === grid[j - 1][i] ? runCol + 1 : 1
      if (runCol === 5) score += 3
      else if (runCol > 5) score += 1
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = grid[r][c]
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns.
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
  const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
  const matches = (get, i) => {
    let a = true
    let b = true
    for (let k = 0; k < 11; k++) {
      const v = get(i + k)
      if (v !== P1[k]) a = false
      if (v !== P2[k]) b = false
    }
    return a || b
  }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c + 11 <= n; c++) {
      if (matches((k) => grid[r][k], c)) score += 40
      if (matches((k) => grid[k][r], c)) score += 40
    }
  }

  // Rule 4: deviation from a 50/50 dark ratio.
  let dark = 0
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dark += grid[r][c]
  const pct = (dark * 100) / (n * n)
  score += Math.floor(Math.abs(pct - 50) / 5) * 10

  return score
}

/** Render `text` into a canvas as a QR code with the required quiet zone. */
export function drawQr(canvas, text) {
  const { size: n, modules } = qrEncode(text)
  const px = canvas.width
  const quiet = 4
  const scale = Math.floor(px / (n + quiet * 2))
  if (scale < 1) throw new Error('canvas too small for this QR code')
  const offset = Math.floor((px - scale * n) / 2)

  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, px, px)
  ctx.fillStyle = '#000000'
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (modules[r][c]) ctx.fillRect(offset + c * scale, offset + r * scale, scale, scale)
    }
  }
}
