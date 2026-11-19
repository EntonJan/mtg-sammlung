import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { watchFriends } from '../friends'
import { addEvent, createTable, joinTable, setPrivate, tablesBeta, updateSeat, updateTable, watchMyTables, watchTable, writeSeat } from '../tables'
import { Table } from './DeckPlaytest'
import { fromOwnDeck, newPlayer } from '../playtestCore'

// Online-Spieltisch: Freunde einladen, jeder spielt sein eigenes Deck, alles live über Firestore.
// Regeln setzt die App nicht durch – wie am echten Tisch. Hand und Bibliothek sieht nur der Besitzer.

const PUB = ['life', 'poison', 'cmdDmg', 'tax', 'kept', 'mulls']
const ZPUB = ['bf', 'gy', 'ex', 'cmd']
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// Deck → öffentlicher Platz + private Hand/Bibliothek (7 Karten ausgeteilt)
function seatFromDeck(deck, cards, label) {
  const p = newPlayer(0, label, fromOwnDeck(deck, cards))
  return {
    pub: { deck: deck.name, life: 40, poison: 0, cmdDmg: {}, tax: {}, kept: false, mulls: 0, bf: [], gy: [], ex: [], cmd: p.z.cmd, handCount: p.z.hand.length, libCount: p.z.lib.length, names: p.names },
    priv: { hand: p.z.hand, lib: p.z.lib, handled: 0 },
  }
}

