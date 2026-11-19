// Gemeinsame Bausteine für Testspiel (lokal) und Online-Spieltisch
import { entryKey } from './store'

export const ZONES = { lib: 'Bibliothek', hand: 'Hand', bf: 'Spielfeld', gy: 'Friedhof', ex: 'Exil', cmd: 'Commander-Zone' }
export const isLand = (c) => /\bLand\b/.test((c.type || '').split(' // ')[0])
export const isCreature = (c) => /\bCreature\b/.test((c.type || '').split(' // ')[0])
export const isDfc = (c) => / \/\/ /.test(c.type || '') && /cards\.scryfall\.io\/[a-z]+\/front\//.test(c.img || '')
export const backImg = (img) => img.replace('/front/', '/back/')

export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

// Zufällige IDs – bleiben auch nach Neuladen (Online-Tisch) eindeutig
export const nextUid = () => 'c' + Math.random().toString(36).slice(2, 10)
export const inst = (c, extra = {}) => ({ uid: nextUid(), name: c.name, img: c.img || '', type: c.type || '', cmc: c.cmc ?? 0, tapped: false, ctr: {}, flip: false, ...extra })

// Deck → { name, cmd:[card], main:[card] } (Karten nach Anzahl aufgefächert)
export function fromOwnDeck(d, cards) {
  const side = new Set(d.side || []), cmd = new Set(d.commanders || [])
  const out = { name: d.name, cmd: [], main: [] }
  for (const e of Object.values(d.entries || {})) {
    const c = cards[e.id]; const k = entryKey(e.id, e.finish)
    if (!c || side.has(k)) continue
    if (cmd.has(k)) { out.cmd.push(c); continue }
    for (let i = 0; i < e.qty; i++) out.main.push(c)
  }
  return out
}
export function fromShare(s) {
  const out = { name: s.name, cmd: [], main: [] }
  for (const r of s.rows || []) {
    const c = { name: r.n, img: r.i, type: r.t, cmc: r.m }
    if (r.z === 'side') continue
    if (r.z === 'cmd') { out.cmd.push(c); continue }
    for (let i = 0; i < r.q; i++) out.main.push(c)
  }
  return out
}

// ---------- Gegner-Bot ----------
// Einfacher „Druck-Simulator“: legt ein Land, wirkt nach Manakurve, greift mit allem an, was nicht frisch ist.
// Kartentexte versteht er nicht – Ziele, Trigger und Blocks entscheidest du selbst.
export const ROCK = /^(Sol Ring|Mana Crypt|Mana Vault|Arcane Signet|Fellwar Stone|Mind Stone|Thought Vessel|Commander's Sphere|Coldsteel Heart|Talisman of .*|.* Signet|Chromatic Lantern|Gilded Lotus|Worn Powerstone|Hedron Archive|Thran Dynamo|Basalt Monolith|Grim Monolith|Everflowing Chalice|Wayfarer's Bauble)$/
export const rockMana = (c) => (/^(Sol Ring|Mana Crypt|Worn Powerstone|Hedron Archive|Mana Vault)$/.test(c.name) ? 2 : /^(Gilded Lotus|Thran Dynamo|Basalt Monolith|Grim Monolith)$/.test(c.name) ? 3 : 1)
export const isPermanent = (c) => !/\b(Instant|Sorcery)\b/.test((c.type || '').split(' // ')[0])
export const landCount = (h) => h.filter((c) => isLand(c)).length
export function botKeep(p) {
  // Starthand: 2–5 Länder behalten, sonst bis zu zwei Mulligans
  while (p.mulls < 2) {
    const l = landCount(p.z.hand)
    if (l >= 2 && l <= 5) break
    p.z.lib = shuffle([...p.z.lib, ...p.z.hand]); p.z.hand = p.z.lib.splice(0, 7); p.mulls++
  }
  if (p.mulls > 1) { // pro Mulligan nach dem ersten eine Karte unter die Bibliothek (teuerste zuerst)
    const sorted = [...p.z.hand].sort((a, b) => (b.cmc || 0) - (a.cmc || 0))
    for (const c of sorted.slice(0, p.mulls - 1)) { p.z.hand.splice(p.z.hand.indexOf(c), 1); p.z.lib.push(c) }
  }
  p.kept = true
}

export function newPlayer(id, label, src) {
  const lib = shuffle(src.main.map((c) => inst(c)))
  return {
    id, label, deck: src.name, life: 40, poison: 0, cmdDmg: {}, tax: {},
    z: { lib: lib.slice(7), hand: lib.slice(0, 7), bf: [], gy: [], ex: [], cmd: src.cmd.map((c) => inst(c, { isCmd: true })) },
    showHand: id === 0, mulls: 0, kept: false, names: [...new Set([...src.main, ...src.cmd].map((c) => c.name))],
  }
}

