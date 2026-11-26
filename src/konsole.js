// Konsole + Module: ein Core-Deck (kind 'core') mit austauschbaren Modulen (kind 'module', coreId).
// Es steckt immer höchstens ein Modul im Slot (core.activeModule). Core + Modul = ein Commander-Deck.
//
// Sammlungs-Rechnung („Schrank“): collection = freie Exemplare, Besitz = frei + in Decks gehalten.
// Normale Decks/Ordner halten ihre Exemplare einzeln (Summe). Module derselben Konsole sind Alternativen –
// es wird nur eins gespielt. Deshalb halten Geschwister-Module eine Karte zusammen nur MAX(je Modul) mal,
// der Core kommt obendrauf: Core + max(Module).
import { entryKey } from './store'

export const isCore = (d) => d?.kind === 'core'
export const isModule = (d) => d?.kind === 'module'
const isBinder = (d) => d?.kind === 'binder'

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)

// Gruppe, in der eine Karte nur einmal gezählt wird (Module ohne vorhandene Konsole zählen wie normale Decks)
function groupOf(decks, d) {
  return isModule(d) && isCore(decks[d.coreId]) ? d.coreId : null
}

export const modulesOf = (decks, coreId) => Object.values(decks).filter((d) => isModule(d) && d.coreId === coreId).sort(byOrder)
export const coreOf = (decks, d) => (isCore(d) ? d : isModule(d) && isCore(decks[d.coreId]) ? decks[d.coreId] : null)
export function activeModuleOf(decks, core) {
  const m = core?.activeModule ? decks[core.activeModule] : null
  return m && isModule(m) && m.coreId === core.id ? m : null
}

// Anzeigename: „Konsole › Modul“ für Module
export function deckLabel(d, decks) {
  const c = isModule(d) ? decks[d.coreId] : null
  return c ? `${c.name} › ${d.name}` : d.name
}
export const deckIcon = (d) => (isCore(d) ? '🎮 ' : isModule(d) ? '💾 ' : isBinder(d) ? '📁 ' : '')

// Wie viele Exemplare einer Karte (Schlüssel id|finish) stecken physisch in Decks/Ordnern/Konsolen?
export function heldQty(decks, k) {
  let sum = 0
  const mx = {}
  for (const d of Object.values(decks)) {
    const q = d.entries?.[k]?.qty || 0
    if (!q) continue
    const g = groupOf(decks, d)
    if (g) mx[g] = Math.max(mx[g] || 0, q)
    else sum += q
  }
  for (const v of Object.values(mx)) sum += v
  return sum
}

// Alle physisch gehaltenen Exemplare (für Besitz/Wert/Zählung): Schlüssel → { id, finish, qty }
export function heldEntries(decks) {
  const sum = {}
  const mx = {}
  for (const d of Object.values(decks)) {
    const g = groupOf(decks, d)
    for (const [k, e] of Object.entries(d.entries || {})) {
      if (g) { const m = (mx[g] ||= {}); m[k] = Math.max(m[k] || 0, e.qty) }
      else sum[k] = (sum[k] || 0) + e.qty
    }
  }
  for (const m of Object.values(mx)) for (const [k, q] of Object.entries(m)) sum[k] = (sum[k] || 0) + q
  const out = {}
  for (const [k, qty] of Object.entries(sum)) { const [id, finish] = k.split('|'); out[k] = { id, finish, qty } }
  return out
}

