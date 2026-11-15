import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { auth, googleProvider } from './firebase'
import { entryKey, loadCollection, loadDecks, newDeckId, saveAll } from './store'
import { addToCache, ensureCards, loadCardCache, refreshStalePrices, setWaitHandler } from './scryfall'
import { unitPrice } from './util'
import CollectionView from './components/CollectionView'
import AddCards from './components/AddCards'
import ImportView from './components/ImportView'
import CardDetail from './components/CardDetail'
import Sidebar from './components/Sidebar'
import DeckView from './components/DeckView'

export default function App() {
  const [user, setUser] = useState(undefined)
  useEffect(() => onAuthStateChanged(auth, setUser), [])

  if (user === undefined) return <div className="center muted">Lade …</div>
  if (!user) return <Login />
  return <Main user={user} />
}

function Login() {
  const [err, setErr] = useState('')
  return (
    <div className="center login">
      <h1>MTG Sammlung</h1>
      <p className="muted">Deine Karten. Deine Decks. Ohne Ruckeln.</p>
      <button className="btn primary big" onClick={() => signInWithPopup(auth, googleProvider).catch((e) => setErr(e.message))}>
        Mit Google anmelden
      </button>
      {err && <p className="error">{err}</p>}
    </div>
  )
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
        const [{ entries: ents, chunks }, dks, cache] = await Promise.all([
          loadCollection(user.uid), loadDecks(user.uid), loadCardCache(),
        ])
        if (!alive) return
        Object.assign(S.current, { entries: ents, decks: dks, chunks })
        setEntries(ents)
        setDecks(dks)
        setCards({ ...cache })
        const ids = [...Object.values(ents), ...Object.values(dks).flatMap((d) => Object.values(d.entries))].map((e) => e.id)
        const full = await ensureCards(ids, (d, t) => alive && setStatus(`Lade Kartendaten … ${d}/${t}`))
        if (!alive) return
        setCards({ ...full })
        setStatus('')
        const fresh = await refreshStalePrices(ids, (d, t) => alive && setStatus(`Aktualisiere Preise … ${d}/${t}`))
        if (!alive) return
        setCards({ ...fresh })
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

  const commit = useCallback(({ entries: ne, decks: nd, collectionChanged, changedDecks = [] }) => {
    const s = S.current
    if (ne) { s.entries = ne; setEntries(ne) }
    if (nd) { s.decks = nd; setDecks(nd) }
    if (collectionChanged) s.collectionDirty = true
    changedDecks.forEach((id) => s.dirtyDecks.add(id))
    setSaveState('pending')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 1000)
  }, [flush])

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
    commit({ entries: bump(S.current.entries, card.id, finish, delta), collectionChanged: true })
  }, [commit, rememberCard])

  // Schrank-Prinzip: 1 Exemplar von „from“ nach „to“ verschieben (collection oder Deck-ID)
  const moveCard = useCallback(({ id, finish, from }, to, qty = 1) => {
    if (from === to) return
    const s = S.current
    const srcMap = from === 'collection' ? s.entries : s.decks[from]?.entries
    const have = srcMap?.[entryKey(id, finish)]?.qty || 0
    const name = cards[id]?.name || 'Karte'
    if (have < qty) { notify(`${name}: kein freies Exemplar mehr`); return }

    let ne = s.entries
    const nd = { ...s.decks }
    const changedDecks = []
    if (from === 'collection') ne = bump(ne, id, finish, -qty)
    else {
      const d = nd[from]
      const entriesNext = bump(d.entries, id, finish, -qty)
      const k = entryKey(id, finish)
      nd[from] = { ...d, entries: entriesNext, commanders: entriesNext[k] ? d.commanders : d.commanders.filter((c) => c !== k) }
      changedDecks.push(from)
    }
    if (to === 'collection') ne = bump(ne, id, finish, qty)
    else {
      const d = nd[to]
      nd[to] = { ...d, entries: bump(d.entries, id, finish, qty) }
      changedDecks.push(to)
    }
    commit({ entries: ne, decks: nd, collectionChanged: from === 'collection' || to === 'collection', changedDecks })
    notify(`${name} → ${to === 'collection' ? 'Sammlung' : nd[to].name}`)
  }, [cards, commit])

  const createDeck = useCallback((name) => {
    const id = newDeckId()
    const order = Object.keys(S.current.decks).length
    commit({ decks: { ...S.current.decks, [id]: { id, name, order, commanders: [], entries: {} } }, changedDecks: [id] })
    return id
  }, [commit])

  const updateDeck = useCallback((id, patch) => {
    const d = S.current.decks[id]
    commit({ decks: { ...S.current.decks, [id]: { ...d, ...patch } }, changedDecks: [id] })
  }, [commit])

  const toggleCommander = useCallback((id, key) => {
    const d = S.current.decks[id]
    const has = d.commanders.includes(key)
    updateDeck(id, { commanders: has ? d.commanders.filter((k) => k !== key) : [...d.commanders, key] })
  }, [updateDeck])

  // Deck auflösen: alle Karten zurück in die Sammlung
  const deleteDeck = useCallback((id) => {
    const s = S.current
    let ne = s.entries
    for (const e of Object.values(s.decks[id].entries)) ne = bump(ne, e.id, e.finish, e.qty)
    const nd = { ...s.decks }
    delete nd[id]
    commit({ entries: ne, decks: nd, collectionChanged: true, changedDecks: [id] })
    setView({ kind: 'collection' })
  }, [commit])

  const importEntries = useCallback(async (incoming, mode, subtractDecks) => {
    let next
    if (mode === 'replace') {
      next = { ...incoming }
      // Karten, die in Decks liegen, stehen in ManaBox noch in der Sammlung → abziehen
      if (subtractDecks) {
        for (const d of Object.values(S.current.decks)) {
          for (const e of Object.values(d.entries)) {
            const k = entryKey(e.id, e.finish)
            if (next[k]) next = bump(next, e.id, e.finish, -Math.min(e.qty, next[k].qty))
          }
        }
      }
    }
    else {
      next = { ...S.current.entries }
      for (const [k, e] of Object.entries(incoming)) next[k] = { ...e, qty: (next[k]?.qty || 0) + e.qty }
    }
    setStatus('Lade Kartendaten …')
    const full = await ensureCards(Object.values(next).map((e) => e.id), (d, t) => setStatus(`Lade Kartendaten … ${d}/${t}`))
    setCards({ ...full })
    setStatus('')
    commit({ entries: next, collectionChanged: true })
    await flush()
    setView({ kind: 'collection' })
  }, [commit, flush])

  const freeCount = useMemo(() => Object.values(entries || {}).reduce((s, e) => s + e.qty, 0), [entries])
  const deckStats = useMemo(() => {
    const out = {}
    for (const d of Object.values(decks)) {
      let count = 0, value = 0
      for (const e of Object.values(d.entries)) { count += e.qty; value += (unitPrice(cards[e.id], e.finish) ?? 0) * e.qty }
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
          <button className={view.kind === 'import' ? 'on' : ''} onClick={() => setView({ kind: 'import' })}>Import</button>
        </nav>
        <div className="user">
          <span className={`save save-${saveState}`}>{saveLabel}</span>
          <button className="btn ghost small" onClick={() => signOut(auth)} title={user.email}>Abmelden</button>
        </div>
      </header>

      {status && <div className="status">{status}</div>}

      <div className="body">
        {entries && (
          <Sidebar
            view={view} setView={setView} freeCount={freeCount} decks={decks} deckStats={deckStats}
            onDrop={(d, to) => moveCard(d, to)} onCreate={createDeck}
            open={sideOpen} onClose={() => setSideOpen(false)}
          />
        )}
        {sideOpen && <div className="side-backdrop" onClick={() => setSideOpen(false)} />}

        <main>
          {!entries ? (
            <div className="center muted">Lade …</div>
          ) : view.kind === 'collection' ? (
            Object.keys(entries).length || Object.keys(decks).length ? (
              <CollectionView entries={entries} cards={cards} onOpen={setOpen} />
            ) : (
              <div className="center">
                <p>Deine Sammlung ist noch leer.</p>
                <button className="btn primary" onClick={() => setView({ kind: 'import' })}>ManaBox-CSV importieren</button>
              </div>
            )
          ) : deck ? (
            <DeckView
              key={deck.id}
              deck={deck} cards={cards} onOpen={setOpen} onMove={moveCard}
              onRename={(name) => updateDeck(deck.id, { name })}
              onDelete={() => deleteDeck(deck.id)}
              onToggleCommander={(key) => toggleCommander(deck.id, key)}
            />
          ) : view.kind === 'add' ? (
            <AddCards entries={entries} onChange={changeQty} />
          ) : view.kind === 'import' ? (
            <ImportView entries={entries} hasDecks={Object.keys(decks).length > 0} onImport={importEntries} />
          ) : (
            <div className="center muted">Deck nicht gefunden.</div>
          )}
        </main>
      </div>

      {open && (
        <CardDetail
          card={open} entries={entries} decks={decks} cards={cards}
          onChange={changeQty} onMove={moveCard} onClose={() => setOpen(null)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