// ---------- Lobby im Reiter „Testspiel“ ----------
export function OnlineLobby({ deck, decks, cards, uid, myName, onOpen }) {
  const beta = tablesBeta(uid)
  const [tables, setTables] = useState({ mine: [], inv: [] })
  const [friends, setFriends] = useState({})
  const [pick, setPick] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [joinDeck, setJoinDeck] = useState({})
  const own = useMemo(() => Object.values(decks).filter((d) => d.kind !== 'binder').sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [decks])
  useEffect(() => watchMyTables(uid, setTables), [uid])
  useEffect(() => (beta ? watchFriends(uid, (l) => setFriends(l || {})) : undefined), [uid, beta])
  const fr = Object.entries(friends).filter(([, v]) => v.status === 'friend')
  const name = myName || 'Ich'

  // Nichts anzeigen, wenn weder freigeschaltet noch eingeladen
  if (!beta && !tables.mine.length && !tables.inv.length) return null

  const create = async () => {
    const invited = Object.keys(pick).filter((k) => pick[k])
    if (!invited.length) { setErr('Wähle mindestens einen Freund.'); return }
    setBusy(true); setErr('')
    try {
      const id = await createTable(uid, name, invited, Object.fromEntries(fr.map(([k, v]) => [k, v.name])))
      const s = seatFromDeck(deck, cards, name)
      await writeSeat(id, uid, s.pub, s.priv)
      await addEvent(id, uid, `${name} hat den Tisch eröffnet (${deck.name})`, 0)
      setPick({}); onOpen(id)
    } catch (e) { setErr('Tisch konnte nicht angelegt werden: ' + e.message) } finally { setBusy(false) }
  }
  const join = async (t) => {
    const d = decks[joinDeck[t.id] || deck.id]
    setBusy(true); setErr('')
    try {
      await joinTable(t.id, uid, name)
      const s = seatFromDeck(d, cards, name)
      await writeSeat(t.id, uid, s.pub, s.priv)
      await addEvent(t.id, uid, `${name} setzt sich an den Tisch (${d.name})`, 0)
      onOpen(t.id)
    } catch (e) { setErr('Beitreten fehlgeschlagen: ' + e.message) } finally { setBusy(false) }
  }

  return (
    <section className="ot-lobby">
      <h3 className="combo-sec">Online-Spieltisch mit Freunden {beta && <span className="chip beta-chip">Beta – nur für dich sichtbar</span>}</h3>
      {tables.inv.map((t) => (
        <div key={t.id} className="ot-invite">
          <b>Einladung von {t.names?.[t.host] || 'einem Freund'}</b>
          <span className="muted small">{t.players.length} am Tisch · {t.status === 'lobby' ? 'wartet auf Spieler' : 'läuft schon'}</span>
          <select value={joinDeck[t.id] || deck.id} onChange={(e) => setJoinDeck({ ...joinDeck, [t.id]: e.target.value })}>
            {own.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button className="btn primary" disabled={busy} onClick={() => join(t)}>Mit diesem Deck beitreten</button>
        </div>
      ))}
      {tables.mine.map((t) => (
        <div key={t.id} className="ot-invite mine">
          <b>{t.host === uid ? 'Dein Tisch' : `Tisch von ${t.names?.[t.host] || '?'}`}</b>
          <span className="muted small">{t.players.map((p) => t.names?.[p] || '?').join(', ')} · {t.status === 'lobby' ? 'Vorbereitung' : `Zug ${t.turn}`}</span>
          <button className="btn" onClick={() => onOpen(t.id)}>Öffnen</button>
        </div>
      ))}
      {beta && (
        <div className="ot-new">
          <p className="muted small">Lade Freunde ein – jeder spielt sein eigenes Deck, ihr seht alles live. Regeln setzt die App nicht durch, wie am echten Tisch. Du spielst mit „{deck.name}“.</p>
          {fr.length === 0 && <p className="muted small">Noch keine Freunde – unter „Freunde“ hinzufügen.</p>}
          <div className="ot-friends">
            {fr.map(([k, v]) => (
              <label key={k} className="chk"><input type="checkbox" checked={!!pick[k]} onChange={() => setPick({ ...pick, [k]: !pick[k] })} /> {v.name}</label>
            ))}
          </div>
          <button className="btn primary" disabled={busy || !fr.length} onClick={create}>Tisch eröffnen &amp; einladen</button>
        </div>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  )
}

// ---------- Laufender Tisch ----------
export function OnlineGame({ tableId, me, onClose }) {
  const [st, setSt] = useState(null)
  useEffect(() => watchTable(tableId, me, setSt), [tableId, me])
  const table = st?.table

  // Aus Tisch + Plätzen + eigener Hand ein Spielobjekt für den Spieltisch bauen
  const game = useMemo(() => {
    if (!table || !st) return null
    const players = (table.order || []).filter((u) => st.seats[u]).map((u) => {
      const s = st.seats[u]; const mine = u === me
      const hidden = (n, k) => Array.from({ length: n || 0 }, (_, i) => ({ uid: `${k}${i}`, name: '?', img: '', type: '', ctr: {} }))
      return {
        id: u, label: table.names?.[u] || '?', deck: s.deck, life: s.life, poison: s.poison, cmdDmg: s.cmdDmg || {}, tax: s.tax || {},
        kept: !!s.kept, mulls: s.mulls || 0, names: s.names || [], showHand: mine,
        z: {
          bf: s.bf || [], gy: s.gy || [], ex: s.ex || [], cmd: s.cmd || [],
          hand: mine ? (st.priv?.hand || []) : hidden(s.handCount, 'h'),
          lib: mine ? (st.priv?.lib || []) : hidden(s.libCount, 'l'),
        },
      }
    })
    return { me, players, order: table.order, active: table.active, turn: table.turn || 1, phase: table.phase, log: st.events.map((e) => ({ t: e.t, msg: e.msg })), attack: null }
  }, [table, st, me])
  const gameRef = useRef(game); gameRef.current = game

  // Änderungen des Spieltischs in Firestore schreiben (nur was sich geändert hat)
  const commit = useCallback(async (cur, next) => {
    const jobs = []
    const tp = {}
    for (const k of ['active', 'turn', 'phase']) if (!same(cur[k], next[k])) tp[k] = next[k]
    if (Object.keys(tp).length) jobs.push(updateTable(tableId, tp))
    for (const n of next.players) {
      const c = cur.players.find((x) => x.id === n.id); if (!c) continue
      const patch = {}
      if (n.id === me) {
        for (const k of PUB) if (!same(c[k], n[k])) patch[k] = n[k]
        for (const k of ZPUB) if (!same(c.z[k], n.z[k])) patch[k] = n.z[k]
        if (c.z.hand.length !== n.z.hand.length) patch.handCount = n.z.hand.length
        if (c.z.lib.length !== n.z.lib.length) patch.libCount = n.z.lib.length
        if (!same(c.z.hand, n.z.hand) || !same(c.z.lib, n.z.lib)) jobs.push(setPrivate(tableId, me, { hand: n.z.hand, lib: n.z.lib, handled: st?.priv?.handled || 0 }))
      } else {
        for (const k of ['life', 'poison', 'cmdDmg']) if (!same(c[k], n[k])) patch[k] = n[k]
      }
      if (Object.keys(patch).length) jobs.push(updateSeat(tableId, n.id, patch))
    }
    for (const l of next.log.slice(cur.log.length)) jobs.push(addEvent(tableId, me, l.msg, l.t))
    await Promise.all(jobs).catch((e) => console.error('Tisch-Sync', e))
  }, [tableId, me, st?.priv?.handled])

  const setGame = useCallback((v) => {
    const cur = gameRef.current; if (!cur) return
    if (v === null) { onClose(); return }
    const next = typeof v === 'function' ? v(cur) : v
    if (next && next !== cur) commit(cur, next)
  }, [commit, onClose])

  // Mein Zug beginnt: enttappen + 1 Karte ziehen (einmal pro Zug; der Startspieler zieht im ersten Zug nicht)
  useEffect(() => {
    if (!game || game.phase !== 'play' || game.active !== me || !st?.priv) return
    const key = game.turn
    if ((st.priv.handled || 0) >= key) return
    const p = game.players.find((x) => x.id === me); if (!p) return
    const first = key === 1 && game.order[0] === me
    const bf = p.z.bf.map((c) => ({ ...c, tapped: false }))
    const lib = [...p.z.lib]; const hand = [...p.z.hand]
    if (!first && lib.length) hand.push(lib.shift())
    setPrivate(tableId, me, { hand, lib, handled: key })
    updateSeat(tableId, me, { bf, handCount: hand.length, libCount: lib.length })
    addEvent(tableId, me, `${p.label} enttappt${first ? '' : lib.length || hand.length ? ' und zieht' : ''}`, key)
  }, [game, me, st?.priv, tableId])

  if (!table) return <p className="muted">Lade Tisch …</p>
  if (table.status === 'ended') return (
    <div className="ot-lobby"><p>Dieser Tisch wurde beendet.</p><button className="btn" onClick={onClose}>Zurück</button></div>
  )

  const isHost = table.host === me
  const leave = async () => {
    if (isHost) { if (!window.confirm('Tisch für alle beenden?')) return; await updateTable(tableId, { status: 'ended' }); await addEvent(tableId, me, `${table.names?.[me]} hat den Tisch beendet`, table.turn || 0) }
    onClose()
  }

  // Vorbereitung: wer sitzt schon, wer ist eingeladen
  if (table.status === 'lobby') {
    const seated = (table.order || []).filter((u) => st.seats[u])
    const waiting = (table.invited || []).filter((u) => !table.players.includes(u))
    return (
      <div className="ot-lobby">
        <h3 className="combo-sec">Tisch wird vorbereitet</h3>
        <ul className="ot-seats">
          {seated.map((u) => <li key={u}><b>{table.names?.[u]}</b> <span className="muted">– {st.seats[u].deck}</span>{u === table.host && <span className="chip">Gastgeber</span>}</li>)}
          {waiting.map((u) => <li key={u} className="muted">{table.names?.[u] || 'Eingeladen'} – noch nicht beigetreten</li>)}
        </ul>
        <p className="muted small">Eingeladene Freunde sehen die Einladung im Reiter „Testspiel“ eines beliebigen Decks.</p>
        <div className="pt-setup-actions">
          {isHost && <button className="btn primary" disabled={seated.length < 2} onClick={async () => { await updateTable(tableId, { status: 'play', phase: 'mull', active: table.order[0], turn: 1 }); await addEvent(tableId, me, 'Spiel gestartet – Starthände ziehen, Mulligan oder behalten', 1) }}>Spiel starten ({seated.length} Spieler)</button>}
          <button className="btn" onClick={onClose}>Zurück</button>
          {isHost && <button className="btn ghost" onClick={leave}>Tisch auflösen</button>}
        </div>
      </div>
    )
  }

  if (!game) return <p className="muted">Lade Tisch …</p>
  return (
    <div>
      <p className="muted small ot-hint">Online-Tisch · Änderungen sehen alle sofort · deine Hand und Bibliothek siehst nur du · bei Mitspielern kannst du Leben, Gift und Commander-Schaden ändern</p>
      <Table game={game} setGame={setGame} deck={{}} onUpdate={() => {}} online={{ isHost, leave }} />
    </div>
  )
}
