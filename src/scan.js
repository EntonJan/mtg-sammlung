// Karten-Scan: Kamerabild → Namenszeile (oben) + Sammlernummer/Set (unten links) per Texterkennung
// → Scryfall (unscharfe Namenssuche bzw. exaktes Printing).
import { sfFetch, slimCard, searchCards } from './scryfall'

const API = 'https://api.scryfall.com'
let workerPromise = null

// Tesseract erst bei Bedarf laden (großes Paket, Sprachdaten kommen vom CDN)
function getWorker() {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(async ({ createWorker }) => {
      const w = await createWorker('eng')
      await w.setParameters({ tessedit_pageseg_mode: '7' }) // eine Textzeile
      return w
    })
  }
  return workerPromise
}

export function preloadOcr() { getWorker().catch(() => { workerPromise = null }) }

// Bereich ausschneiden und auf ~900 px Breite skalieren (so liest Tesseract am besten).
// mode 'otsu' = Schwarz/Weiß mit automatischer Schwelle (Otsu), sonst Graustufen.
function crop(src, sw, sh, box, mode = 'raw') {
  const [x, y, w, h] = [box.x * sw, box.y * sh, box.w * sw, box.h * sh]
  const scale = 900 / w
  const c = document.createElement('canvas')
  c.width = 900; c.height = Math.max(20, Math.round(h * scale))
  const g = c.getContext('2d', { willReadFrequently: true })
  g.drawImage(src, x, y, w, h, 0, 0, c.width, c.height)
  if (mode !== 'otsu') return c
  const img = g.getImageData(0, 0, c.width, c.height)
  const d = img.data, n = d.length / 4, hist = new Array(256).fill(0)
  for (let i = 0; i < d.length; i += 4) { const v = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); d[i] = v; hist[v]++ }
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sB = 0, wB = 0, best = 0, th = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue
    const wF = n - wB; if (!wF) break
    sB += t * hist[t]
    const v = wB * wF * (sB / wB - (sum - sB) / wF) ** 2
    if (v > best) { best = v; th = t }
  }
  let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < th) dark++
  const inv = dark > n / 2 // helle Schrift auf dunklem Grund
  for (let i = 0; i < d.length; i += 4) { let v = d[i] < th ? 0 : 255; if (inv) v = 255 - v; d[i] = d[i + 1] = d[i + 2] = v }
  g.putImageData(img, 0, 0)
  return c
}

// Oberes Band der Karte (Namenszeile) – um die Kartenmitte leicht gedreht, damit schief
// gehaltene Karten trotzdem gelesen werden
function band(src, sw, sh, frame, angle) {
  const B = { x: frame.x + 0.03 * frame.w, y: frame.y + 0.02 * frame.h, w: 0.8 * frame.w, h: 0.15 * frame.h }
  const s = 1400 / (B.w * sw)
  const c = document.createElement('canvas')
  c.width = 1400; c.height = Math.round(B.h * sh * s)
  const g = c.getContext('2d')
  const cx = (frame.x + frame.w / 2) * sw * s, cy = (frame.y + frame.h / 2) * sh * s
  g.translate(-B.x * sw * s, -B.y * sh * s)
  g.translate(cx, cy); g.rotate(angle); g.translate(-cx, -cy)
  g.drawImage(src, 0, 0, sw * s, sh * s)
  return c
}

// Bereiche relativ zum Kartenrahmen (Kartenformat 63 × 88 mm) – mehrere Varianten,
// weil die Karte im Kamerabild nie ganz exakt im Rahmen liegt
const NAME_TRIES = [
  [{ x: 0.06, y: 0.04, w: 0.70, h: 0.06 }, 'otsu'],
  [{ x: 0.06, y: 0.04, w: 0.70, h: 0.06 }, 'raw'],
  [{ x: 0.07, y: 0.045, w: 0.62, h: 0.05 }, 'raw'],
  [{ x: 0.06, y: 0.025, w: 0.72, h: 0.065 }, 'otsu'],
  [{ x: 0.06, y: 0.055, w: 0.72, h: 0.065 }, 'otsu'],
]
export const NAME_BOX = NAME_TRIES[0][0]
export const INFO_BOX = { x: 0.03, y: 0.89, w: 0.45, h: 0.08 }

