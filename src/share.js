// Öffentliche Nur-Lesen-Links: shares/{id} (Kopf) + shares/{id}/parts/p{n} (Karten in Paketen)
import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { unitPrice } from './util'

const PART = 1500
export const newShareId = () => doc(collection(db, 'shares')).id
export const shareUrl = (id) => `https://entonjan.github.io/mtg-sammlung/?s=${id}`

// Kompakte Zeile je Karte (Firestore erlaubt keine verschachtelten Arrays → Objekte mit Kurz-Schlüsseln)
export function shareRows(list, cards, zoneOf = () => 'main') {
  const out = []
  for (const e of list) {
    const c = cards[e.id]
    if (!c) continue
    out.push({
      n: c.name, s: c.set, c: c.num, f: e.finish, q: e.qty, p: unitPrice(c, e.finish) ?? null,
      i: c.img || '', t: c.type || '', m: c.cmc ?? 0, o: c.oracleId || '', z: zoneOf(e),
    })
  }
  return out
}

export async function publishShare(uid, id, { kind, name, rows, extra = {} }) {
  const prev = await getDoc(doc(db, 'shares', id)).catch(() => null)
  const prevParts = prev?.exists() ? prev.data().parts || 0 : 0
  const parts = Math.max(1, Math.ceil(rows.length / PART))
  const batch = writeBatch(db)
  batch.set(doc(db, 'shares', id), {
    owner: uid, kind, name, parts,
    count: rows.reduce((s, r) => s + r.q, 0),
    value: rows.reduce((s, r) => s + (r.p || 0) * r.q, 0),
    updatedAt: serverTimestamp(), ...extra,
  })
  for (let i = 0; i < parts; i++) batch.set(doc(db, 'shares', id, 'parts', `p${i}`), { rows: rows.slice(i * PART, (i + 1) * PART) })
  for (let i = parts; i < prevParts; i++) batch.delete(doc(db, 'shares', id, 'parts', `p${i}`))
  await batch.commit()
}

export async function deleteShare(id) {
  const head = await getDoc(doc(db, 'shares', id))
  const batch = writeBatch(db)
  const n = head.exists() ? head.data().parts || 0 : 0
  for (let i = 0; i < n; i++) batch.delete(doc(db, 'shares', id, 'parts', `p${i}`))
  batch.delete(doc(db, 'shares', id))
  await batch.commit()
}

export async function loadShare(id) {
  const head = await getDoc(doc(db, 'shares', id))
  if (!head.exists()) return null
  const parts = await getDocs(collection(db, 'shares', id, 'parts'))
  const rows = []
  parts.docs.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))).forEach((p) => rows.push(...(p.data().rows || [])))
  return { id, ...head.data(), rows }
}