// Freie Exemplare nach einer Deck-Änderung neu berechnen, so dass der Besitz gleich bleibt
// (bzw. sich um ownedDelta[k] ändert): frei' = frei + ownedDelta − (gehalten nachher − gehalten vorher).
// Für normale Decks ist das genau die bisherige Rechnung (ins Deck: −1 frei, zurück: +1 frei).
// short: Schlüssel, für die kein freies Exemplar reicht.
// clamp: beim Austragen (ownedDelta < 0) höchstens bis 0 frei gehen statt abzulehnen – es verschwinden dann
// nur so viele Exemplare, wie physisch nicht mehr von einem Geschwister-Modul gebraucht werden.
export function settle(entries, before, after, keys, ownedDelta = {}, clamp = false) {
  let next = entries
  const short = []
  for (const k of new Set(keys)) {
    const dq = heldQty(after, k) - heldQty(before, k)
    const cur = entries[k]?.qty || 0
    let nq = cur + (ownedDelta[k] || 0) - dq
    if (nq < 0 && clamp && (ownedDelta[k] || 0) < 0 && cur - dq >= 0) nq = 0
    if (nq < 0) { short.push(k); continue }
    if (nq === cur) continue
    if (next === entries) next = { ...entries }
    const [id, finish] = k.split('|')
    if (nq > 0) next[k] = { id, finish, qty: nq }
    else delete next[k]
  }
  return { entries: next, short }
}

// Wie viele Exemplare kann ein Modul zusätzlich nehmen, ohne ein freies Exemplar zu brauchen?
// (weil ein Geschwister-Modul die Karte schon öfter hält): Schlüssel → Anzahl
export function moduleBonus(decks, moduleId) {
  const m = decks[moduleId]
  if (!isModule(m) || !isCore(decks[m.coreId])) return {}
  const mx = {}
  for (const s of modulesOf(decks, m.coreId)) {
    if (s.id === moduleId) continue
    for (const [k, e] of Object.entries(s.entries || {})) mx[k] = Math.max(mx[k] || 0, e.qty)
  }
  const out = {}
  for (const [k, q] of Object.entries(mx)) { const b = q - (m.entries[k]?.qty || 0); if (b > 0) out[k] = b }
  return out
}

// Reservierungen für die Sammlung: Schlüssel → [{ deckId, name, qty }]
// Geschwister-Module erscheinen als EIN Eintrag „Konsole › A, B“ mit der MAX-Anzahl.
export function reservedMap(decks) {
  const m = {}
  const groups = {}
  for (const d of Object.values(decks)) {
    const g = groupOf(decks, d)
    for (const [k, e] of Object.entries(d.entries || {})) {
      if (g) { const gm = ((groups[g] ||= {})[k] ||= []); gm.push({ d, qty: e.qty }) }
      else (m[k] ||= []).push({ deckId: d.id, name: deckLabel(d, decks), qty: e.qty })
    }
  }
  for (const [g, byKey] of Object.entries(groups)) {
    for (const [k, list] of Object.entries(byKey)) {
      list.sort((a, b) => byOrder(a.d, b.d))
      ;(m[k] ||= []).push({
        deckId: list[0].d.id, coreId: g, modules: list.map((x) => x.d.id),
        name: `${decks[g].name} › ${list.map((x) => x.d.name).join(', ')}`,
        qty: Math.max(...list.map((x) => x.qty)),
      })
    }
  }
  return m
}

export function mergeEntries(a = {}, b = {}) {
  const out = { ...a }
  for (const [k, e] of Object.entries(b)) out[k] = out[k] ? { ...out[k], qty: out[k].qty + e.qty } : { ...e }
  return out
}

// Kombiniertes (virtuelles) Deck: Core-Karten + Modul-Karten, Commander aus dem Core.
// d = Konsole (nimmt das eingelegte Modul, oder moduleId) oder Modul (nimmt seine Konsole).
// Gibt ein Deck-förmiges Objekt zurück (id = d.id, damit Ergebnisse/Tests beim echten Deck landen),
// das NIE in den Speicher geschrieben wird. Ohne passendes Gegenstück: d selbst.
export function combinedDeck(d, decks, moduleId) {
  if (!d) return d
  let core, mod
  if (isCore(d)) { core = d; mod = moduleId !== undefined ? (moduleId ? decks[moduleId] : null) : activeModuleOf(decks, d) }
  else if (isModule(d)) { core = decks[d.coreId]; mod = d }
  else return d
  if (!isCore(core) || !isModule(mod) || mod.coreId !== core.id) return d
  return {
    ...d,
    virtual: true,
    coreId: core.id, moduleId: mod.id,
    name: `${core.name} · ${mod.name}`,
    entries: mergeEntries(core.entries, mod.entries),
    commanders: core.commanders || [],
    pool: core.pool || null,
    side: [...new Set([...(core.side || []), ...(mod.side || [])])],
    tags: { ...(mod.tags || {}), ...(core.tags || {}) },
    cats: core.cats || mod.cats || null,
  }
}

