// Lädt die Commander-Spellbook-Bulkdaten und schreibt eine kompakte combos.json für die App.
// (Die Spellbook-API erlaubt keine Browser-Anfragen von fremden Seiten – deshalb bauen wir die Daten hier vor.)
import { createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { parser } = require('stream-json')
const { pick } = require('stream-json/filters/Pick')
const { streamArray } = require('stream-json/streamers/StreamArray')
import { mkdirSync, writeFileSync } from 'node:fs'

const out = process.argv[2] || 'dist/data/combos.json'
const URLS = [
  'https://json.commanderspellbook.com/variants.json.gz',
  'https://json.commanderspellbook.com/variants.json',
  'https://backend.commanderspellbook.com/variants.json.gz',
  'https://backend.commanderspellbook.com/variants.json',
]
let res = null, gz = false
for (const url of URLS) {
  const r = await fetch(url, { headers: { 'User-Agent': 'mtg-sammlung/1.0 (github.com/EntonJan/mtg-sammlung)' } }).catch((e) => ({ ok: false, status: e.message }))
  console.log(url, r.status)
  if (r.ok) { res = r; gz = url.endsWith('.gz'); break }
}
if (!res) { console.error('Spellbook-Download fehlgeschlagen'); process.exit(1) }
// Die Datei ist mehrere hundert MB groß → als Strom verarbeiten statt komplett einzulesen
let src = Readable.fromWeb(res.body)
if (gz && !(res.headers.get('content-encoding') || '').includes('gzip')) src = src.pipe(createGunzip())
const stream = src.pipe(parser()).pipe(pick({ filter: 'variants' })).pipe(streamArray())
const data = { timestamp: new Date().toISOString() }
const cards = [], cardIdx = new Map()
const feats = [], featIdx = new Map()
const cardOf = (c) => {
  const key = c.oracleId || c.name
  if (!cardIdx.has(key)) {
    cardIdx.set(key, cards.length)
    const img = (c.imageUriFrontSmall || '').replace('https://cards.scryfall.io/small/front/', '')
    cards.push([c.name, c.oracleId || '', img])
  }
  return cardIdx.get(key)
}
const featOf = (f) => { if (!featIdx.has(f.name)) { featIdx.set(f.name, feats.length); feats.push(f.name) } return featIdx.get(f.name) }

const combos = []
for await (const { value: v } of stream) {
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
