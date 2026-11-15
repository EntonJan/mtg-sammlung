// Sammlung in Firestore speichern: wenige große Dokumente statt tausender Einzeldokumente
// (schneller und spart Lese-/Schreibzugriffe im kostenlosen Firebase-Kontingent).
//
// Datenmodell (pro Nutzer):
//   users/{uid}/collection/meta     { chunks, updatedAt, count }
//   users/{uid}/collection/chunk_N  { items: [ "scryfallId|finish|anzahl", ... ] }
//
// finish = normal | foil | etched. Ein Eintrag = ein Printing in einer Ausführung.
import { doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

const CHUNK = 2500

export const entryKey = (id, finish) => `${id}|${finish}`

export async function loadCollection(uid) {
  const metaSnap = await getDoc(doc(db, 'users', uid, 'collection', 'meta'))
  if (!metaSnap.exists()) return {}
  const { chunks = 0 } = metaSnap.data()
  const snaps = await Promise.all(
    Array.from({ length: chunks }, (_, i) => getDoc(doc(db, 'users', uid, 'collection', `chunk_${i}`)))
  )
  const entries = {}
  for (const s of snaps) {
    for (const raw of s.data()?.items || []) {
      const [id, finish, qty] = raw.split('|')
      const q = Number(qty)
      if (q > 0) entries[entryKey(id, finish)] = { id, finish, qty: q }
    }
  }
  return entries
}

export async function saveCollection(uid, entries, prevChunks = 0) {
  const items = Object.values(entries)
    .filter((e) => e.qty > 0)
    .map((e) => `${e.id}|${e.finish}|${e.qty}`)
  const chunks = Math.ceil(items.length / CHUNK)
  const batch = writeBatch(db)
  for (let i = 0; i < chunks; i++) {
    batch.set(doc(db, 'users', uid, 'collection', `chunk_${i}`), {
      items: items.slice(i * CHUNK, (i + 1) * CHUNK),
    })
  }
  // Überzählige alte Chunks leeren
  for (let i = chunks; i < prevChunks; i++) {
    batch.delete(doc(db, 'users', uid, 'collection', `chunk_${i}`))
  }
  batch.set(doc(db, 'users', uid, 'collection', 'meta'), {
    chunks,
    count: items.length,
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
  return chunks
}
