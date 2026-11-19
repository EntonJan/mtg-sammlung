// Online-Spieltisch mit Freunden (Firestore, in Echtzeit)
//   tables/{id}                 – Tisch: host, players[], invited[], names{}, order[], status, phase, active, turn
//   tables/{id}/seats/{uid}     – öffentlich: Leben, Gift, Commander-Schaden, Spielfeld, Friedhof, Exil, Commander-Zone, Anzahl Hand/Bibliothek
//   tables/{id}/private/{uid}   – nur für den Spieler selbst: Hand + Bibliothek (Reihenfolge)
//   tables/{id}/events/{auto}   – Protokoll
import { addDoc, arrayUnion, collection, doc, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { db } from './firebase'

// Vorerst nur für ausgewählte Konten sichtbar (Freigabe: Liste leeren bzw. BETA_ALL = true)
const BETA = ['PrdaC79h4fSdqXQhdku5oEhzy3F2']
const BETA_ALL = false
export const tablesBeta = (uid) => BETA_ALL || BETA.includes(uid) || (typeof localStorage !== 'undefined' && localStorage.getItem('pt-beta') === '1')

const clean = (v) => JSON.parse(JSON.stringify(v ?? null)) // Firestore mag kein undefined

export async function createTable(me, myName, invited, names) {
  const ref = doc(collection(db, 'tables'))
  await setDoc(ref, {
    host: me, players: [me], invited, names: { ...names, [me]: myName }, order: [me],
    status: 'lobby', phase: 'lobby', active: null, turn: 1, createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function joinTable(id, me, myName) {
  await updateDoc(doc(db, 'tables', id), { players: arrayUnion(me), order: arrayUnion(me), [`names.${me}`]: myName })
}

// Platz anlegen/neu setzen: öffentlicher Teil + private Hand/Bibliothek
export async function writeSeat(id, uid, pub, priv) {
  const b = writeBatch(db)
  b.set(doc(db, 'tables', id, 'seats', uid), clean(pub))
  b.set(doc(db, 'tables', id, 'private', uid), clean(priv))
  await b.commit()
}

export const updateTable = (id, patch) => updateDoc(doc(db, 'tables', id), clean(patch))
export const updateSeat = (id, uid, patch) => updateDoc(doc(db, 'tables', id, 'seats', uid), clean(patch))
export const setPrivate = (id, uid, data) => setDoc(doc(db, 'tables', id, 'private', uid), clean(data))
export const addEvent = (id, by, msg, t) => addDoc(collection(db, 'tables', id, 'events'), { by, msg, t, at: Date.now() })
export const getTable = async (id) => { const s = await getDoc(doc(db, 'tables', id)); return s.exists() ? { id, ...s.data() } : null }

// Meine Tische (als Spieler) und Einladungen – Status wird im Browser gefiltert (kein Index nötig)
export function watchMyTables(uid, cb) {
  const res = { mine: [], inv: [] }
  const emit = () => cb({ mine: res.mine, inv: res.inv.filter((t) => !t.players.includes(uid)) })
  const map = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => t.status !== 'ended')
  const a = onSnapshot(query(collection(db, 'tables'), where('players', 'array-contains', uid)), (s) => { res.mine = map(s); emit() }, () => {})
  const b = onSnapshot(query(collection(db, 'tables'), where('invited', 'array-contains', uid)), (s) => { res.inv = map(s); emit() }, () => {})
  return () => { a(); b() }
}

// Alles zu einem Tisch live beobachten
export function watchTable(id, me, cb) {
  const st = { table: null, seats: {}, priv: null, events: [] }
  const emit = () => cb({ ...st })
  const subs = [
    onSnapshot(doc(db, 'tables', id), (s) => { st.table = s.exists() ? { id, ...s.data() } : null; emit() }),
    onSnapshot(collection(db, 'tables', id, 'seats'), (s) => { st.seats = Object.fromEntries(s.docs.map((d) => [d.id, d.data()])); emit() }),
    onSnapshot(doc(db, 'tables', id, 'private', me), (s) => { st.priv = s.exists() ? s.data() : null; emit() }),
    onSnapshot(query(collection(db, 'tables', id, 'events'), orderBy('at', 'desc'), limit(120)), (s) => { st.events = s.docs.map((d) => d.data()).reverse(); emit() }),
  ]
  return () => subs.forEach((u) => u())
}
