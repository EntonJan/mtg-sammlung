import { useState } from 'react'
import { COLOR_NAMES } from '../util'

// Commander-Pool: mehrere mögliche Commander, gruppiert nach Farbe.
// „Würfeln“ zieht je Gruppe einen zufälligen Commander (z. B. 1 grünen + 1 weißen Partner).
const poolGroupKey = (card) => (card.colors.length ? [...card.colors].sort().join('') : 'C')
const groupLabel = (k) => k.split('').map((c) => COLOR_NAMES[c]).join('-')

export default function CommanderPool({ deck, rows, onUpdate, onOpen }) {
  const [rolled, setRolled] = useState(null)
  const [spinning, setSpinning] = useState(false)
  const pool = new Set(deck.pool || [])
  const poolRows = rows.filter((r) => pool.has(r.key))
  if (!poolRows.length) return null

  const groups = {}
  for (const r of poolRows) (groups[poolGroupKey(r.card)] ||= []).push(r)

  const roll = () => {
    setSpinning(true)
    let ticks = 0
    const tick = () => {
      const pick = Object.fromEntries(Object.entries(groups).map(([k, list]) => [k, list[Math.floor(Math.random() * list.length)]]))
      setRolled(pick)
      if (++ticks < 12) setTimeout(tick, 60 + ticks * 12)
      else setSpinning(false)
    }
    tick()
  }

  const apply = () => onUpdate({ commanders: Object.values(rolled).map((r) => r.key) })
  const active = new Set(deck.commanders)

  return (
    <section className="pool">
      <div className="cat-top">
        <h3>Commander-Pool <span className="muted">({poolRows.length})</span></h3>
        <button className="btn primary" onClick={roll} disabled={spinning}>🎲 Würfeln</button>
      </div>
      <div className="pool-groups">
        {Object.entries(groups).map(([k, list]) => (
          <div key={k} className="pool-group">
            <span className="muted small">{groupLabel(k)}</span>
            {list.map((r) => (
              <span key={r.key} className={`pool-card ${active.has(r.key) ? 'active' : ''} ${rolled?.[k]?.key === r.key ? 'rolled' : ''}`}
                onClick={() => onOpen(r.card)}>
                {r.card.name}
              </span>
            ))}
          </div>
        ))}
      </div>
      {rolled && (
        <div className="pool-result">
          <div className="pool-imgs">
            {Object.values(rolled).map((r) => <img key={r.key} src={r.card.img} alt={r.card.name} className={spinning ? 'spin' : ''} />)}
          </div>
          {!spinning && (
            <div className="hand-actions">
              <b>{Object.values(rolled).map((r) => r.card.name).join(' + ')}</b>
              <button className="btn" onClick={apply}>Als aktive Commander setzen</button>
            </div>
          )}
        </div>
      )}
      {Object.keys(groups).length < 2 && (
        <p className="muted small">Tipp: Der Würfel zieht einen Commander pro Farbe. Bei einem grün-weißen Partner-Deck also je einen grünen und einen weißen.</p>
      )}
    </section>
  )
}
