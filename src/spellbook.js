// Combos (Daten von Commander Spellbook, täglich beim Deploy vorbereitet) + Bracket-Einschätzung – alles lokal berechnet
import { get, set } from 'idb-keyval'
import { sfFetch } from './scryfall'

const KEY = 'combos-v2'
let dbP = null

async function loadDb() {
  if (!dbP) {
    dbP = (async () => {
      const cached = await get(KEY)
      if (cached && Date.now() - cached.at < 864e5) return index(cached.data)
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}data/combos.json`, { cache: 'no-cache' })
        if (!res.ok) throw new Error(res.status)
        const data = await res.json()
        await set(KEY, { at: Date.now(), data })
        return index(data)
      } catch (e) {
        if (cached) return index(cached.data)
        dbP = null
        throw new Error('Die Combo-Daten konnten nicht geladen werden.', { cause: e })
      }
    })()
  }
  return dbP
}

function index(data) {
  const byCard = new Map()
  data.combos.forEach((c, i) => { for (const ci of c[1]) { const k = data.cards[ci][1] || data.cards[ci][0]; if (!byCard.has(k)) byCard.set(k, []); byCard.get(k).push(i) } })
  return { ...data, byCard }
}

// Bild direkt vom Scryfall-CDN (zählt nicht gegen das API-Limit); Fallback über den Namen
const img = (name, path) => path ? (path.startsWith('http') ? path : `https://cards.scryfall.io/small/front/${path}`) : `https://api.scryfall.com/cards/named?format=image&version=small&exact=${encodeURIComponent(name)}`

function toVariant(db, c) {
  return {
    id: c[0],
    uses: c[1].map((ci) => { const [name, oid, path] = db.cards[ci]; return { card: { id: oid || name, name, oracleId: oid, imageUriFrontSmall: img(name, path) } } }),
    produces: c[2].map((fi) => ({ feature: { id: fi, name: db.feats[fi] } })),
    popularity: c[3], identity: c[4], manaValueNeeded: c[5], bracketTag: c[6],
  }
}

const within = (identity, deckCi) => [...(identity || '')].every((ch) => ch === 'C' || deckCi.has(ch))

// cards: [{ name, oracleId, ci }] – Commander + Hauptdeck
export async function findCombos(commanders, rows) {
  const db = await loadDb()
  const all = [...commanders, ...rows.map((r) => r.card)]
  const have = new Set(all.map((c) => c.oracleId || c.name))
  const deckCi = new Set(commanders.flatMap((c) => c.ci || []))
  const seen = new Set(), included = [], almost = []
  for (const k of have) {
    for (const i of db.byCard.get(k) || []) {
      if (seen.has(i)) continue
      seen.add(i)
      const c = db.combos[i]
      const missing = c[1].filter((ci) => !have.has(db.cards[ci][1] || db.cards[ci][0])).length
      if (missing === 0) included.push(c)
      else if (missing === 1 && (!commanders.length || within(c[4], deckCi))) almost.push(c)
    }
  }
  const byPop = (a, b) => b[3] - a[3]
  return { included: included.sort(byPop).map((c) => toVariant(db, c)), almost: almost.sort(byPop).slice(0, 300).map((c) => toVariant(db, c)) }
}

// Game Changer laut Scryfall (offizielle Liste), wöchentlich aufgefrischt
const GC_KEY = 'gamechangers-v1'
async function gameChangers() {
  const cached = await get(GC_KEY)
  if (cached && Date.now() - cached.at < 7 * 864e5) return new Set(cached.ids)
  try {
    const ids = []
    let url = 'https://api.scryfall.com/cards/search?q=is%3Agamechanger&unique=cards'
    while (url) {
      const r = await sfFetch(url)
      if (!r.ok) break
      const j = await r.json()
      ids.push(...j.data.map((c) => c.oracle_id))
      url = j.has_more ? j.next_page : null
    }
    if (ids.length) await set(GC_KEY, { at: Date.now(), ids })
    return new Set(ids)
  } catch { return new Set(cached?.ids || []) }
}

const MLD = /destroy all lands|destroy all nonbasic lands|each player sacrifices (all|\w+) lands|return all lands|exile all lands|lands don.t untap|destroy all permanents/i
const EXTRA = /take an extra turn|extra turn after this one/i

export async function estimateBracket(commanders, rows) {
  const [gc, combos] = await Promise.all([gameChangers(), findCombos(commanders, rows).catch(() => ({ included: [] }))])
  const all = [...commanders.map((c) => ({ card: c })), ...rows]
  const flag = (r) => ({ card: { name: r.card.name }, quantity: r.qty || 1, gameChanger: gc.has(r.card.oracleId), banned: r.card.legalCmd === 'banned', massLandDenial: MLD.test(r.card.text || ''), extraTurn: EXTRA.test(r.card.text || '') })
  const cards = all.map(flag).filter((c) => c.gameChanger || c.banned || c.massLandDenial || c.extraTurn)
  const two = combos.included.filter((v) => v.uses.length === 2)
  return { cards, combos: two.map((v) => ({ combo: v, relevant: true, definitelyTwoCard: true })) }
}

export const comboUrl = (id) => `https://commanderspellbook.com/combo/${id}/`
