import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { watchFriends } from '../friends'
import { arenaBeta, cancelRoom, createRoom, joinRoom, leaveRoom, watchRooms } from './arenaRooms'

// Der eigentliche Spieltisch (aus der Lounge) wird erst beim Betreten geladen – er ist groß
const ArenaScreen = lazy(() => import('./ArenaScreen'))

const cmdName = (deck, cards) => (deck.commanders || []).map((k) => cards[k.split('|')[0]]?.name).filter(Boolean).join(' & ')

// Bereich im Reiter „Testspiel“: Tische mit Freunden eröffnen, Einladungen annehmen, Bilanz
export default function ArenaLobby({ deck, decks, cards, uid, myName, onAddResult }) {
  const beta = arenaBeta(uid)
  const [rooms, setRooms] = useState({ mine: [], inv: [] })
  const [friends, setFriends] = useState({})
  const [pick, setPick] = useState({})
  const [joinDeck, setJoinDeck] = useState({})
  const [playing, setPlaying] = useState(null) // { roomId, deckId }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const own = useMemo(() => Object.values(decks).filter((d) => d.kind !== 'binder').sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [decks])
  useEffect(() => watchRooms(uid, setRooms), [uid])
  useEffect(() => (beta ? watchFriends(uid, (l) => setFriends(l || {})) : undefined), [uid, beta])
  const fr = Object.entries(friends).filter(([, v]) => v.status === 'friend')
  const name = myName || 'Ich'

  if (playing) {
    return (
      <Suspense fallback={<p className="muted">Lade Spieltisch …</p>}>
        <ArenaScreen roomId={playing.roomId} deck={decks[playing.deckId]} cards={cards}
          user={{ uid, displayName: name }}
          onResult={(r) => onAddResult?.(playing.deckId, r)}
          onLeave={async () => { const r = playing; setPlaying(null); await leaveRoom(r.roomId, uid) }}
          onMinimize={() => setPlaying(null)} />
      </Suspense>
    )
  }
  if (!beta && !rooms.mine.length && !rooms.inv.length) return null

  const create = async () => {
    const invited = Object.keys(pick).filter((k) => pick[k])
    if (!invited.length) { setErr('Wähle mindestens einen Freund.'); return }
    if (invited.length > 3) { setErr('Höchstens 4 Spieler pro Tisch.'); return }
    setBusy(true); setErr('')
    try {
      const id = await createRoom(uid, name, deck, cmdName(deck, cards), invited)
      setPick({}); setPlaying({ roomId: id, deckId: deck.id })
    } catch (e) { setErr('Tisch konnte nicht angelegt werden: ' + e.message) } finally { setBusy(false) }
  }
  const join = async (r) => {
    const d = decks[joinDeck[r.id] || deck.id]
    setBusy(true); setErr('')
    try { await joinRoom(r.id, uid, name, d, cmdName(d, cards)); setPlaying({ roomId: r.id, deckId: d.id }) }
    catch (e) { setErr('Beitreten fehlgeschlagen: ' + e.message) } finally { setBusy(false) }
  }

  const games = (deck.tests || []).filter((t) => t.online).slice().reverse()
  const wins = games.filter((t) => t.result === 'win').length, losses = games.filter((t) => t.result === 'loss').length

  return (
    <section className="ot-lobby">
      <h3 className="combo-sec">Spieltisch mit Freunden {beta && <span className="chip beta-chip">Beta – nur für dich sichtbar</span>}</h3>
      {rooms.inv.map((r) => (
        <div key={r.id} className="ot-invite">
          <b>Einladung von {r.hostName || 'einem Freund'}</b>
          <span className="muted small">{r.players.length}/{r.maxPlayers} am Tisch</span>
          <select value={joinDeck[r.id] || deck.id} onChange={(e) => setJoinDeck({ ...joinDeck, [r.id]: e.target.value })}>
            {own.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button className="btn primary" disabled={busy} onClick={() => join(r)}>Mit diesem Deck beitreten</button>
        </div>
      ))}
      {rooms.mine.map((r) => (
        <div key={r.id} className="ot-invite mine">
          <b>{r.host === uid ? 'Dein Tisch' : `Tisch von ${r.hostName || '?'}`}</b>
          <span className="muted small">{(r.players || []).map((p) => r.playerInfo?.[p]?.name || '?').join(', ')} · {r.players.length}/{r.maxPlayers} Spieler{r.seatOrder ? ' · läuft' : ' · wartet'}</span>
          <button className="btn" onClick={() => setPlaying({ roomId: r.id, deckId: r.playerInfo?.[uid]?.deckId || deck.id })}>Weiterspielen</button>
          {r.host === uid && <button className="btn ghost small" onClick={() => window.confirm('Tisch für alle auflösen?') && cancelRoom(r.id)}>Auflösen</button>}
        </div>
      ))}
      {beta && (
        <div className="ot-new">
          <p className="muted small">Mit vollem Regelwerk aus deiner Lounge: Stack und Priorität, Manapool, Kampf mit Blockern, Länder-Automatik, Fetch, Crew, Ring, Embleme. Du spielst mit „{deck.name}“, jeder Freund wählt beim Beitreten sein eigenes Deck. Das Spiel startet, sobald alle eingeladenen Spieler da sind (max. 4).</p>
          {fr.length === 0 && <p className="muted small">Noch keine Freunde – unter „Freunde“ hinzufügen.</p>}
          <div className="ot-friends">
            {fr.map(([k, v]) => <label key={k} className="chk"><input type="checkbox" checked={!!pick[k]} onChange={() => setPick({ ...pick, [k]: !pick[k] })} /> {v.name}</label>)}
          </div>
          <button className="btn primary" disabled={busy || !fr.length} onClick={create}>Tisch eröffnen &amp; einladen</button>
        </div>
      )}
      {games.length > 0 && (
        <div className="ot-record">
          <b>Bilanz von „{deck.name}“:</b> {wins} Siege · {losses} Niederlagen{games.length - wins - losses ? ` · ${games.length - wins - losses} offen` : ''}
          <ul>{games.slice(0, 6).map((g, i) => (
            <li key={i}><span className={`pt-res ${g.result}`}>{{ win: 'Sieg', loss: 'Niederlage', draw: 'Unentschieden' }[g.result]}</span> gegen {g.opponents.join(', ')} <span className="muted small">· {new Date(g.at).toLocaleDateString('de-DE')}</span></li>
          ))}</ul>
        </div>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  )
}