function cleanName(t) {
  return t.replace(/[^A-Za-zÀ-ÿ',\- ]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^[^A-Za-zÀ-ÿ]+/, '').replace(/\s+[a-zA-Z]$/, '')
}

// Sammlernummer + Setcode aus der Infozeile, z. B. "U 0305 / M3C « EN"
function parseInfo(t) {
  const up = t.toUpperCase().replace(/[|]/g, ' ')
  const num = up.match(/\b0*(\d{1,4})[A-Z]?\b/)
  const set = up.match(/\b([A-Z0-9]{3,5})\s*\S?\s*(?:EN|DE|FR|IT|ES|JP|PT)\b/)
  return { num: num?.[1], set: set?.[1]?.toLowerCase() }
}

// Ein Bild (Video-Frame oder Foto) erkennen. frame = Kartenrahmen relativ zum Bild {x,y,w,h}
export async function recognize(src, sw, sh, frame) {
  const w = await getWorker()
  const sub = (b) => ({ x: frame.x + b.x * frame.w, y: frame.y + b.y * frame.h, w: b.w * frame.w, h: b.h * frame.h })
  let best = { name: '', confidence: 0 }
  const consider = (text, conf) => {
    const name = cleanName(text)
    if (name.replace(/[^A-Za-z]/g, '').length >= 3 && conf > best.confidence) best = { name, confidence: conf }
  }
  // 1) Namensband (mehrere Zeilen erlaubt), gerade und leicht gedreht
  await w.setParameters({ tessedit_pageseg_mode: '6' })
  for (const a of [0, 0.026, -0.026, 0.05, -0.05]) {
    const { data } = await w.recognize(band(src, sw, sh, frame, a))
    for (const l of data.lines || []) consider(l.text, l.confidence)
    if (best.confidence >= 80) break
  }
  // 2) Feste Ausschnitte als Rückfall
  if (best.confidence < 80) {
    await w.setParameters({ tessedit_pageseg_mode: '7' }) // eine Textzeile
    for (const [box, mode] of NAME_TRIES) {
      const { data } = await w.recognize(crop(src, sw, sh, sub(box), mode))
      consider(data.text, data.confidence)
      if (best.confidence >= 85) break
    }
  }
  let info = {}
  try {
    await w.setParameters({ tessedit_pageseg_mode: '6' }) // Textblock (2 Zeilen)
    const { data } = await w.recognize(crop(src, sw, sh, sub(INFO_BOX), 'raw'))
    info = parseInfo(data.text)
  } catch { /* egal */ }
  return { ...best, info }
}

// Ähnlichkeit zweier Namen (0..1) über Levenshtein-Abstand
function similarity(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase()
  const m = a.length, n = b.length
  if (!m || !n) return 0
  const dp = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return 1 - dp[n] / Math.max(m, n)
}

// Erkannten Text bei Scryfall nachschlagen
export async function lookup({ name, info, confidence = 0 }) {
  // 1) Exaktes Printing über Set + Nummer (falls lesbar) – passt der Name grob, ist das sicher
  if (info?.set && info?.num) {
    const p = await sfFetch(`${API}/cards/${info.set}/${info.num}`)
    if (p.ok) {
      const exact = slimCard(await p.json())
      if (name && nameScore(name, exact) >= 0.5) return { card: exact, exact: true }
    }
  }
  if (!name || name.length < 3) return null
  // 2) Unscharfe Namenssuche (englisch); bei Fehlschlag hinten Störwörter abschneiden
  const words = name.split(' ')
  for (let n = words.length; n >= Math.min(2, words.length); n--) {
    const q = words.slice(0, n).join(' ')
    const res = await sfFetch(`${API}/cards/named?fuzzy=${encodeURIComponent(q)}`)
    if (!res.ok) continue
    const card = slimCard(await res.json())
    if (nameScore(q, card) >= 0.6) return { card, exact: false }
  }
  // 3) Deutscher Name? Nur bei gut lesbarem Text
  if (confidence >= 70) {
    const card = (await searchCards(name).catch(() => []))[0]
    if (card) return { card, exact: false }
  }
  return null
}

// Wie gut passt der erkannte Text zum Kartennamen? (ganzer Name oder Vorderseite, auch als Präfix)
function nameScore(text, card) {
  const t = text.toLowerCase()
  return Math.max(...[card.name, card.name.split(' // ')[0]].map((n) => {
    const nl = n.toLowerCase()
    return Math.max(similarity(t, nl), similarity(t.slice(0, nl.length), nl))
  }))
}

export async function printingsOf(card) {
  const res = await sfFetch(`${API}/cards/search?unique=prints&order=released&q=${encodeURIComponent(`oracleid:${card.oracleId}`)}`)
  if (!res.ok) return [card]
  return (await res.json()).data.map(slimCard)
}
