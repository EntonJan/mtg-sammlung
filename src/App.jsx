import { useCallback, useEffect, useRef, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { auth, googleProvider } from './firebase'
import { loadCollection, saveCollection, entryKey } from './store'
import { addToCache, ensureCards, loadCardCache, refreshStalePrices } from './scryfall'
import CollectionView from './components/CollectionView'
import AddCards from './components/AddCards'
import ImportView from './components/ImportView'
import CardDetail from './components/CardDetail'

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

function Main({ user }) {
  const [tab, setTab] = useState('collection')
  const [entries, setEntries] = useState(null)
  const [cards, setCards] = useState({})
  const [status, setStatus] = useState('Lade Sammlung …')
  const [saveState, setSaveState] = useState('saved')
  const [open, setOpen] = useState(null)
  const chunksRef = useRef(0)
  const saveTimer = useRef()
  const latest = useRef(null)

  // Start: Sammlung aus Firestore + Kartendaten aus Cache/Scryfall
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [ents, cache] = await Promise.all([loadCollection(user.uid), loadCardCache()])
        if (!alive) return
        chunksRef.current = Math.ceil(Object.keys(ents).length / 2500)
        latest.current = ents
        setEntries(ents)
        setCards({ ...cache })
        const ids = Object.values(ents).map((e) => e.id)
        const full = await ensureCards(ids, (d, t) => alive && setStatus(`Lade Kartendaten … ${d}/${t}`))
        if (!alive) return
        setCards({ ...full })
        setStatus('')
        // Preise im Hintergrund auffrischen (max. 1x pro Tag)
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

  const scheduleSave = useCallback((next) => {
    latest.current = next
    setSaveState('pending')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaveState('saving')
      try {
        chunksRef.current = await saveCollection(user.uid, latest.current, chunksRef.current)
        setSaveState('saved')
      } catch (e) {
        console.error(e)
        setSaveState('error')
      }
    }, 1200)
  }, [user.uid])

  // Vor dem Schließen noch speichern, falls etwas offen ist
  useEffect(() => {
    const warn = (e) => { if (saveState !== 'saved') { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saveState])

  const changeQty = useCallback((card, finish, delta) => {
    if (!cards[card.id]) { addToCache(card); setCards((p) => ({ ...p, [card.id]: card })) }
    const prev = latest.current || {}
    const k = entryKey(card.id, finish)
    const qty = Math.max(0, (prev[k]?.qty || 0) + delta)
    const next = { ...prev }
    if (qty) next[k] = { id: card.id, finish, qty }
    else delete next[k]
    setEntries(next)
    scheduleSave(next)
  }, [cards, scheduleSave])

  const importEntries = useCallback(async (incoming, mode) => {
    let next
    if (mode === 'replace') next = { ...incoming }
    else {
      next = { ...latest.current }
      for (const [k, e] of Object.entries(incoming)) next[k] = { ...e, qty: (next[k]?.qty || 0) + e.qty }
    }
    setStatus('Lade Kartendaten …')
    const full = await ensureCards(Object.values(next).map((e) => e.id), (d, t) => setStatus(`Lade Kartendaten … ${d}/${t}`))
    setCards({ ...full })
    setEntries(next)
    latest.current = next
    setSaveState('saving')
    chunksRef.current = await saveCollection(user.uid, next, chunksRef.current)
    setSaveState('saved')
    setStatus('')
    setTab('collection')
  }, [user.uid])

  const saveLabel = { saved: 'Gespeichert', pending: 'Änderungen …', saving: 'Speichere …', error: 'Speichern fehlgeschlagen' }[saveState]

  return (
    <div className="app">
      <header>
        <h1>MTG Sammlung</h1>
        <nav>
          <button className={tab === 'collection' ? 'on' : ''} onClick={() => setTab('collection')}>Sammlung</button>
          <button className={tab === 'add' ? 'on' : ''} onClick={() => setTab('add')}>Hinzufügen</button>
          <button className={tab === 'import' ? 'on' : ''} onClick={() => setTab('import')}>Import</button>
        </nav>
        <div className="user">
          <span className={`save save-${saveState}`}>{saveLabel}</span>
          <button className="btn ghost small" onClick={() => signOut(auth)} title={user.email}>Abmelden</button>
        </div>
      </header>

      {status && <div className="status">{status}</div>}

      <main>
        {!entries ? (
          <div className="center muted">Lade …</div>
        ) : tab === 'collection' ? (
          Object.keys(entries).length ? (
            <CollectionView entries={entries} cards={cards} onOpen={setOpen} />
          ) : (
            <div className="center">
              <p>Deine Sammlung ist noch leer.</p>
              <button className="btn primary" onClick={() => setTab('import')}>ManaBox-CSV importieren</button>
            </div>
          )
        ) : tab === 'add' ? (
          <AddCards entries={entries} onChange={changeQty} />
        ) : (
          <ImportView entries={entries} onImport={importEntries} />
        )}
      </main>

      {open && (
        <CardDetail card={open} entries={entries} cards={cards} onChange={changeQty} onClose={() => setOpen(null)} />
      )}
    </div>
  )
}
