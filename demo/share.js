const unitPrice = (c, f) => (f === 'foil' ? c.eurFoil ?? c.eur : c.eur) ?? null
let n = 0
export const newShareId = () => 'sh' + (++n) + Date.now()
export const shareUrl = (id) => `https://entonjan.github.io/mtg-sammlung/demo/?s=${id}`
export function shareRows(list, cards, zoneOf = () => 'main') {
  return list.filter((e) => cards[e.id]).map((e) => { const c = cards[e.id]; return { n: c.name, s: c.set, c: c.num, f: e.finish, q: e.qty, p: unitPrice(c, e.finish), i: c.img, t: c.type, m: c.cmc, o: c.oracleId, z: zoneOf(e) } })
}
export async function publishShare(uid, id, { kind, name, rows }) {
  localStorage.setItem('share-' + id, JSON.stringify({ id, owner: uid, kind, name, rows, count: rows.reduce((s, r) => s + r.q, 0), value: rows.reduce((s, r) => s + (r.p || 0) * r.q, 0) }))
  ;(window.__published ||= []).push(id)
}
export async function deleteShare(id) { localStorage.removeItem('share-' + id) }
export async function loadShare(id) { const v = localStorage.getItem('share-' + id); return v ? JSON.parse(v) : null }
