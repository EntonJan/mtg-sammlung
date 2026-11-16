export const NAME_RE = /^[A-Za-z0-9ÄÖÜäöüß_.-]{3,20}$/
const W = window
W.__fr = { profiles: { demo: { name: 'Enton', nameLower: 'enton', shares: {} }, max: { name: 'Max', shares: { wishlist: 'mw', binders: [{ id: 'mb', name: 'Tausch' }] } } }, names: {}, lists: { demo: { max: { status: 'friend', name: 'Max' }, lena: { status: 'in', name: 'Lena' } } } }
const row = (n, s, c, p, o) => ({ n, s, c, f: 'normal', q: 1, p, i: `https://api.scryfall.com/cards/named?format=image&version=normal&exact=${encodeURIComponent(n)}`, o })
localStorage.setItem('share-mw', JSON.stringify({ id: 'mw', kind: 'wishlist', name: 'Wunschliste', count: 3, value: 0, rows: [row('Demonic Tutor', 'uma', '93', 25, 'dt'), row('Dockside Extortionist', 'c19', '24', 40, 'dock'), row('Skullclamp', 'c20', '252', 3, 'skull')] }))
localStorage.setItem('share-mb', JSON.stringify({ id: 'mb', kind: 'binder', name: 'Tausch', count: 2, value: 60, rows: [row('Ancient Tomb', 'uma', '236', 55, 'tomb'), row('Chromatic Lantern', 'c21', '237', 5, 'lantern')] }))
const subs = []
const emit = (uid) => subs.filter((s) => s.uid === uid).forEach((s) => s.cb({ ...(W.__fr.lists[uid] || {}) }))
export const loadProfile = async (uid) => W.__fr.profiles[uid] || null
export async function claimName(uid, name) { W.__fr.profiles[uid] = { ...(W.__fr.profiles[uid] || {}), name } }
export async function saveProfileShares(uid, shares) { W.__fr.profiles[uid] = { ...W.__fr.profiles[uid], shares } }
export const findUser = async () => null
export function watchFriends(uid, cb) { const s = { uid, cb }; subs.push(s); setTimeout(() => cb({ ...(W.__fr.lists[uid] || {}) }), 0); return () => subs.splice(subs.indexOf(s), 1) }
const setL = (a, b, v) => { (W.__fr.lists[a] ||= {})[b] = v; emit(a) }
export async function sendRequest(me, o) { setL(me.uid, o.uid, { status: 'out', name: o.name }) }
export async function acceptRequest(me, ou, on) { setL(me.uid, ou, { status: 'friend', name: on }) }
export async function removeFriend(a, b) { delete (W.__fr.lists[a] || {})[b]; emit(a) }
