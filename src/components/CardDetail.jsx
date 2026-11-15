import { useEffect } from 'react'
import { FINISH_LABEL, unitPrice, euro } from '../util'
import Mana from './Mana'

// Detailansicht: großes Bild, Regeltext und alle eigenen Versionen mit +/- Knöpfen
export default function CardDetail({ card, entries, cards, onChange, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const key = card.oracleId || card.name
  const owned = Object.values(entries)
    .filter((e) => e.qty > 0 && cards[e.id] && (cards[e.id].oracleId || cards[e.id].name) === key)
    .sort((a, b) => (cards[a.id].set + a.finish).localeCompare(cards[b.id].set + b.finish))
  const total = owned.reduce((s, e) => s + e.qty, 0)

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Schließen">×</button>
        <img className="detail-img" src={card.img} alt={card.name} />
        <div className="detail-info">
          <h2>{card.name} <Mana cost={card.cost} /></h2>
          <p className="muted">{card.type}</p>
          <p className="oracle">{card.text}</p>
          <p className="muted small">
            Commander: {card.legalCmd === 'legal' ? 'legal' : card.legalCmd === 'banned' ? 'gebannt' : 'nicht legal'}
          </p>

          <h3>Deine Exemplare ({total})</h3>
          <div className="owned">
            {owned.map((e) => {
              const c = cards[e.id]
              return (
                <div key={`${e.id}|${e.finish}`} className="owned-row">
                  <span>{c.setName} <span className="muted">({c.set} #{c.num})</span>
                    {e.finish !== 'normal' && <em className="foil">{FINISH_LABEL[e.finish]}</em>}
                  </span>
                  <span className="price">{euro(unitPrice(c, e.finish))}</span>
                  <span className="stepper">
                    <button onClick={() => onChange(c, e.finish, -1)}>−</button>
                    <b>{e.qty}</b>
                    <button onClick={() => onChange(c, e.finish, +1)}>+</button>
                  </span>
                </div>
              )
            })}
            {!owned.length && <p className="muted">Keine Exemplare mehr in der Sammlung.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
