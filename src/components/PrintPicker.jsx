import { useEffect, useState } from 'react'
import { searchCards } from '../scryfall'
import { entryKey } from '../store'
import { euro, unitPrice } from '../util'

const FIN = { normal: 'Normal', foil: 'Foil', etched: 'Etched', proxy: 'Proxy' }

// Druckversion (Printing) einer Deckkarte ändern.
// „Korrigieren“: die Karte im Deck war falsch erfasst → Eintrag wird umgeschrieben (Sammlung ändert sich mit).
// „Tauschen“: freies Exemplar dieser Version aus der Sammlung nehmen, das bisherige geht zurück in die Sammlung.
export default function PrintPicker({ row, entries, onApply, onClose }) {
  const [prints, setPrints] = useState(null)
  const [error, setError] = useState('')
  const [finish, setFinish] = useState(row.finish)
  const [qty, setQty] = useState(row.qty)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let alive = true
    const q = row.card.oracleId ? `oracleid:${row.card.oracleId}` : `!"${row.card.name}"`
    searchCards(q).then((r) => alive && setPrints(r)).catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [row.card.oracleId, row.card.name])

  const shown = (prints || []).filter((c) => !filter || `${c.setName} ${c.set} ${c.num}`.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal print-picker" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Schließen">×</button>
        <div className="pp-head">
          <h2>Printing ändern: {row.card.name}</h2>
          <p className="muted small">
            Aktuell: {row.card.setName} ({row.card.set.toUpperCase()} #{row.card.num}) · {FIN[row.finish]} · {row.qty}× im Deck.
            <br /><b>Korrigieren</b> = die Karte war falsch erfasst (die Sammlung ändert sich mit).
            <b> Tauschen</b> = ein freies Exemplar aus der Sammlung ins Deck nehmen, das bisherige wird frei.
          </p>
          <div className="pp-controls">
            <label>Ausführung{' '}
              <select value={finish} onChange={(e) => setFinish(e.target.value)}>
                {['normal', 'foil', 'etched', 'proxy'].map((f) => <option key={f} value={f}>{FIN[f]}</option>)}
              </select>
            </label>
            {row.qty > 1 && (
              <label>Anzahl{' '}
                <input type="number" min="1" max={row.qty} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(row.qty, Number(e.target.value) || 1)))} />
                <span className="muted"> von {row.qty}</span>
              </label>
            )}
            <input className="search" placeholder="Edition filtern …" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
        {!prints && !error && <p className="muted">Lade Druckversionen …</p>}
        {error && <p className="error">{error}</p>}
        <div className="pp-grid">
          {shown.map((c) => {
            const same = c.id === row.id && finish === row.finish
            const free = entries[entryKey(c.id, finish)]?.qty || 0
            const price = unitPrice(c, finish)
            return (
              <div key={c.id} className={`pp-card ${c.id === row.id ? 'current' : ''}`}>
                <img src={c.thumb || c.img} alt={c.name} loading="lazy" />
                <div className="pp-info">
                  <b title={c.setName}>{c.setName}</b>
                  <span className="muted small">{c.set.toUpperCase()} #{c.num} · {(c.released || '').slice(0, 4)}</span>
                  <span className="small">{price != null ? euro(price) : '–'}{free > 0 && <span className="ok-text"> · {free} frei in Sammlung</span>}</span>
                  {same ? <span className="muted small">aktuell</span> : (
                    <span className="pp-actions">
                      <button className="btn small primary" onClick={() => onApply(c, finish, qty, 'fix')}>Korrigieren</button>
                      {free > 0 && <button className="btn small" onClick={() => onApply(c, finish, Math.min(qty, free), 'swap')}>Tauschen</button>}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
