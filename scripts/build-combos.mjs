// Lädt die Commander-Spellbook-Bulkdaten und schreibt eine kompakte combos.json für die App.
// (Die Spellbook-API erlaubt keine Browser-Anfragen von fremden Seiten – deshalb bauen wir die Daten hier vor.)
import { gunzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const out = process.argv[2] || 'dist/data/combos.json'
const URLS = [
  'https://json.commanderspellbook.com/variants.json.gz',
  'https://json.commanderspellbook.com/variants.json',
  'https://backend.commanderspellbook.com/variants.json.gz',
  'https://backend.commanderspellbook.com/variants.json',
]
let buf = null
for (const url of URLS) {
  const res = await fetch(url, { headers: { 'User-Agent': 'mtg-sammlung/1.0 (github.com/EntonJan/mtg-sammlung)' } }).catch((e) => ({ ok: false, status: e.message }))
  console.log(url, res.status)
  if (res.ok) { buf = Buffer.from(await res.arrayBuffer()); break }
}
if (!buf) { console.error('Spellbook-Download fehlgeschlagen'); process.exit(1) }
if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf)
const data = JSON.parse(buf.toString('utf8'))
const variants = data.variants || data

const cards = [], cardIdx = new Map()
const feats = [], featIdx = new Map()
const cardOf = (c) => {
  const key = c.oracleId || c.name
  if (!cardIdx.has(key)) { cardIdx.set(key, cards.length); cards.push([c.name, c.oracleId || '']) }
  return cardIdx.get(key)
}
const featOf = (f) => { if (!featIdx.has(f.name)) { featIdx.set(f.name, feats.length); feats.push(f.name) } return featIdx.get(f.name) }

const combos = []
for (const v of variants) {
  if (v.status && v.status !== 'OK' && v.status !== 'E') continue
  if (v.legalities && v.legalities.commander === false) continue
  if (!v.uses?.length) continue
  combos.push([
    v.id,
    v.uses.map((u) => cardOf(u.card)),
    (v.produces || []).map((p) => featOf(p.feature)),
    v.popularity || 0,
    v.identity || '',
    v.manaValueNeeded || 0,
    v.bracketTag || '',
    v.uses.filter((u) => u.mustBeCommander).map((u) => cardOf(u.card)),
  ])
}
mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true })
writeFileSync(out, JSON.stringify({ v: data.timestamp || new Date().toISOString(), cards, feats, combos }))
console.log(`combos.json: ${combos.length} Combos, ${cards.length} Karten, ${feats.length} Ergebnisse`)
