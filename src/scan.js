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

// Bereich aus einer Quelle (Video/Bild) ausschneiden, vergrößern, in Graustufen + Kontrast
function crop(src, sw, sh, box, scale = 2.5, invert = false) {
  const [x, y, w, h] = [box.x * sw, box.y * sh, box.w * sw, box.h * sh]
  const c = document.createElement('canvas')
  c.width = Math.round(w * scale); c.height = Math.round(h * scale)
  const g = c.getContext('2d', { willReadFrequently: true })
  g.drawImage(src, x, y, w, h, 0, 0, c.width, c.height)
  const img = g.getImageData(0, 0, c.width, c.height)
  const d = img.data
  let sum = 0
  for (let i = 0; i < d.length; i += 4) { const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = v; sum += v }
  const mean = sum / (d.length / 4)
  // Helle Schrift auf dunklem Grund (z. B. schwarze Rahmen) → invertieren
  const inv = invert || mean < 110
  for (let i = 0; i < d.length; i += 4) {
    let v = d[i]
    v = (v - mean) * 1.8 + 128
    if (inv) v = 255 - v
    v = Math.max(0, Math.min(255, v))
    d[i] = d[i + 1] = d[i + 2] = v
  }
  g.putImageData(img, 0, 0)
  return c
}

// Bereiche relativ zum Kartenrahmen (Kartenformat 63 × 88 mm)
export const NAME_BOX = { x: 0.07, y: 0.035, w: 0.66, h: 0.065 }
export const INFO_BOX = { x: 0.04, y: 0.895, w: 0.45, h: 0.075 }

function cleanName(t) {
  return t.replace(/[^A-Za-zÀ-ÿ',\- ]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Sammlernummer + Setcode aus der Infozeile, z. B. "0206 C" / "MKM • EN"
function parseInfo(t) {
  const up = t.toUpperCase().replace(/[|]/g, ' ')
  const num = up.match(/\b0*(\d{1,4})(?:\s*\/\s*\d{1,4})?\b/)
  const set = up.match(/\b([A-Z0-9]{3,5})\s*[•·*.-]\s*(EN|DE|FR|IT|ES|JP|PT)\b/) || up.match(/\b([A-Z][A-Z0-9]{2,4})\b(?=\s*(?:[•·*]|EN\b|DE\b))/)
  return { num: num?.[1], set: set?.[1]?.toLowerCase() }
}

// Ein Bild (Video-Frame oder Foto) erkennen. frame = Kartenrahmen relativ zum Bild {x,y,w,h}
export async function recognize(src, sw, sh, frame) {
  const w = await getWorker()
  const sub = (b) => ({ x: frame.x + b.x * frame.w, y: frame.y + b.y * frame.h, w: b.w * frame.w, h: b.h * frame.h })
  const nameImg = crop(src, sw, sh, sub(NAME_BOX))
  const { data: n } = await w.recognize(nameImg)
  const name = cleanName(n.text)
  let info = {}
  try {
    const { data: i } = await w.recognize(crop(src, sw, sh, sub(INFO_BOX), 3))
    info = parseInfo(i.text)
  } catch { /* egal */ }
  return { name, confidence: n.confidence, info }
}

// Erkannten Text bei Scryfall nachschlagen
export async function lookup({ name, info }) {
  if (!name || name.length < 3) return null
  let card = null
  const res = await sfFetch(`${API}/cards/named?fuzzy=${encodeURIComponent(name)}`)
  if (res.ok) card = slimCard(await res.json())
  else {
    // evtl. deutsche Karte
    const alt = await searchCards(name).catch(() => [])
    card = alt[0] || null
  }
  if (!card) return null
  // Exaktes Printing über Set + Nummer, falls lesbar und passend
  if (info?.set && info?.num) {
    const p = await sfFetch(`${API}/cards/${info.set}/${info.num}`)
    if (p.ok) {
      const exact = slimCard(await p.json())
      if (exact.oracleId === card.oracleId) return { card: exact, exact: true }
    }
  }
  return { card, exact: false }
}

export async function printingsOf(card) {
  const res = await sfFetch(`${API}/cards/search?unique=prints&order=released&q=${encodeURIComponent(`oracleid:${card.oracleId}`)}`)
  if (!res.ok) return [card]
  return (await res.json()).data.map(slimCard)
}
