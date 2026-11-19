import { useEffect, useState } from 'react'
import { entryKey } from '../store'
import { fullCards } from '../scryfall'
import { GameSim, arenaHooks, setArenaUser } from './ArenaGame'
import './arena.css'

// Deck aus der Sammlung → Deck im Lounge-Format (jede Karte einzeln, volle Scryfall-Daten)
async function toArenaDeck(deck, cards) {
  const side = new Set(deck.side || []), cmd = new Set(deck.commanders || [])
  const rows = Object.values(deck.entries || {}).filter((e) => cards[e.id] && !side.has(entryKey(e.id, e.finish)))
  const full = await fullCards(rows.map((e) => e.id))
  const make = (e) => {
    const c = cards[e.id]; const f = full[e.id] || {}
    return { ...f, id: e.id, name: f.name || c.name, type_line: f.type_line || c.type || '', image_url: f.image_url || c.img || '', cmc: f.cmc ?? c.cmc ?? 0, color_identity: f.color_identity || c.colors || [] }
  }
  const out = { id: deck.id, name: deck.name, commanders: [], cards: [] }
  for (const e of rows) {
    if (cmd.has(entryKey(e.id, e.finish))) { out.commanders.push(make(e)); continue }
    for (let i = 0; i < e.qty; i++) out.cards.push(make(e))
  }
  return out
}

export default function ArenaScreen({ roomId, deck, cards, user, onLeave, onMinimize, onResult }) {
  const [arenaDeck, setArenaDeck] = useState(null)
  const [err, setErr] = useState('')
  setArenaUser(user)
  arenaHooks.onResult = onResult
  useEffect(() => {
    if (!deck) { setErr('Das Deck für diesen Tisch gibt es nicht mehr.'); return }
    let alive = true
    toArenaDeck(deck, cards).then((d) => alive && setArenaDeck(d)).catch((e) => alive && setErr('Kartendaten konnten nicht geladen werden: ' + e.message))
    return () => { alive = false }
  }, [deck?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.body.classList.add('arena-open'); return () => document.body.classList.remove('arena-open') }, [])

  return (
    <div className="arena-root">
      <button className="arena-min" onClick={onMinimize} title="Spieltisch ausblenden – das Spiel läuft weiter, über „Weiterspielen“ kommst du zurück">⤓ Zur App</button>
      {err ? (
        <div className="arena-center"><p>{err}</p><button className="btn" onClick={onMinimize}>Zurück</button></div>
      ) : !arenaDeck ? (
        <div className="arena-center"><div className="loader" /><p>Lade „{deck?.name}“ mit allen Kartendaten …</p></div>
      ) : (
        <GameSim deck={arenaDeck} roomId={roomId} onLeave={onLeave} />
      )}
      <div id="arena-portal" />
    </div>
  )
}
