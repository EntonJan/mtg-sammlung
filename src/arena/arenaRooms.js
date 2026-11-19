// Räume für den Spieltisch (gleiches Datenmodell wie in der MTG Lounge, ergänzt um Einladungen)
//   arena_rooms/{id}                    – host, players[], invited[], maxPlayers, playerInfo{uid:{name,deckId,deckName,commanderName}}, seatOrder, stack, combat, …
//   arena_rooms/{id}/game_state/{uid}   – Zustand eines Spielers
import { collection, deleteDoc, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase'

// Vorerst nur für ausgewählte Konten (Freigabe: ARENA_ALL = true)
const BETA = ['PrdaC79h4fSdqXQhdku5oEhzy3F2']
const ARENA_ALL = false
export const arenaBeta = (uid) => ARENA_ALL || BETA.includes(uid) || (typeof localStorage !== 'undefined' && localStorage.getItem('pt-beta') === '1')

const info = (name, deck, cmd) => ({ name, deckId: deck.id, deckName: deck.name, commanderName: cmd || '' })

export async function createRoom(me, name, deck, cmd, invited) {
  const ref = doc(collection(db, 'arena_rooms'))
  await setDoc(ref, {
    host: me, hostName: name, players: [me], invited, maxPlayers: invited.length + 1,
    createdAt: Date.now(), emptyAt: null, playerInfo: { [me]: info(name, deck, cmd) },
  })
  return ref.id
}

export async function joinRoom(id, me, name, deck, cmd) {
  const ref = doc(db, 'arena_rooms', id)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Der Tisch existiert nicht mehr.')
  const r = snap.data()
  if (r.players.includes(me)) return
  if (r.players.length >= (r.maxPlayers || 2)) throw new Error('Der Tisch ist schon voll.')
  await updateDoc(ref, { players: [...r.players, me], emptyAt: null, [`playerInfo.${me}`]: info(name, deck, cmd) })
}

// Tisch verlassen: eigenen Zustand löschen, aus der Spielerliste austragen; der Letzte räumt den Tisch weg
export async function leaveRoom(id, me) {
  try { await deleteDoc(doc(db, 'arena_rooms', id, 'game_state', me)) } catch (e) { console.warn(e) }
  const ref = doc(db, 'arena_rooms', id)
  const snap = await getDoc(ref).catch(() => null)
  if (!snap?.exists()) return
  const r = snap.data()
  const rest = r.players.filter((p) => p !== me)
  const pi = { ...(r.playerInfo || {}) }; delete pi[me]
  if (!rest.length) { await deleteDoc(ref).catch(() => updateDoc(ref, { players: [], playerInfo: {}, emptyAt: Date.now() })) }
  else await updateDoc(ref, { players: rest, playerInfo: pi, invited: (r.invited || []).filter((p) => p !== me) })
}

export async function cancelRoom(id) { await deleteDoc(doc(db, 'arena_rooms', id)) }

// Meine Tische und Einladungen
export function watchRooms(uid, cb) {
  const res = { mine: [], inv: [] }
  const emit = () => cb({ mine: res.mine, inv: res.inv.filter((r) => !r.players.includes(uid)) })
  const map = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))
  try {
    const a = onSnapshot(query(collection(db, 'arena_rooms'), where('players', 'array-contains', uid)), (s) => { res.mine = map(s); emit() }, () => {})
    const b = onSnapshot(query(collection(db, 'arena_rooms'), where('invited', 'array-contains', uid)), (s) => { res.inv = map(s); emit() }, () => {})
    return () => { a(); b() }
  } catch { return () => {} } // z. B. Demo ohne Firebase
}
