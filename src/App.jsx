import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { deleteShare, newShareId, publishShare, shareRows } from './share'
import ShareDialog from './components/ShareDialog'
import FriendsView from './components/FriendsView'
import { CameraIcon } from './components/Icons'
import { watchFriends } from './friends'
import { auth } from './firebase'
import { Login, Settings } from './components/Auth'
import { entryKey, fromItems, loadCollection, loadDecks, loadMeta, newDeckId, saveAll, saveHistoryPoint, saveMeta } from './store'
import { addToCache, ensureCards, getGermanNames, loadCardCache, loadGermanNames, refreshStalePrices, resolveDeckLines, savePriceSnapshot, setWaitHandler, today } from './scryfall'
import { groupOf, subtypesOf, unitPrice, wishAlarm } from './util'
import CollectionView from './components/CollectionView'
import AddCards from './components/AddCards'
import ImportView from './components/ImportView'
import CardDetail from './components/CardDetail'
import Sidebar from './components/Sidebar'
import DeckView from './components/DeckView'
import MatchView from './components/MatchView'
import ValueView from './components/ValueView'
import BinderView from './components/BinderView'
import WishlistView from './components/WishlistView'
import SellView from './components/SellView'
import ScanView from './components/ScanView'

export default function App() {
  const [user, setUser] = useState(undefined)
  useEffect(() => onAuthStateChanged(auth, setUser), [])

  if (user === undefined) return <div className="center muted">Lade …</div>
  if (!user) return <Login />
  return <Main user={user} />
}

// Eine Karte (Printing + Ausführung) um delta in einer Einträge-Map ändern
function bump(map, id, finish, delta) {
  const k = entryKey(id, finish)
  const qty = (map[k]?.qty || 0) + delta
  const next = { ...map }
  if (qty > 0) next[k] = { id, finish, qty }
  else delete next[k]
  return next
}

