// Lädt die Commander-Spellbook-Bulkdaten und schreibt eine kompakte combos.json für die App.
// (Die Spellbook-API erlaubt keine Browser-Anfragen von fremden Seiten – deshalb bauen wir die Daten hier vor.)
import { gunzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const out = process.argv[2] || 'dist/data/combos.json'
const res = await fetch('https://backend.commanderspellbook.com/variants.json.gz', {
  headers: { 'User-Agent': 'mtg-sammlung/1.0 (github.com/EntonJan/mtg-sammlung)' },
})
if (!res.ok) { console.error('Spellbook-Download fehlgeschlagen', res.status); process.exit(1) }
const data = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'))
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
