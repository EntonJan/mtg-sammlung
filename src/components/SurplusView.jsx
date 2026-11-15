import { useMemo, useState } from 'react'
import { euro, unitPrice } from '../util'

const isBasic = (c) => /Basic Land/.test(c.type) || /A deck can have any number/.test(c.text || '')

// Überzählige Karten: freie Exemplare über einer Wunschanzahl („behalten“) – gute Tausch-/Verkaufskandidaten
export default function SurplusView({ entries, decks, cards, onMoveMany, onOpen }) {
  const [keep, setKeep] = useState(1)
  const [minValue, setMinValue] = useState('')
  const [target, setTarget] = useState('')
  const [copied, setCopied] = useState(false)

  const binders = Object.values(decks).filter((d) => d.kind === 'binder')

  const rows = useMemo(() => {
    const m = new Map()
    for (const e of Object.values(entries)) {
      const c = cards[e.id]; if (!c || isBasic(c)) continue
      const k = c.oracleId
      if (!m.has(k)) m.set(k, { card: c, free: [], freeQty: 0, inDecks: 0 })
      const r = m.get(k); r.free.push(e); r.freeQty += e.qty
    }
    for (const d of Object.values(decks)) {
      for (const e of Object.values(d.entries)) {
        const c = cards[e.id]; if (!c) continue
        const r = m.get(c.oracleId); if (r) r.inDecks += e.qty
      }
    }
    const out = []
    for (const r of m.values()) {
      const surplus = r.freeQty - keep
      if (surplus <= 0) continue
      // Behalten: die teuerste Version; überzählig: der Rest (günstigste zuerst)
      const copies = r.free.flatMap((e) => Array.from({ length: e.qty }, () => ({ id: e.id, finish: e.finish, price: unitPrice(cards[e.id], e.finish) ?? 0 })))
      copies.sort((a, b) => b.price - a.price)
      const extra = copies.slice(keep)
      const value = extra.reduce((s, x) => s + x.price, 0)
      out.push({ ...r, surplus, extra, value })
    }
    return out.filter((r) => !minValue || r.value >= Number(minValue)).sort((a, b) => b.value - a.value)
  }, [entries, decks, cards, keep, minValue])

  const totalCards = rows.reduce((s, r) => s + r.surplus, 0)
  const totalValue = rows.reduce((s, r) => s + r.value, 0)

  const moveAll = () => {
    if (!target) return
    const list = []
    for (const r of rows) {
      const agg = {}
      for (const x of r.extra) { const k = `${x.id}|${x.finish}`; agg[k] = { id: x.id, finish: x.finish, qty: (agg[k]?.qty || 0) + 1, from: 'collection' } }
      list.push(...Object.values(agg))
    }
    onMoveMany(list, target)
  }

  const copy = async () => {
    const text = rows.map((r) => `${r.surplus} ${r.card.name} – ${euro(r.value)}`).join('\n') + `\n\nGesamt: ${totalCards} Karten · ${euro(totalValue)}`
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* egal */ }
  }

  return (
    <div className="import wish">
      <h2>Überzählige Karten</h2>
      <p className="muted">
        Karten, von denen du mehr freie Exemplare hast, als du behalten willst. Standardländer zählen nicht.
        Pro Karte bleibt die teuerste Version in der Sammlung.
      </p>
      <div className="hand-actions">
        <label className="muted small">Behalten pro Karte
          <select value={keep} onChange={(e) => setKeep(Number(e.target.value))} style={{ marginLeft: 6 }}>
            {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="muted small">Überschuss ab €
          <input type="number" min="0" step="0.5" value={minValue} onChange={(e) => setMinValue(e.target.value)} style={{ width: 70, marginLeft: 6 }} />
        </label>
      </div>
      <div className="stat-tiles">
        <div className="tile-stat"><span className="muted small">Überzählige Exemplare</span><b>{totalCards}</b></div>
        <div className="tile-stat"><span className="muted small">Wert</span><b>{euro(totalValue)}</b></div>
        <div className="tile-stat"><span className="muted small">Verschiedene Karten</span><b>{rows.length}</b></div>
      </div>
      <div className="match-actions">
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Ordner wählen …</option>
          {binders.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button className="btn primary" disabled={!target || !rows.length} onClick={moveAll}>Alle {totalCards} in den Ordner verschieben</button>
        <button className="btn" disabled={!rows.length} onClick={copy}>{copied ? 'Kopiert ✓' : 'Liste kopieren'}</button>
      </div>
      {!binders.length && <p className="muted small">Tipp: Lege links einen Ordner an (z. B. „Tauschordner“), dann kannst du die Überschüsse mit einem Klick dorthin verschieben.</p>}

      <table className="match-table">
        <thead><tr><th>Karte</th><th>frei</th><th>in Decks</th><th>überzählig</th><th>Wert</th></tr></thead>
        <tbody>
          {rows.slice(0, 300).map((r) => (
            <tr key={r.card.oracleId} onClick={() => onOpen(r.card)} style={{ cursor: 'pointer' }}>
              <td>{r.card.name}</td>
              <td>{r.freeQty}</td>
              <td>{r.inDecks || ''}</td>
              <td><b>{r.surplus}</b></td>
              <td>{euro(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 300 && <p className="muted small">… und {rows.length - 300} weitere. Mit „Überschuss ab €“ eingrenzen.</p>}
    </div>
  )
}
