// Räume für den Spieltisch (gleiches Datenmodell wie in der MTG Lounge, ergänzt um Einladungen)
//   arena_rooms/{id}                    – host, players[], invited[], maxPlayers, playerInfo{uid:{name,deckId,deckName,commanderName}}, seatOrder, stack, combat, …
//   arena_rooms/{id}/game_state/{uid}   – Zustand eines Spielers
//   arena_rooms/{id}/log/{entry}        – Spielprotokoll { at, uid, name, text, cards?, kind? }
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore'
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
  if (!rest.length) { await deleteLog(id); await deleteDoc(ref).catch(() => updateDoc(ref, { players: [], playerInfo: {}, emptyAt: Date.now() }).catch(() => {})) }
  else {
    // war ich am Zug, geht der Zug an den nächsten anwesenden Spieler
    const patch = { players: rest, playerInfo: pi, invited: (r.invited || []).filter((p) => p !== me) }
    if (r.activePlayer === me && Array.isArray(r.seatOrder)) {
      const i = r.seatOrder.indexOf(me)
      for (let k = 1; k <= r.seatOrder.length; k++) { const c = r.seatOrder[(i + k) % r.seatOrder.length]; if (rest.includes(c)) { patch.activePlayer = c; break } }
      // Neuer Zug für den Nachfolger (Enttappen → Versorgung → Ziehen); mein Kampf und Haltebitten enden
      if (patch.activePlayer) {
        patch.phase = { step: 'untap', turn: (r.phase?.turn || 0) + 1, player: patch.activePlayer, at: Date.now() }
        patch.hold = null
        if (r.combat) patch.combat = null
      }
    }
    if (r.hold?.uid === me) patch.hold = null
    await updateDoc(ref, patch)
  }
}

// Protokolleinträge löschen (solange ich noch Mitspieler bin – die Regeln prüfen die Spielerliste des Raums)
async function deleteLog(id) {
  try { const lg = await getDocs(collection(db, 'arena_rooms', id, 'log')); await Promise.all(lg.docs.map((d) => deleteDoc(d.ref))) } catch (e) { console.warn(e) }
}

// Tisch auflösen (Gastgeber): erst alle Spielzustände und das Protokoll, dann den Raum löschen
export async function cancelRoom(id) {
  try { const st = await getDocs(collection(db, 'arena_rooms', id, 'game_state')); await Promise.all(st.docs.map((d) => deleteDoc(d.ref))) } catch (e) { console.warn(e) }
  await deleteLog(id)
  await deleteDoc(doc(db, 'arena_rooms', id))
}

// Mit den Anwesenden beginnen, wenn nicht alle Eingeladenen kommen
export async function startNow(id) {
  const ref = doc(db, 'arena_rooms', id)
  const r = (await getDoc(ref)).data()
  // Einladungen der Fehlenden zurücknehmen, damit sie keinen vollen Tisch mehr angeboten bekommen
  await updateDoc(ref, { maxPlayers: r.players.length, invited: (r.invited || []).filter((p) => r.players.includes(p)) })
}

// Meine Tische und Einladungen
export function watchRooms(uid, cb) {
  const res = { mine: [], inv: [] }
  const emit = () => cb({ mine: res.mine, inv: res.inv.filter((r) => !r.players.includes(uid) && r.players.length < (r.maxPlayers || 2)) })
  const map = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))
  try {
    const a = onSnapshot(query(collection(db, 'arena_rooms'), where('players', 'array-contains', uid)), (s) => { res.mine = map(s); emit() }, () => {})
    const b = onSnapshot(query(collection(db, 'arena_rooms'), where('invited', 'array-contains', uid)), (s) => { res.inv = map(s); emit() }, () => {})
    return () => { a(); b() }
  } catch { return () => {} } // z. B. Demo ohne Firebase
}