// Decks zum Spielen/Vergleichen: Module verschwinden, Konsolen erscheinen kombiniert (mit eingelegtem Modul)
export function playableDecks(decks) {
  const out = {}
  for (const d of Object.values(decks)) {
    if (isModule(d)) continue
    out[d.id] = isCore(d) ? combinedDeck(d, decks) : d
  }
  return out
}

// Für Wert-/Besitz-Ansichten: Module einer Konsole als EIN Pseudo-Deck mit MAX-Anzahlen
export function physicalDecks(decks) {
  const out = {}
  const mods = {}
  for (const d of Object.values(decks)) {
    const g = groupOf(decks, d)
    if (!g) { out[d.id] = d; continue }
    const m = (mods[g] ||= {})
    for (const [k, e] of Object.entries(d.entries || {})) if (!m[k] || m[k].qty < e.qty) m[k] = { ...e }
  }
  for (const [g, entries] of Object.entries(mods)) {
    out[`mods:${g}`] = { id: `mods:${g}`, name: `${decks[g].name} › Module`, order: (decks[g].order ?? 0) + 0.5, commanders: [], entries, kind: 'modules' }
  }
  return out
}

// Kartenzahl ohne Sideboard
export function mainCount(d) {
  if (!d) return 0
  const side = new Set(d.side || [])
  let n = 0
  for (const e of Object.values(d.entries || {})) if (!side.has(entryKey(e.id, e.finish))) n += e.qty
  return n
}

// Häufigste Kreaturentypen eines Moduls (aus der Typzeile, auch doppelseitige Karten)
export function creatureTypes(type = '') {
  const out = []
  for (const face of type.split(' // ')) {
    const [left, right] = face.split(' — ')
    if (!right || !/Creature|Kindred|Tribal/.test(left)) continue
    for (const t of right.trim().split(/\s+/)) if (t && !out.includes(t)) out.push(t)
  }
  return out
}
export function topCreatureTypes(entries, cards, n = 3) {
  const m = {}
  for (const e of Object.values(entries || {})) {
    const c = cards[e.id]; if (!c) continue
    for (const t of creatureTypes(c.type)) m[t] = (m[t] || 0) + e.qty
  }
  return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
}
export function colorIdentity(entries, cards) {
  const s = new Set()
  for (const e of Object.values(entries || {})) for (const c of cards[e.id]?.ci || []) s.add(c)
  return ['W', 'U', 'B', 'R', 'G'].filter((c) => s.has(c))
}

// Ziel-Auswahl für Verschieben-Menüs: [{ label, items: [{ id, label }] }] – Decks, Konsolen (🎮 Core, 💾 Core › Modul), Ordner
export function targetGroups(decks, { exclude = null, sort = 'order' } = {}) {
  const cmp = sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : byOrder
  const all = Object.values(decks || {}).sort(cmp)
  const plain = all.filter((d) => d.id !== exclude && d.kind !== 'binder' && !isCore(d) && !(isModule(d) && isCore(decks[d.coreId])))
  const k = []
  for (const c of all.filter(isCore)) {
    if (c.id !== exclude) k.push({ id: c.id, label: `🎮 ${c.name}` })
    for (const m of modulesOf(decks, c.id)) if (m.id !== exclude) k.push({ id: m.id, label: `💾 ${c.name} › ${m.name}` })
  }
  const bs = all.filter((d) => d.id !== exclude && d.kind === 'binder')
  return [
    ...(plain.length ? [{ label: 'Decks', items: plain.map((d) => ({ id: d.id, label: d.name })) }] : []),
    ...(k.length ? [{ label: 'Konsolen', items: k }] : []),
    ...(bs.length ? [{ label: 'Ordner', items: bs.map((d) => ({ id: d.id, label: `📁 ${d.name}` })) }] : []),
  ]
}