function Main({ user }) {
  const [view, setView] = useState({ kind: 'collection' })
  const [entries, setEntries] = useState(null)
  const [decks, setDecks] = useState({})
  const [cards, setCards] = useState({})
  const [status, setStatus] = useState('Lade Sammlung …')
  const [saveState, setSaveState] = useState('saved')
  const [open, setOpen] = useState(null)
  const [toast, setToast] = useState('')
  const [sideOpen, setSideOpen] = useState(false)
  const [wishlist, setWishlistState] = useState([])
  const [shareMeta, setShareMeta] = useState({})   // { collection: id, wishlist: id }
  const [shareOpen, setShareOpen] = useState(null) // { kind, deckId?, title }
  const [friendsCfg, setFriendsCfgState] = useState({})
  const [friendReq, setFriendReq] = useState(0)
  const [deNames, setDeNames] = useState({})
  const [showSettings, setShowSettings] = useState(false)

  // Aktueller Stand in Refs, damit schnelle Aktionen hintereinander nichts überschreiben
  const S = useRef({ entries: {}, decks: {}, chunks: 0, collectionDirty: false, dirtyDecks: new Set() })
  const saveTimer = useRef()
  const toastTimer = useRef()

  const notify = (msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2200)
  }

  useEffect(() => {
    setWaitHandler((sec) => setStatus(`Scryfall bremst – warte ${sec} Sekunden und mache dann weiter …`))
    return () => setWaitHandler(null)
  }, [])

  // Start: Sammlung + Decks aus Firestore, Kartendaten aus Cache/Scryfall
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [{ entries: ents, chunks }, dks, cache, wish] = await Promise.all([
          loadCollection(user.uid), loadDecks(user.uid), loadCardCache(), loadMeta(user.uid, 'wishlist').catch(() => null),
        ])
        loadMeta(user.uid, 'shares').then((m) => alive && m && setShareMeta(m)).catch(() => {})
        loadMeta(user.uid, 'friends').then((m) => alive && m && setFriendsCfgState(m)).catch(() => {})
        if (!alive) return
        setWishlistState(wish?.items || [])
        Object.assign(S.current, { entries: ents, decks: dks, chunks })
        setEntries(ents)
        setDecks(dks)
        setCards({ ...cache })
        const ids = [...Object.values(ents), ...Object.values(dks).flatMap((d) => Object.values(d.entries)), ...(wish?.items || [])].map((e) => e.id)
        const full = await ensureCards(ids, (d, t) => alive && setStatus(`Lade Kartendaten … ${d}/${t}`))
        if (!alive) return
        setCards({ ...full })
        setStatus('')
        const fresh = await refreshStalePrices(ids, (d, t) => alive && setStatus(`Aktualisiere Preise … ${d}/${t}`))
        if (!alive) return
        setCards({ ...fresh })
        setStatus('')
        // Tageswert für den Verlauf merken (Firestore) + Preis-Schnappschuss (lokal)
        await savePriceSnapshot()
        const val = (map) => Object.values(map).reduce((t, e) => t + (unitPrice(fresh[e.id], e.finish) ?? 0) * e.qty, 0)
        const free = val(S.current.entries)
        const inDecks = Object.values(S.current.decks).reduce((t, d) => t + val(d.entries), 0)
        if (free + inDecks > 0) {
          await saveHistoryPoint(user.uid, today(), { total: Math.round((free + inDecks) * 100) / 100, free: Math.round(free * 100) / 100, decks: Math.round(inDecks * 100) / 100 })
        }
        // Deutsche Namen im Hintergrund nachladen (einmalig, danach nur für neue Karten)
        setDeNames({ ...(await getGermanNames()) })
        const oracles = [...new Set(ids.map((id) => fresh[id]?.oracleId).filter(Boolean))]
        const names = await loadGermanNames(oracles, (d, t) => alive && t > 40 && setStatus(`Lade deutsche Kartennamen … ${d}/${t}`))
        if (!alive) return
        setDeNames({ ...names })
        setStatus('')
      } catch (e) {
        setStatus(`Fehler: ${e.message}`)
      }
    })()
    return () => { alive = false }
  }, [user.uid])

  const flush = useCallback(async () => {
    const s = S.current
    if (!s.collectionDirty && !s.dirtyDecks.size) return
    const dirtyDecks = [...s.dirtyDecks]
    const saveCollection = s.collectionDirty
    s.dirtyDecks = new Set()
    s.collectionDirty = false
    setSaveState('saving')
    try {
      s.chunks = await saveAll(user.uid, {
        entries: s.entries, prevChunks: s.chunks, decks: s.decks, dirtyDecks, saveCollection,
      })
      setSaveState(s.collectionDirty || s.dirtyDecks.size ? 'pending' : 'saved')
    } catch (e) {
      console.error(e)
      // Beim nächsten Versuch erneut speichern
      s.collectionDirty ||= saveCollection
      dirtyDecks.forEach((id) => s.dirtyDecks.add(id))
      setSaveState('error')
    }
  }, [user.uid])

  // Rückgängig/Wiederholen: vor jeder Änderung den alten Stand merken (Objekte sind unveränderlich → billig)
  const undoStack = useRef([])
  const redoStack = useRef([])
  const [undoInfo, setUndoInfo] = useState({ undo: 0, redo: 0 })
  const syncUndo = () => setUndoInfo({ undo: undoStack.current.length, redo: redoStack.current.length })

  const commit = useCallback(({ entries: ne, decks: nd, collectionChanged, changedDecks = [], label, noHistory }) => {
    const s = S.current
    if (!noHistory) {
      undoStack.current.push({ entries: s.entries, decks: s.decks, label: label || 'Änderung' })
      if (undoStack.current.length > 50) undoStack.current.shift()
      redoStack.current = []
      syncUndo()
    }
    // Deck-Verlauf: Änderungen an Karten mitschreiben (innerhalb von 2 Minuten zusammengefasst)
    if (nd) {
      for (const id of changedDecks) {
        const before = s.decks[id], after = nd[id]
        if (!before || !after || before.entries === after.entries) continue
        const keys = new Set([...Object.keys(before.entries), ...Object.keys(after.entries)])
        const delta = {}
        for (const k of keys) { const dq = (after.entries[k]?.qty || 0) - (before.entries[k]?.qty || 0); if (dq) delta[k] = dq }
        if (!Object.keys(delta).length) continue
        const log = [...(after.log || before.log || [])]
        const last = log[log.length - 1]
        const now = Date.now()
        if (last && now - last.t < 120000) {
          const merged = {}
          for (const c of last.ch) { const i = c.lastIndexOf('|'); merged[c.slice(0, i)] = Number(c.slice(i + 1)) }
          for (const [k, v] of Object.entries(delta)) merged[k] = (merged[k] || 0) + v
          log[log.length - 1] = { t: now, ch: Object.entries(merged).filter(([, v]) => v).map(([k, v]) => `${k}|${v}`) }
          if (!log[log.length - 1].ch.length) log.pop()
        } else log.push({ t: now, ch: Object.entries(delta).map(([k, v]) => `${k}|${v}`) })
        nd = { ...nd, [id]: { ...after, log: log.slice(-300) } }
      }
    }
    if (ne) { s.entries = ne; setEntries(ne) }
    if (nd) { s.decks = nd; setDecks(nd) }
    if (collectionChanged) s.collectionDirty = true
    changedDecks.forEach((id) => s.dirtyDecks.add(id))
    setSaveState('pending')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 1000)
  }, [flush])

  const restore = useCallback((from, to, verb) => {
    const snap = from.current.pop()
    if (!snap) return
    const s = S.current
    to.current.push({ entries: s.entries, decks: s.decks, label: snap.label })
    const ids = new Set([...Object.keys(s.decks), ...Object.keys(snap.decks)])
    const changed = [...ids].filter((id) => s.decks[id] !== snap.decks[id])
    commit({ entries: snap.entries, decks: snap.decks, collectionChanged: s.entries !== snap.entries, changedDecks: changed, noHistory: true })
    syncUndo()
    notify(`${verb}: ${snap.label}`)
  }, [commit])
  const undo = useCallback(() => restore(undoStack, redoStack, 'Rückgängig'), [restore])
  const redo = useCallback(() => restore(redoStack, undoStack, 'Wiederholt'), [restore])

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  useEffect(() => {
    const warn = (e) => { if (saveState !== 'saved') { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saveState])

  const rememberCard = useCallback((card) => {
    if (!cards[card.id]) { addToCache(card); setCards((p) => ({ ...p, [card.id]: card })) }
  }, [cards])

  // Freie Exemplare in der Sammlung ändern (manuell hinzufügen/entfernen)
  const changeQty = useCallback((card, finish, delta) => {
    rememberCard(card)
    commit({ entries: bump(S.current.entries, card.id, finish, delta), collectionChanged: true, label: `${card.name} ${delta > 0 ? '+' : '−'}1` })
  }, [commit, rememberCard])

  // Gescannte Karte als NEUES Exemplar hinzufügen (Sammlung oder direkt in Deck/Ordner)
  const addScanned = useCallback((card, finish, target, delta = 1) => {
    if (target === 'collection') return changeQty(card, finish, delta)
    rememberCard(card)
    const d = S.current.decks[target]
    if (!d) return
    const ents = bump(d.entries, card.id, finish, delta)
    const k = entryKey(card.id, finish)
    // Letztes Exemplar entfernt → auch Commander-/Pool-/Sideboard-Markierung aufräumen
    const clean = (list) => (ents[k] || !list ? list : list.filter((x) => x !== k))
    const nd = { ...d, entries: ents, commanders: clean(d.commanders), pool: clean(d.pool), side: clean(d.side || []) }
    commit({ decks: { ...S.current.decks, [target]: nd }, changedDecks: [target], label: delta > 0 ? `${card.name} +1 (${d.name})` : `${card.name} aus ${d.name} und Sammlung entfernt` })
  }, [changeQty, rememberCard, commit])

  // Schrank-Prinzip: 1 Exemplar von „from“ nach „to“ verschieben (collection oder Deck-ID)
  const moveCard = useCallback(({ id, finish, from }, to, qty = 1) => {
    if (from === to) return
    const s = S.current
    const srcMap = from === 'collection' ? s.entries : s.decks[from]?.entries
    const have = srcMap?.[entryKey(id, finish)]?.qty || 0
    const name = cards[id]?.name || 'Karte'
    if (have < qty) {
      const oid = cards[id]?.oracleId
      const where = Object.values(s.decks).filter((d) => d.id !== to && Object.values(d.entries).some((e) => cards[e.id]?.oracleId === oid)).map((d) => d.name)
      notify(where.length
        ? `${name}: kein freies Exemplar – steckt in ${where.join(', ')}. Im Deck über „Karte holen“ umlegen.`
        : `${name}: kein freies Exemplar mehr`)
      return
    }

    let ne = s.entries
    const nd = { ...s.decks }
    const changedDecks = []
    if (from === 'collection') ne = bump(ne, id, finish, -qty)
    else {
      const d = nd[from]
      const entriesNext = bump(d.entries, id, finish, -qty)
      const k = entryKey(id, finish)
      nd[from] = { ...d, entries: entriesNext, commanders: entriesNext[k] ? d.commanders : d.commanders.filter((c) => c !== k), pool: entriesNext[k] ? d.pool : (d.pool || []).filter((c) => c !== k), side: entriesNext[k] ? d.side : (d.side || []).filter((c) => c !== k) }
      changedDecks.push(from)
    }
    if (to === 'collection') ne = bump(ne, id, finish, qty)
    else {
      const d = nd[to]
      nd[to] = { ...d, entries: bump(d.entries, id, finish, qty) }
      changedDecks.push(to)
    }
    commit({ entries: ne, decks: nd, collectionChanged: from === 'collection' || to === 'collection', changedDecks, label: `${name} → ${to === 'collection' ? 'Sammlung' : nd[to].name}` })
    notify(`${name} → ${to === 'collection' ? 'Sammlung' : nd[to].name}`)
  }, [cards, commit])

  // Mehrere Karten in einem Schritt verschieben (z. B. Überschüsse in den Tauschordner)
  const moveMany = useCallback((list, to) => {
    const s = S.current
    let ne = s.entries
    const nd = { ...s.decks }
    const changed = new Set()
    let moved = 0
    for (const { id, finish, qty, from } of list) {
      const src = from === 'collection' ? ne : nd[from]?.entries
      const q = Math.min(qty, src?.[entryKey(id, finish)]?.qty || 0)
      if (!q || from === to) continue
      if (from === 'collection') ne = bump(ne, id, finish, -q)
      else { nd[from] = { ...nd[from], entries: bump(nd[from].entries, id, finish, -q) }; changed.add(from) }
      if (to === 'collection') ne = bump(ne, id, finish, q)
      else { nd[to] = { ...nd[to], entries: bump(nd[to].entries, id, finish, q) }; changed.add(to) }
      moved += q
    }
    if (!moved) return
    commit({ entries: ne, decks: nd, collectionChanged: true, changedDecks: [...changed], label: `${moved} Karten verschoben` })
    notify(`${moved} Karten → ${to === 'collection' ? 'Sammlung' : nd[to].name}`)
  }, [commit])

  // Ziel für Drag & Drop: einzelne Karte oder Mehrfachauswahl
  const dropCard = useCallback((d, to) => (d.multi ? moveMany(d.multi, to) : moveCard(d, to)), [moveMany, moveCard])

  const createDeck = useCallback((name, kind) => {
    const id = newDeckId()
    const order = Object.keys(S.current.decks).length
    commit({ decks: { ...S.current.decks, [id]: { id, name, order, commanders: [], entries: {}, ...(kind ? { kind } : {}) } }, changedDecks: [id], label: `„${name}“ angelegt` })
    return id
  }, [commit])

  const updateDeck = useCallback((id, patch) => {
    const d = S.current.decks[id]
    commit({ decks: { ...S.current.decks, [id]: { ...d, ...patch } }, changedDecks: [id], label: `„${d.name}“ geändert` })
  }, [commit])
  const updateDeckRef = useRef(updateDeck); updateDeckRef.current = updateDeck

  // Printing einer Deckkarte ändern: 'fix' schreibt den Eintrag um, 'swap' tauscht mit einem freien Exemplar der Sammlung
  const changePrinting = useCallback((deckId, { id, finish }, card, newFinish, qty, mode) => {
    const s = S.current
    const d = s.decks[deckId]
    const oldKey = entryKey(id, finish)
    const newKey = entryKey(card.id, newFinish)
    const have = d?.entries[oldKey]?.qty || 0
    if (!d || !have || oldKey === newKey) return
    qty = Math.min(qty, have)
    if (mode === 'swap') qty = Math.min(qty, s.entries[newKey]?.qty || 0)
    if (qty < 1) return
    rememberCard(card)
    let ents = bump(d.entries, id, finish, -qty)
    ents = bump(ents, card.id, newFinish, qty)
    const gone = !ents[oldKey]
    const remap = (list) => (list || []).includes(oldKey)
      ? [...new Set([...(gone ? list.filter((k) => k !== oldKey) : list), newKey])]
      : list
    const nd = { ...d, entries: ents, commanders: remap(d.commanders), pool: d.pool ? remap(d.pool) : d.pool, side: remap(d.side || []) }
    let entries = s.entries
    if (mode === 'swap') {
      entries = bump(entries, card.id, newFinish, -qty)
      entries = bump(entries, id, finish, qty)
    }
    commit({
      entries, decks: { ...s.decks, [deckId]: nd }, changedDecks: [deckId], collectionChanged: mode === 'swap',
      label: `${card.name}: ${mode === 'swap' ? 'getauscht' : 'Printing geändert'} → ${card.set.toUpperCase()} #${card.num}`,
    })
  }, [commit, rememberCard])

  // Gemerkte Deck-Version wiederherstellen: Überzähliges zurück in die Sammlung, Fehlendes aus der Sammlung holen
  const restoreVersion = useCallback((deckId, version) => {
    const s = S.current
    const d = s.decks[deckId]
    if (!d) return []
    const target = fromItems(version.items)
    let ents = d.entries, coll = s.entries
    const missing = []
    for (const [k, e] of Object.entries(d.entries)) {
      const want = target[k]?.qty || 0
      if (e.qty > want) { ents = bump(ents, e.id, e.finish, want - e.qty); coll = bump(coll, e.id, e.finish, e.qty - want) }
    }
    for (const [k, e] of Object.entries(target)) {
      const have = ents[k]?.qty || 0
      if (e.qty <= have) continue
      const take = Math.min(e.qty - have, coll[k]?.qty || 0)
      if (take) { ents = bump(ents, e.id, e.finish, take); coll = bump(coll, e.id, e.finish, -take) }
      if (e.qty - have - take > 0) missing.push({ ...e, qty: e.qty - have - take })
    }
    const nd = { ...d, entries: ents, commanders: (version.commanders || d.commanders).filter((k) => ents[k]), side: (version.side || []).filter((k) => ents[k]) }
    commit({ entries: coll, decks: { ...s.decks, [deckId]: nd }, collectionChanged: coll !== s.entries, changedDecks: [deckId], label: `Version „${version.name}“ wiederhergestellt` })
    return missing
  }, [commit])

  const toggleCommander = useCallback((id, key) => {
    const d = S.current.decks[id]
    const has = d.commanders.includes(key)
    updateDeck(id, { commanders: has ? d.commanders.filter((k) => k !== key) : [...d.commanders, key] })
  }, [updateDeck])

  // Neues Deck aus freien Exemplaren der Sammlung anlegen (Abgleich „Was fehlt mir?“)
  const createDeckFromPicks = useCallback((name, picks, commanders) => {
    const s = S.current
    const id = newDeckId()
    let ne = s.entries
    let de = {}
    for (const p of picks) {
      const have = ne[entryKey(p.id, p.finish)]?.qty || 0
      const q = Math.min(have, p.qty)
      if (!q) continue
      ne = bump(ne, p.id, p.finish, -q)
      de = bump(de, p.id, p.finish, q)
    }
    const deck = { id, name, order: Object.keys(s.decks).length, commanders: commanders.filter((k) => de[k]), entries: de }
    commit({ entries: ne, decks: { ...s.decks, [id]: deck }, collectionChanged: true, changedDecks: [id], label: `Deck „${name}“ angelegt` })
    setView({ kind: 'deck', id })
    notify(`Deck „${name}“ mit ${Object.values(de).reduce((t, e) => t + e.qty, 0)} Karten angelegt`)
  }, [commit])

  // Deck auflösen: alle Karten zurück in die Sammlung
  const deleteDeck = useCallback((id) => {
    const s = S.current
    let ne = s.entries
    for (const e of Object.values(s.decks[id].entries)) ne = bump(ne, e.id, e.finish, e.qty)
    const nd = { ...s.decks }
    delete nd[id]
    commit({ entries: ne, decks: nd, collectionChanged: true, changedDecks: [id], label: `„${s.decks[id].name}“ aufgelöst` })
    setView({ kind: 'collection' })
  }, [commit])

  const importEntries = useCallback(async (parsed, mode, subtractDecks, separate = []) => {
    const s = S.current
    // Karten aus „abgetrennten“ ManaBox-Ordnern (z. B. Tradebinder) gehen in eigene Ordner
    let incoming = {}
    for (const [b, ents] of Object.entries(parsed.byBinder)) {
      if (separate.includes(b)) continue
      for (const [k, e] of Object.entries(ents)) incoming[k] = { ...e, qty: (incoming[k]?.qty || 0) + e.qty }
    }
    const nd = { ...s.decks }
    const changedDecks = []
    for (const b of separate) {
      const existing = Object.values(nd).find((d) => d.kind === 'binder' && d.name === b)
      const id = existing?.id || newDeckId()
      let ents = mode === 'replace' || !existing ? {} : { ...existing.entries }
      for (const e of Object.values(parsed.byBinder[b])) ents = bump(ents, e.id, e.finish, e.qty)
      nd[id] = { ...(existing || { id, name: b, order: Object.keys(nd).length, commanders: [], kind: 'binder' }), entries: ents }
      changedDecks.push(id)
    }
    let next
    if (mode === 'replace') {
      next = { ...incoming }
      // Karten, die in Decks liegen, stehen in ManaBox noch in der Sammlung → abziehen
      if (subtractDecks) {
        for (const d of Object.values(nd)) {
          if (changedDecks.includes(d.id)) continue
          for (const e of Object.values(d.entries)) {
            const k = entryKey(e.id, e.finish)
            if (next[k]) next = bump(next, e.id, e.finish, -Math.min(e.qty, next[k].qty))
          }
        }
      }
    } else {
      next = { ...s.entries }
      for (const [k, e] of Object.entries(incoming)) next[k] = { ...e, qty: (next[k]?.qty || 0) + e.qty }
    }
    setStatus('Lade Kartendaten …')
    const full = await ensureCards(Object.keys(parsed.entries).map((k) => k.split('|')[0]), (d, t) => setStatus(`Lade Kartendaten … ${d}/${t}`))
    setCards({ ...full })
    setStatus('')
    commit({ entries: next, decks: nd, collectionChanged: true, changedDecks, label: 'ManaBox-Import' })
    await flush()
    setView({ kind: 'collection' })
  }, [commit, flush])

  // Bestehendes Deck importieren: Karten neu anlegen und direkt ins Deck legen
  // Freie Exemplare derselben Karte finden: zuerst gleiche Version, dann (optional) andere Drucke
  const freeCopiesFor = (ne, card, finish, anyPrinting) => {
    const same = ne[entryKey(card.id, finish)] ? [ne[entryKey(card.id, finish)]] : []
    if (!anyPrinting) return same
    const others = Object.values(ne)
      .filter((e) => e.id !== card.id && cards[e.id]?.oracleId === card.oracleId)
      .sort((a, b) => (a.finish !== finish) - (b.finish !== finish))
    return [...same, ...others]
  }

  // Bestehendes Deck importieren. Liegen die Karten schon frei in der Sammlung (z. B. aus ManaBox),
  // werden sie von dort ins Deck verschoben – nur der Rest wird neu angelegt.
  const importDeck = useCallback(async (targetId, name, lines, fromCollection = false) => {
    setStatus('Suche Karten bei Scryfall …')
    try {
      const { ok, missing } = await resolveDeckLines(lines, (d, t) => setStatus(`Suche Karten … ${d}/${t}`))
      setCards((p) => { const n = { ...p }; ok.forEach((l) => { n[l.card.id] = l.card }); return n })
      const s = S.current
      const id = targetId || newDeckId()
      const base = s.decks[id] || { id, name, order: Object.keys(s.decks).length, commanders: [], entries: {} }
      let ents = base.entries
      let ne = s.entries
      const cmds = new Set(base.commanders)
      const side = new Set(base.side || [])
      let added = 0, moved = 0
      for (const l of ok) {
        let need = l.qty
        if (fromCollection) {
          for (const e of freeCopiesFor(ne, l.card, l.finish, true)) {
            if (!need) break
            const q = Math.min(need, ne[entryKey(e.id, e.finish)]?.qty || 0)
            if (!q) continue
            ne = bump(ne, e.id, e.finish, -q)
            ents = bump(ents, e.id, e.finish, q)
            if (l.commander) cmds.add(entryKey(e.id, e.finish))
            need -= q; moved += q
          }
        }
        if (need) {
          ents = bump(ents, l.card.id, l.finish, need)
          if (l.commander) cmds.add(entryKey(l.card.id, l.finish))
          if (l.side) side.add(entryKey(l.card.id, l.finish))
        }
        added += l.qty
      }
      commit({ entries: ne, decks: { ...s.decks, [id]: { ...base, entries: ents, commanders: [...cmds], side: [...side] } }, collectionChanged: moved > 0, changedDecks: [id], label: `Deck-Import „${base.name}“` })
      await flush()
      return { deckId: id, name: base.name, added, moved, missing }
    } finally {
      setStatus('')
    }
  }, [commit, flush, cards]) // eslint-disable-line react-hooks/exhaustive-deps

  // Doppelt gezählte Karten bereinigen: Deck-Karten, die zusätzlich noch frei in der Sammlung liegen
  const reconcilePreview = useCallback((deckId, anyPrinting) => {
    const s = S.current
    let ne = s.entries
    const list = []
    for (const e of Object.values(s.decks[deckId]?.entries || {})) {
      const card = cards[e.id]; if (!card) continue
      let need = e.qty
      for (const f of freeCopiesFor(ne, card, e.finish, anyPrinting)) {
        if (!need) break
        const q = Math.min(need, ne[entryKey(f.id, f.finish)]?.qty || 0)
        if (!q) continue
        ne = bump(ne, f.id, f.finish, -q)
        list.push({ id: f.id, finish: f.finish, qty: q })
        need -= q
      }
    }
    const value = list.reduce((t, x) => t + (unitPrice(cards[x.id], x.finish) ?? 0) * x.qty, 0)
    return { list, count: list.reduce((t, x) => t + x.qty, 0), value, entries: ne }
  }, [cards]) // eslint-disable-line react-hooks/exhaustive-deps

  const reconcileApply = useCallback((deckId, anyPrinting) => {
    const p = reconcilePreview(deckId, anyPrinting)
    if (!p.count) return
    commit({ entries: p.entries, collectionChanged: true, label: `${p.count} doppelte Karten aus der Sammlung entfernt` })
    notify(`${p.count} doppelt gezählte Karten aus der Sammlung entfernt`)
  }, [reconcilePreview, commit])

  const setWishlist = useCallback((items, newCards = []) => {
    newCards.forEach(rememberCard)
    setWishlistState(items)
    saveMeta(user.uid, 'wishlist', { items }).catch((e) => { console.error(e); setSaveState('error') })
  }, [user.uid, rememberCard])
  const wishAlarms = useMemo(() => wishlist.filter((w) => wishAlarm(w, cards)).length, [wishlist, cards])

  // Offene Freundschaftsanfragen für das Abzeichen im Menü
  useEffect(() => watchFriends(user.uid, (l) => setFriendReq(Object.values(l).filter((f) => f.status === 'in').length)), [user.uid])
  const setFriendsCfg = useCallback((c) => { setFriendsCfgState(c); saveMeta(user.uid, 'friends', c).catch(console.error) }, [user.uid])

  // ---- Teilen-Links (Nur-Lesen) ----
  const sharesRef = useRef(shareMeta); sharesRef.current = shareMeta
  const wishRef = useRef(wishlist); wishRef.current = wishlist
  const cardsRef = useRef(cards); cardsRef.current = cards
  const buildShare = useCallback((kind, deckId) => {
    const s = S.current, cs = cardsRef.current
    if (kind === 'deck' || kind === 'binder') {
      const d = s.decks[deckId]
      if (!d) return null
      const cmd = new Set(d.commanders || []), side = new Set(d.side || [])
      const zone = (e) => { const k = entryKey(e.id, e.finish); return cmd.has(k) ? 'cmd' : side.has(k) ? 'side' : 'main' }
      return { kind: d.kind === 'binder' ? 'binder' : 'deck', name: d.name, rows: shareRows(Object.values(d.entries), cs, zone) }
    }
    if (kind === 'collection') {
      const m = {}
      const add = (e) => { const k = entryKey(e.id, e.finish); m[k] = { ...e, qty: (m[k]?.qty || 0) + e.qty } }
      Object.values(s.entries).forEach(add)
      Object.values(s.decks).forEach((d) => Object.values(d.entries).forEach(add))
      return { kind, name: 'Sammlung', rows: shareRows(Object.values(m), cs) }
    }
    if (kind === 'wishlist') return { kind, name: 'Wunschliste', rows: shareRows(wishRef.current.map((w) => ({ id: w.id, finish: w.finish || 'normal', qty: 1 })), cs) }
    return null
  }, [])
  const shareIdOf = (kind, deckId) => (kind === 'deck' || kind === 'binder') ? S.current.decks[deckId]?.shareId : sharesRef.current[kind]
  const pendingShares = useRef(new Map())
  const shareTimer = useRef(null)
  const scheduleShare = useCallback((kind, deckId, delay = 5000) => {
    const id = (kind === 'deck' || kind === 'binder') ? S.current.decks[deckId]?.shareId : sharesRef.current[kind]
    if (!id) return
    pendingShares.current.set(id, { kind, deckId })
    clearTimeout(shareTimer.current)
    shareTimer.current = setTimeout(async () => {
      const jobs = [...pendingShares.current.entries()]
      pendingShares.current.clear()
      for (const [sid, j] of jobs) {
        const payload = buildShare(j.kind, j.deckId)
        if (payload) await publishShare(user.uid, sid, payload).catch((e) => console.error('Teilen-Link', e))
      }
    }, delay)
  }, [buildShare, user.uid])
  const createShare = useCallback(async (kind, deckId) => {
    const id = newShareId()
    const payload = buildShare(kind, deckId)
    await publishShare(user.uid, id, payload)
    if (kind === 'deck' || kind === 'binder') updateDeckRef.current(deckId, { shareId: id })
    else { const m = { ...sharesRef.current, [kind]: id }; sharesRef.current = m; setShareMeta(m); await saveMeta(user.uid, 'shares', m) }
    return id
  }, [buildShare, user.uid])
  const removeShare = useCallback(async (kind, deckId) => {
    const id = shareIdOf(kind, deckId)
    if (id) await deleteShare(id)
    if (kind === 'deck' || kind === 'binder') updateDeckRef.current(deckId, { shareId: null })
    else { const m = { ...sharesRef.current }; delete m[kind]; setShareMeta(m); await saveMeta(user.uid, 'shares', m) }
  }, [user.uid])
  // Automatisch aktualisieren, wenn sich geteilte Inhalte ändern
  useEffect(() => { if (shareMeta.wishlist) scheduleShare('wishlist') }, [wishlist]) // eslint-disable-line react-hooks/exhaustive-deps
  const prevDecks = useRef(decks)
  useEffect(() => {
    const before = prevDecks.current; prevDecks.current = decks
    if (!before || before === decks) return
    for (const d of Object.values(decks)) if (d.shareId && before[d.id] !== d) scheduleShare(d.kind === 'binder' ? 'binder' : 'deck', d.id)
    if (shareMeta.collection) scheduleShare('collection', null, 20000)
  }, [decks]) // eslint-disable-line react-hooks/exhaustive-deps
  const prevEntries = useRef(entries)
  useEffect(() => {
    const before = prevEntries.current; prevEntries.current = entries
    if (before && before !== entries && shareMeta.collection) scheduleShare('collection', null, 20000)
  }, [entries]) // eslint-disable-line react-hooks/exhaustive-deps
  const ownedOracles = useMemo(() => {
    const o = new Set()
    const add = (e) => cards[e.id] && o.add(cards[e.id].oracleId)
    Object.values(entries || {}).forEach(add)
    Object.values(decks).forEach((d) => Object.values(d.entries).forEach(add))
    return o
  }, [entries, decks, cards])

  // Reservierungen: welche Exemplare stecken in welchen Decks/Ordnern
  const reserved = useMemo(() => {
    const m = {}
    for (const d of Object.values(decks)) {
      for (const [k, e] of Object.entries(d.entries)) (m[k] ||= []).push({ deckId: d.id, name: d.name, qty: e.qty })
    }
    return m
  }, [decks])

  // Sidebar „Sammlung“: alle Karten, die du besitzt (frei + in Decks)
  const freeCount = useMemo(() => [...Object.values(entries || {}), ...Object.values(decks).flatMap((d) => Object.values(d.entries))].reduce((s, e) => s + e.qty, 0), [entries, decks])
  // Anzahl freier Karten je Kategorie und je Untertyp (für die Sidebar)
  const { catCounts, subCounts } = useMemo(() => {
    const catCounts = {}, subCounts = {}
    const all = [...Object.values(entries || {}), ...Object.values(decks).flatMap((d) => Object.values(d.entries))]
    for (const e of all) {
      const c = cards[e.id]
      if (!c) continue
      const g = groupOf(c.type)
      catCounts[g] = (catCounts[g] || 0) + e.qty
      const m = (subCounts[g] ||= {})
      for (const st of subtypesOf(c.type)) m[st] = (m[st] || 0) + e.qty
    }
    return { catCounts, subCounts }
  }, [entries, decks, cards])
  const deckStats = useMemo(() => {
    const out = {}
    for (const d of Object.values(decks)) {
      let count = 0, value = 0
      const side = new Set(d.side || [])
      for (const e of Object.values(d.entries)) {
        // Sideboard zählt nicht zu den Karten im Hauptdeck (Wert schon)
        if (!side.has(entryKey(e.id, e.finish))) count += e.qty
        value += (unitPrice(cards[e.id], e.finish) ?? 0) * e.qty
      }
      out[d.id] = { count, value }
    }
    return out
  }, [decks, cards])

  const saveLabel = { saved: 'Gespeichert', pending: 'Änderungen …', saving: 'Speichere …', error: 'Speichern fehlgeschlagen' }[saveState]
  const deck = view.kind === 'deck' ? decks[view.id] : null

  return (
    <div className="app">
      <header>
        <button className="btn icon side-toggle" onClick={() => setSideOpen((o) => !o)} aria-label="Decks">☰</button>
        <h1>MTG Sammlung</h1>
        <nav>
          <button className={view.kind === 'add' ? 'on' : ''} onClick={() => setView({ kind: 'add' })}>Hinzufügen</button>
          <button className={view.kind === 'scan' ? 'on' : ''} onClick={() => setView({ kind: 'scan' })}><CameraIcon /> Scannen</button>
          <button className={view.kind === 'wish' ? 'on' : ''} onClick={() => setView({ kind: 'wish' })}>
            Wunschliste{wishAlarms > 0 && <span className="badge">🔔 {wishAlarms}</span>}
          </button>
          <button className={view.kind === 'value' ? 'on' : ''} onClick={() => setView({ kind: 'value' })}>Wert</button>
          <button className={view.kind === 'sell' ? 'on' : ''} onClick={() => setView({ kind: 'sell' })}>Verkaufen</button>
          <button className={view.kind === 'match' ? 'on' : ''} onClick={() => setView({ kind: 'match' })}>Was fehlt mir?</button>
          <button className={view.kind === 'friends' ? 'on' : ''} onClick={() => setView({ kind: 'friends' })}>
            Freunde{friendReq > 0 && <span className="badge">{friendReq}</span>}
          </button>
          <button className={view.kind === 'import' ? 'on' : ''} onClick={() => setView({ kind: 'import' })}>Import</button>
        </nav>
        <div className="user">
          <button className="btn icon small" disabled={!undoInfo.undo} onClick={undo} title="Rückgängig (Strg+Z)">↶</button>
          <button className="btn icon small" disabled={!undoInfo.redo} onClick={redo} title="Wiederholen (Strg+Y)">↷</button>
          <span className={`save save-${saveState}`}>{saveLabel}</span>
          <button className="btn icon small" onClick={() => setShowSettings(true)} title="Einstellungen / Android-App">⚙</button>
          <button className="btn ghost small" onClick={() => signOut(auth)} title={user.email}>Abmelden</button>
        </div>
      </header>

      {status && <div className="status">{status}</div>}

      <div className="body">
        {entries && (
          <Sidebar
            view={view} setView={setView} freeCount={freeCount} catCounts={catCounts} subCounts={subCounts} decks={decks} deckStats={deckStats}
            onDrop={dropCard} onCreate={createDeck}
            open={sideOpen} onClose={() => setSideOpen(false)}
          />
        )}
        {sideOpen && <div className="side-backdrop" onClick={() => setSideOpen(false)} />}

        <main>
          {!entries ? (
            <div className="center muted">Lade …</div>
          ) : view.kind === 'collection' ? (
            Object.keys(entries).length || Object.keys(decks).length ? (
              <CollectionView entries={entries} cards={cards} onOpen={setOpen} cat={view.cat} sub={view.sub} decks={decks} onMoveMany={moveMany} deNames={deNames} reserved={reserved}
                onShare={!view.cat ? () => setShareOpen({ kind: 'collection', title: 'Sammlung' }) : undefined} />
            ) : (
              <div className="center">
                <p>Deine Sammlung ist noch leer.</p>
                <button className="btn primary" onClick={() => setView({ kind: 'import' })}>ManaBox-CSV importieren</button>
              </div>
            )
          ) : deck?.kind === 'binder' ? (
            <BinderView
              key={deck.id} deck={deck} cards={cards} onOpen={setOpen} onMove={dropCard}
              onAddNew={(card, finish, delta = 1) => addScanned(card, finish, deck.id, delta)}
              onShare={() => setShareOpen({ kind: 'binder', deckId: deck.id, title: deck.name })}
              onRename={(name) => updateDeck(deck.id, { name })}
              onDelete={() => deleteDeck(deck.id)}
            />
          ) : deck ? (
            <DeckView
              key={deck.id}
              deck={deck} decks={decks} cards={cards} entries={entries} onOpen={setOpen} onMove={dropCard} onMoveMany={moveMany} deNames={deNames} reserved={reserved}
              onRename={(name) => updateDeck(deck.id, { name })}
              onDelete={() => deleteDeck(deck.id)}
              onToggleCommander={(key) => toggleCommander(deck.id, key)}
              onUpdate={(patch) => updateDeck(deck.id, patch)}
              reconcilePreview={(any) => reconcilePreview(deck.id, any)}
              onReconcile={(any) => reconcileApply(deck.id, any)}
              onAddNew={(card, finish, delta = 1) => addScanned(card, finish, deck.id, delta)}
              onImportDeck={importDeck}
              onChangePrinting={(from, card, finish, qty, mode) => changePrinting(deck.id, from, card, finish, qty, mode)}
              onRestoreVersion={(v) => restoreVersion(deck.id, v)}
              onShare={() => setShareOpen({ kind: 'deck', deckId: deck.id, title: deck.name })}
            />
          ) : view.kind === 'add' ? (
            <AddCards entries={entries} onChange={changeQty} />
          ) : view.kind === 'scan' ? (
            <ScanView decks={decks} onAdd={addScanned} onUndoAdd={(c, f, t) => addScanned(c, f, t, -1)} />
          ) : view.kind === 'sell' ? (
            <SellView entries={entries} decks={decks} cards={cards} deNames={deNames} onMoveMany={moveMany} onCreateBinder={(n) => createDeck(n, 'binder')} onOpen={setOpen} />
          ) : view.kind === 'wish' ? (
            <WishlistView wishlist={wishlist} setWishlist={setWishlist} cards={cards} ownedOracles={ownedOracles} onOpen={setOpen} onShare={() => setShareOpen({ kind: 'wishlist', title: 'Wunschliste' })} />
          ) : view.kind === 'value' ? (
            <ValueView uid={user.uid} entries={entries} decks={decks} cards={cards} onOpen={setOpen} />
          ) : view.kind === 'friends' ? (
            <FriendsView uid={user.uid} decks={decks} entries={entries} cards={cards} wishlist={wishlist} shareMeta={shareMeta}
              friendsCfg={friendsCfg} setFriendsCfg={setFriendsCfg} ensureShare={createShare} onCount={setFriendReq} />
          ) : view.kind === 'match' ? (
            <MatchView entries={entries} decks={decks} cards={cards} onCreateDeck={createDeckFromPicks} wishlist={wishlist} setWishlist={setWishlist} />
          ) : view.kind === 'import' ? (
            <ImportView entries={entries} decks={decks} onImport={importEntries} onImportDeck={importDeck} />
          ) : (
            <div className="center muted">Deck nicht gefunden.</div>
          )}
        </main>
      </div>

      {open && (
        <CardDetail
          card={open} entries={entries} decks={decks} cards={cards} deName={deNames[open.oracleId]}
          onChange={changeQty} onMove={moveCard} onClose={() => setOpen(null)}
        />
      )}
      {showSettings && <Settings user={user} onClose={() => setShowSettings(false)} />}
      {shareOpen && (
        <ShareDialog title={shareOpen.title} shareId={shareIdOf(shareOpen.kind, shareOpen.deckId)}
          onCreate={() => createShare(shareOpen.kind, shareOpen.deckId)} onDelete={() => removeShare(shareOpen.kind, shareOpen.deckId)}
          onClose={() => setShareOpen(null)} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
