import { deckIcon, deckLabel } from '../konsole'
import { useMemo, useState } from 'react'
import { parseDecklist } from '../decklist'
import { FINISH_LABEL, euro, unitPrice } from '../util'

const norm = (n) => n.toLowerCase().replace(/\s+/g, ' ').trim()

// Karten raussuchen: Liste einfügen (Archidekt, Moxfield, Text) → zeigt, wo die Karten liegen → per Klick austragen
export default function PullView({ entries, decks, cards, deNames = {}, onRemove, onOpen }) {
  const [text, setText] = useState('')
  const [list, setList] = useState(null)       // [{ name, qty }]
  const [inclDecks, setInclDecks] = useState(false)
  const [asSale, setAsSale] = useState(false)
  const [snap, setSnap] = useState({})         // Stand beim Einlesen: name → { owned, card }

  // Alle eigenen Exemplare nach Name: frei, in Ordnern, (optional) in Decks
  const byName = useMemo(() => {
    const m = {}
    const add = (e, from, label) => {
      const c = cards[e.id]
      if (!c) return
      const item = { id: e.id, finish: e.finish, qty: e.qty, from, label, card: c, price: unitPrice(c, e.finish) }
      for (const k of new Set([norm(c.name), norm(c.name.split(' // ')[0])])) (m[k] ||= []).push(item)
    }
    Object.values(entries).forEach((e) => add(e, 'collection', 'Sammlung'))
    for (const d of Object.values(decks)) Object.values(d.entries).forEach((e) => add(e, d.id, `${deckIcon(d)}${deckLabel(d, decks)}`, d.kind))
    return m
  }, [entries, decks, cards])

  const kindOf = (from) => (from === 'collection' ? 'free' : decks[from]?.kind === 'binder' ? 'binder' : 'deck')

  const read = () => {
    const lines = parseDecklist(text)
    const m = {}
    for (const l of lines) m[l.name] = (m[l.name] || 0) + l.qty
    const sn = {}
    for (const name of Object.keys(m)) {
      const all = byName[norm(name)] || byName[norm(name.split(' // ')[0])] || []
      sn[name] = { owned: all.reduce((t, x) => t + x.qty, 0), card: all[0]?.card }
    }
    setSnap(sn)
    setList(Object.entries(m).map(([name, qty]) => ({ name, qty })))
  }

  const rows = useMemo(() => {
    if (!list) return []
    return list.map((l) => {
      const all = (byName[norm(l.name)] || byName[norm(l.name.split(' // ')[0])] || [])
        .filter((x) => inclDecks || kindOf(x.from) !== 'deck')
        // frei zuerst, dann Ordner, dann Decks; normal vor Foil; günstigste zuerst
        .sort((a, b) => ['free', 'binder', 'deck'].indexOf(kindOf(a.from)) - ['free', 'binder', 'deck'].indexOf(kindOf(b.from))
          || (a.finish === 'normal' ? 0 : 1) - (b.finish === 'normal' ? 0 : 1) || (a.price ?? 0) - (b.price ?? 0))
      // Ausgetragen = was seit dem Einlesen weniger geworden ist (passt dadurch auch nach Strg+Z)
      const now = (byName[norm(l.name)] || byName[norm(l.name.split(' // ')[0])] || []).reduce((t, x) => t + x.qty, 0)
      const done = Math.max(0, (snap[l.name]?.owned || 0) - now)
      const left = Math.max(0, l.qty - done)
      const have = all.reduce((t, x) => t + x.qty, 0)
      return { ...l, all, left, have, card: snap[l.name]?.card }
    })
  }, [list, byName, inclDecks, snap]) // eslint-disable-line react-hooks/exhaustive-deps

  const found = rows.filter((r) => r.card)
  const missing = rows.filter((r) => !r.card)
  const open = found.filter((r) => r.left > 0)
  // Es wird nie mehr ausgetragen als auf der Liste steht – nur so viele, wie noch offen UND vorhanden sind
  const toTake = open.reduce((t, r) => t + Math.min(r.left, r.have), 0)

  const take = (r, x, q = 1) => {
    onRemove([{ id: x.id, finish: x.finish, qty: q, from: x.from, price: x.price }], asSale)
  }
  // Für alle offenen Karten die vorgeschlagenen (ersten passenden) Exemplare austragen
  const takeAll = () => {
    const out = []
    for (const r of open) {
      let need = r.left
      for (const x of r.all) {
        if (!need) break
        const q = Math.min(need, x.qty)
        out.push({ id: x.id, finish: x.finish, qty: q, from: x.from, price: x.price })
        need -= q
      }
    }
    onRemove(out, asSale)
  }

  if (!list) {
    return (
      <div className="import pull">
        <h2>Karten raussuchen</h2>
        <p className="muted">
          Liste einfügen – z. B. eine Wunschliste oder ein Deck aus Archidekt/Moxfield (<code>1 Sol Ring</code>, <code>1x Command Tower (CMM) 410</code>).
          Die App zeigt dir, wo die Karten in deiner Sammlung liegen, und du trägst sie per Klick aus.
        </p>
        <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={'1 Sol Ring\n1 Arcane Signet\n1 Swords to Plowshares'} />
        <div className="hist-save">
          <button className="btn primary" disabled={!text.trim()} onClick={read}>Liste abgleichen</button>
        </div>
      </div>
    )
  }

  return (
    <div className="import pull">
      <h2>Karten raussuchen <button className="btn small" onClick={() => setList(null)}>‹ Neue Liste</button></h2>
      <div className="pull-bar">
        <span><b>{found.length}</b> von {rows.length} Karten gefunden</span>
        <span className="muted">· noch offen: <b>{open.reduce((s, r) => s + r.left, 0)}</b></span>
        <label className="check-line small"><input type="checkbox" checked={inclDecks} onChange={(e) => setInclDecks(e.target.checked)} /> auch Karten aus Decks zeigen</label>
        <label className="check-line small"><input type="checkbox" checked={asSale} onChange={(e) => setAsSale(e.target.checked)} /> als verkauft protokollieren (Trendpreis)</label>
        <button className="btn primary small" disabled={!toTake} onClick={takeAll}>{toTake ? `Genau die Listenmenge austragen (${toTake} Karten)` : 'Nichts mehr offen'}</button>
      </div>
      <p className="muted small">Es wird immer nur die Anzahl ausgetragen, die auf der Liste steht – hast du eine Karte 5×, die Liste will 1×, bleiben 4 in deiner Sammlung. Reihenfolge: erst freie Exemplare, dann Ordner – normal vor Foil, günstigste zuerst. Ausgetragen heißt: aus der Sammlung entfernt. Rückgängig mit Strg+Z.</p>

      <div className="pull-list">
        {found.map((r) => (
          <div key={r.name} className={`pull-row ${r.left === 0 ? 'done' : ''}`}>
            <img src={r.card.thumb || r.card.img} alt="" onClick={() => onOpen(r.card)} />
            <div className="pull-main">
              <div className="pull-name">
                <b>{r.name}</b>
                {deNames[r.card.oracleId] && <span className="muted small"> · {deNames[r.card.oracleId]}</span>}
                <span className={`pull-count ${r.left === 0 ? 'ok-text' : ''}`}>
                  {r.left === 0 ? '✓ erledigt' : <>gesucht <b>{r.qty}</b> · noch offen <b>{r.left}</b> · du hast <b>{r.have}</b>{r.have > r.left && <span className="muted"> → {r.have - r.left} bleiben</span>}</>}
                </span>
              </div>
              <div className="pull-where">
                {r.all.map((x) => (
                  <button key={`${x.from}|${x.id}|${x.finish}`} className={`pull-chip ${kindOf(x.from)}`} disabled={r.left === 0}
                    onClick={() => take(r, x)} title="1 Exemplar austragen">
                    <span>{x.label}</span>
                    <span className="muted small">{x.card.set.toUpperCase()} #{x.card.num}{x.finish !== 'normal' ? ` · ${FINISH_LABEL[x.finish]}` : ''} · {x.qty}× · {euro(x.price)}</span>
                    <b>− 1</b>
                  </button>
                ))}
                {!r.all.length && r.left > 0 && <span className="muted small">Kein weiteres Exemplar {inclDecks ? 'vorhanden' : 'frei oder in Ordnern – evtl. „auch Karten aus Decks zeigen“ anhaken'}.</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {missing.length > 0 && (
        <section className="stat-card">
          <h3>Nicht in deiner Sammlung <span className="muted">({missing.length})</span></h3>
          <p className="muted small">{missing.map((r) => `${r.qty}× ${r.name}`).join(' · ')}</p>
        </section>
      )}
    </div>
  )
}
