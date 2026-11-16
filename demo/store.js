import { DECKS, FOILS, FREE_CARDS, WISHLIST, slug } from './data'

export const entryKey = (id, finish) => `${id}|${finish}`
export const toItems = (entries) => Object.values(entries).filter((e) => e.qty > 0).map((e) => `${e.id}|${e.finish}|${e.qty}`)
export const fromItems = (items = []) => { const o = {}; for (const s of items) { const [id, finish, q] = s.split('|'); o[`${id}|${finish}`] = { id, finish, qty: Number(q) } } return o }
const ent = (list) => { const o = {}; for (const [n, q] of list) { const id = slug(n), f = FOILS.has(n) ? 'foil' : 'normal'; o[`${id}|${f}`] = { id, finish: f, qty: q } } return o }

export async function loadCollection() { return { entries: ent(FREE_CARDS), chunks: 1 } }
export async function loadDecks() {
  const out = {}
  DECKS.forEach((d, i) => {
    const entries = ent([...d.list, ...(d.side || []).map((n) => [n, 1])])
    const cmd = d.commander ? [`${slug(d.commander)}|${FOILS.has(d.commander) ? 'foil' : 'normal'}`] : []
    const day = 864e5, now = Date.now()
    out[d.id] = {
      id: d.id, name: d.name, order: i, commanders: cmd, entries, tags: {}, cats: null, pool: null,
      side: (d.side || []).map((n) => `${slug(n)}|normal`), kind: d.kind || 'deck', shareId: null,
      versions: d.id === 'atraxa' ? [{ t: now - 6 * day, name: 'Vor dem Spieleabend', items: toItems(entries).filter((s) => !s.startsWith('the-ozolith')), commanders: cmd, side: [] }] : [],
      log: d.id === 'atraxa' ? [
        { t: now - 5 * day, ch: ['the-ozolith|normal|1', 'kaya-the-inexorable|normal|1'] },
        { t: now - 2 * day, ch: ['bloated-contaminator|normal|1', 'mulldrifter|normal|-1'] },
        { t: now - 2 * day + 3e6, ch: ['mulldrifter|normal|1'] },
      ] : [],
    }
  })
  return out
}
let n = 0
export const newDeckId = () => 'demo' + (++n)
export const saveAll = async (uid, p) => p.prevChunks
export async function loadHistory() {
  const out = {}, base = 2350
  for (let i = 45; i >= 1; i--) {
    const d = new Date(Date.now() - i * 864e5).toLocaleDateString('sv-SE')
    out[d] = { total: Math.round((base + (45 - i) * 9 + Math.sin(i / 3) * 60) * 100) / 100 }
  }
  return out
}
export const saveHistoryPoint = async () => {}
const meta = { wishlist: { items: WISHLIST.map((n, i) => ({ id: slug(n), finish: 'normal', target: i === 1 ? 40 : null, added: Date.now() - i * 864e5 })) }, friends: { wishlist: true, binders: true } }
export const loadMeta = async (uid, k) => meta[k] || null
export const saveMeta = async (uid, k, v) => { meta[k] = v }
