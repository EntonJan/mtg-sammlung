// Freunde: Benutzernamen, Profile mit Freigaben, Freundschaftsanfragen
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import { db } from './firebase'

export const NAME_RE = /^[A-Za-z0-9ÄÖÜäöüß_.-]{3,20}$/

export async function loadProfile(uid) {
  const s = await getDoc(doc(db, 'profiles', uid))
  return s.exists() ? s.data() : null
}

export async function claimName(uid, name) {
  const lower = name.toLowerCase()
  const taken = await getDoc(doc(db, 'usernames', lower))
  if (taken.exists() && taken.data().uid !== uid) throw new Error('Dieser Name ist schon vergeben.')
  const old = await loadProfile(uid)
  const batch = writeBatch(db)
  if (old?.nameLower && old.nameLower !== lower) batch.delete(doc(db, 'usernames', old.nameLower))
  batch.set(doc(db, 'usernames', lower), { uid, name })
  batch.set(doc(db, 'profiles', uid), { ...(old || {}), name, nameLower: lower, updatedAt: serverTimestamp() })
  await batch.commit()
}

export async function saveProfileShares(uid, shares) {
  const old = await loadProfile(uid)
  if (!old) return
  await setDoc(doc(db, 'profiles', uid), { ...old, shares, updatedAt: serverTimestamp() })
}

export async function findUser(name) {
  const s = await getDoc(doc(db, 'usernames', name.trim().toLowerCase()))
  return s.exists() ? s.data() : null
}

// Eigene Liste live beobachten: { [otherUid]: { status: 'in'|'out'|'friend', name } }
export function watchFriends(uid, cb) {
  return onSnapshot(collection(db, 'friends', uid, 'list'), (snap) => {
    const out = {}
    snap.forEach((d) => { out[d.id] = d.data() })
    cb(out)
  }, () => cb({}))
}

export async function sendRequest(me, other) {
  const batch = writeBatch(db)
  batch.set(doc(db, 'friends', me.uid, 'list', other.uid), { status: 'out', name: other.name, at: serverTimestamp() })
  batch.set(doc(db, 'friends', other.uid, 'list', me.uid), { status: 'in', name: me.name, at: serverTimestamp() })
  await batch.commit()
}

export async function acceptRequest(me, otherUid, otherName) {
  const batch = writeBatch(db)
  batch.set(doc(db, 'friends', me.uid, 'list', otherUid), { status: 'friend', name: otherName, at: serverTimestamp() })
  batch.set(doc(db, 'friends', otherUid, 'list', me.uid), { status: 'friend', name: me.name, at: serverTimestamp() })
  await batch.commit()
}

export async function removeFriend(myUid, otherUid) {
  await Promise.all([
    deleteDoc(doc(db, 'friends', myUid, 'list', otherUid)),
    deleteDoc(doc(db, 'friends', otherUid, 'list', myUid)).catch(() => {}),
  ])
}

export async function listAll(uid) {
  const s = await getDocs(collection(db, 'friends', uid, 'list'))
  return s.docs.map((d) => ({ uid: d.id, ...d.data() }))
}
