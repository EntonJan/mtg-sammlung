import { useEffect } from 'react'
import { FINISH_LABEL, cardmarketUrl, unitPrice, euro } from '../util'
import Mana from './Mana'
import { deckIcon, deckLabel, heldEntries, targetGroups } from '../konsole'

// Detailansicht: großes Bild, Regeltext, freie Exemplare (Sammlung) und Exemplare in Decks.
// Verschieben per Auswahlfeld – funktioniert auch am Handy, wo Drag & Drop nicht geht.
export default function CardDetail({ card, entries, decks, cards, onChange, onMove, onClose, deName }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const same = (e) => e.qty > 0 && cards[e.id] && (cards[e.id].oracleId || cards[e.id].name) === (card.oracleId || card.name)
  const byVersion = (a, b) => (cards[a.id].set + a.finish).localeCompare(cards[b.id].set + b.finish)

  const free = Object.values(entries).filter(same).sort(byVersion)
  const inDecks = Object.values(decks)
    .map((d) => ({ deck: d, items: Object.values(d.entries).filter(same).sort(byVersion) }))
    .filter((x) => x.items.length)
  const deckList = Object.values(decks).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  // Ziel-Auswahl gruppiert: Decks, Konsolen (🎮 Core, 💾 Core › Modul) und Ordner getrennt
  const targetOptions = (exclude, prefix = '') => targetGroups(decks, { exclude }).map((g) => (
    <optgroup key={g.label} label={g.label}>{g.items.map((d) => <option key={d.id} value={d.id}>{prefix}{d.label}</option>)}</optgroup>
  ))

  const freeTotal = free.reduce((s, e) => s + e.qty, 0)
  // Geschwister-Module einer Konsole teilen sich Exemplare → physisch gehaltene Anzahl
  const deckTotal = Object.values(heldEntries(decks)).filter(same).reduce((s, e) => s + e.qty, 0)

  const version = (e) => {
    const c = cards[e.id]
    return (
      <span className="ver">
        {c.setName} <span className="muted">({c.set} #{c.num})</span>
        {e.finish !== 'normal' && <em className="foil">{FINISH_LABEL[e.finish]}</em>}
      </span>
    )
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Schließen">×</button>
        <img className="detail-img" src={card.img} alt={card.name} />
        <div className="detail-info">
          <h2>{card.name} <Mana cost={card.cost} /></h2>
          {deName && deName !== card.name && <p className="de-name">🇩🇪 {deName}</p>}
          <p className="muted">{card.type}</p>
          <p className="oracle">{card.text}</p>
          <p className="small">
            <a className="cm-link" href={cardmarketUrl(card)} target="_blank" rel="noreferrer">Auf Cardmarket ansehen / verkaufen ↗</a>
          </p>
          <p className="muted small">
            Commander: {card.legalCmd === 'legal' ? 'legal' : card.legalCmd === 'banned' ? 'gebannt' : 'nicht legal'}
          </p>

          <h3>In der Sammlung ({freeTotal})</h3>
          <div className="owned">
            {free.map((e) => (
              <div key={`${e.id}|${e.finish}`} className="owned-row">
                {version(e)}
                <span className="price">{euro(unitPrice(cards[e.id], e.finish))}</span>
                <span className="stepper">
                  <button onClick={() => onChange(cards[e.id], e.finish, -1)}>−</button>
                  <b>{e.qty}</b>
                  <button onClick={() => onChange(cards[e.id], e.finish, +1)}>+</button>
                </span>
                {deckList.length > 0 && (
                  <select
                    className="move-select"
                    value=""
                    onChange={(ev) => ev.target.value && onMove({ id: e.id, finish: e.finish, from: 'collection' }, ev.target.value)}
                  >
                    <option value="">→ in Deck / Ordner …</option>
                    {targetOptions(null)}
                  </select>
                )}
              </div>
            ))}
            {!free.length && <p className="muted">Kein freies Exemplar in der Sammlung.</p>}
          </div>

          {inDecks.length > 0 && (
            <>
              <h3>In Decks & Ordnern ({deckTotal})</h3>
              <div className="owned">
                {inDecks.flatMap(({ deck, items }) => items.map((e) => (
                  <div key={`${deck.id}|${e.id}|${e.finish}`} className="owned-row">
                    <span className="ver"><b>{deckIcon(deck)}{deckLabel(deck, decks)}</b> · {e.qty}× {version(e)}</span>
                    <select
                      className="move-select" value=""
                      onChange={(ev) => ev.target.value && onMove({ id: e.id, finish: e.finish, from: deck.id }, ev.target.value)}
                    >
                      <option value="">verschieben …</option>
                      <option value="collection">↩ zurück in die Sammlung</option>
                      {targetOptions(deck.id, '→ ')}
                    </select>
                  </div>
                )))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
