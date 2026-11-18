// Speichern in Firestore: wenige große Dokumente statt tausender Einzeldokumente
// (schnell und schont das kostenlose Firebase-Kontingent).
//
// Datenmodell (pro Nutzer):
//   users/{uid}/collection/meta     { chunks, updatedAt, count }
//   users/{uid}/collection/chunk_N  { items: [ "scryfallId|finish|anzahl", ... ] }
//   users/{uid}/decks/{deckId}      { name, items: [...], commanders: ["id|finish"], order, createdAt }
//
// „Schrank-Prinzip“: collection = freie Karten. Karten in Decks sind NICHT mehr in collection.
// Besitz gesamt = collection + alle Decks.
import { collection, doc, getDoc, getDocs, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

const CHUNK = 2500

export const entryKey = (id, finish) => `${id}|${finish}`

const toItems = (entries) =>
  Object.values(entries).filter((e) => e.qty > 0).map((e) => `${e.id}|${e.finish}|${e.qty}`)

function fromItems(items = []) {
  const entries = {}
  for (const raw of items) {
    const [id, finish, qty] = raw.split('|')
    const q = Number(qty)
    if (q > 0) entries[entryKey(id, finish)] = { id, finish, qty: q }
  }
  return entries
}

export async function loadCollection(uid) {
  const metaSnap = await getDoc(doc(db, 'users', uid, 'collection', 'meta'))
  if (!metaSnap.exists()) return { entries: {}, chunks: 0 }
  const { chunks = 0 } = metaSnap.data()
  const snaps = await Promise.all(
    Array.from({ length: chunks }, (_, i) => getDoc(doc(db, 'users', uid, 'collection', `chunk_${i}`)))
  )
  return { entries: fromItems(snaps.flatMap((s) => s.data()?.items || [])), chunks }
}

export async function loadDecks(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'decks'))
  const decks = {}
  snap.forEach((d) => {
    const v = d.data()
    decks[d.id] = {
      id: d.id,
      name: v.name || 'Unbenanntes Deck',
      order: v.order ?? 0,
      commanders: v.commanders || [],
      entries: fromItems(v.items),
      tags: v.tags || {},           // oracleId → ["Ramp", …]
      cats: v.cats || null,         // [{ name, target }] – null = Standardkategorien
      pool: v.pool || null,         // Commander-Pool für Partner-Würfel
      side: v.side || [],           // Sideboard (Einträge-Schlüssel)
      kind: v.kind || 'deck',       // 'deck' oder 'binder' (Tauschordner)
      log: v.log || [],             // Änderungsprotokoll [{ t, ch: ['id|finish|delta'] }]
      versions: v.versions || [],   // gemerkte Versionen [{ t, name, items, commanders, side }]
      shareId: v.shareId || null,   // öffentlicher Teilen-Link
      autoShare: !!v.autoShare,     // Link wurde nur für „Freunde sehen meine Decks“ angelegt
      tests: v.tests || [],         // Testspiele [{ at, opponents, result, turns, lives, note }]
    }
  })
  return decks
}

// Speichert Sammlung + geänderte Decks in EINEM Batch,
// damit eine verschobene Karte nie doppelt oder gar nicht gespeichert wird.
export async function saveAll(uid, { entries, prevChunks, decks, dirtyDecks, saveCollection }) {
  const batch = writeBatch(db)
  let chunks = prevChunks
  if (saveCollection) {
    const items = toItems(entries)
    chunks = Math.ceil(items.length / CHUNK)
    for (let i = 0; i < chunks; i++) {
      batch.set(doc(db, 'users', uid, 'collection', `chunk_${i}`), { items: items.slice(i * CHUNK, (i + 1) * CHUNK) })
    }
    for (let i = chunks; i < prevChunks; i++) batch.delete(doc(db, 'users', uid, 'collection', `chunk_${i}`))
    batch.set(doc(db, 'users', uid, 'collection', 'meta'), { chunks, count: items.length, updatedAt: serverTimestamp() })
  }
  for (const id of dirtyDecks) {
    const d = decks[id]
    const ref = doc(db, 'users', uid, 'decks', id)
    if (!d) batch.delete(ref)
    else batch.set(ref, {
      name: d.name,
      order: d.order,
      commanders: d.commanders,
      items: toItems(d.entries),
      tags: d.tags || {},
      cats: d.cats || null,
      pool: d.pool || null,
      side: d.side || [],
      kind: d.kind || 'deck',
      log: (d.log || []).slice(-300),
      versions: (d.versions || []).slice(-20),
      shareId: d.shareId || null,
      autoShare: !!d.autoShare,
      tests: (d.tests || []).slice(-100),
      updatedAt: serverTimestamp(),
    })
  }
  await batch.commit()
  return chunks
}

export { toItems, fromItems }

export function newDeckId() {
  return doc(collection(db, '_')).id
}


// Wertverlauf: ein Punkt pro Tag in users/{uid}/meta/history
export async function loadHistory(uid) {
  const snap = await getDoc(doc(db, 'users', uid, 'meta', 'history'))
  return snap.exists() ? snap.data().days || {} : {}
}

export async function saveHistoryPoint(uid, day, point) {
  await setDoc(doc(db, 'users', uid, 'meta', 'history'), { days: { [day]: point } }, { merge: true })
}

// Allgemeine Nutzerdaten (Wunschliste, Tauschordner …) in users/{uid}/meta/{name}
export async function loadMeta(uid, name) {
  const snap = await getDoc(doc(db, 'users', uid, 'meta', name))
  return snap.exists() ? snap.data() : null
}

export async function saveMeta(uid, name, data) {
  await setDoc(doc(db, 'users', uid, 'meta', name), { ...data, updatedAt: serverTimestamp() })
}
