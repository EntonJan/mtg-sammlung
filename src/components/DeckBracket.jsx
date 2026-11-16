import { useEffect, useState } from 'react'
import { comboUrl, estimateBracket } from '../spellbook'

const NAMES = { 1: 'Exhibition', 2: 'Core', 3: 'Upgraded', 4: 'Optimized', 5: 'cEDH' }
const SB_TAG = {
  E: 'Exhibition', C: 'Core', O: 'Oddball (ungewöhnlich)', P: 'Powerful (stark)', S: 'Spicy (scharf)', R: 'Ruthless (gnadenlos)', B: 'enthält gebannte Karten',
}

// Bracket-Check nach den offiziellen Commander-Brackets, Daten von Commander Spellbook
export default function DeckBracket({ deck, commanders, rows }) {
  const [res, setRes] = useState(null)
  const [error, setError] = useState('')
  const run = () => { setError(''); estimateBracket(commanders, rows).then(setRes).catch((e) => setError(e.message)) }
  useEffect(() => { if (rows.length) run() }, [deck.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!rows.length) return null
  const cards = res?.cards || []
  const gc = cards.filter((c) => c.gameChanger)
  const banned = cards.filter((c) => c.banned)
  const mld = cards.filter((c) => c.massLandDenial)
  const extra = cards.filter((c) => c.extraTurn)
  const combos = (res?.combos || []).filter((c) => c.relevant || c.definitelyTwoCard || c.arguablyTwoCard)
  const twoCard = combos.filter((c) => c.definitelyTwoCard)
  const comboMld = combos.filter((c) => c.massLandDenial)

  let min = 2
  const why = []
  if (gc.length) { min = 3; why.push(`${gc.length} Game Changer (Bracket 3 erlaubt bis zu 3)`) }
  if (gc.length > 3) { min = 4; why[why.length - 1] = `${gc.length} Game Changer – mehr als 3 nur ab Bracket 4` }
  if (mld.length || comboMld.length) { min = 4; why.push('Massen-Landzerstörung – erst ab Bracket 4') }
  if (twoCard.length) { min = Math.max(min, 3); why.push(`${twoCard.length} Zwei-Karten-Combo(s) – in Bracket 3 nur, wenn sie nicht früh im Spiel greifen`) }
  if (extra.length > 1) why.push('Mehrere Extra-Züge – Ketten von Extra-Zügen sind erst ab Bracket 4 vorgesehen')
  if (!why.length) why.push('Keine Game Changer, keine Landzerstörung, keine Zwei-Karten-Combos – passt zu Bracket 1–2 (Bracket 1 hängt vom Thema/Anspruch ab)')

  return (
    <div className="bracket">
      <div className="bracket-head">
        <div className={`bracket-badge b${min}`}>
          <span className="bracket-num">{min === 2 && !gc.length && !twoCard.length ? '1–2' : min}{min === 4 ? '+' : ''}</span>
          <span className="bracket-name">Bracket · {min === 2 ? 'Exhibition / Core' : NAMES[min]}</span>
        </div>
        <div className="bracket-why">
          <b>Mindest-Bracket nach den offiziellen Regeln</b>
          <ul>{why.map((w) => <li key={w}>{w}</li>)}</ul>
          {res?.bracketTag && <p className="muted small">Commander Spellbook stuft das Deck ein als: <b>{SB_TAG[res.bracketTag] || res.bracketTag}</b></p>}
          <p className="muted small">Game Changer laut offizieller Liste (Scryfall), Landzerstörung und Extra-Züge anhand des Kartentexts.</p>
        </div>
        <button className="btn small" onClick={run}>Neu prüfen</button>
      </div>
      {error && <p className="error">{error}</p>}
      {!res && !error && <p className="muted small">Prüfe Deck …</p>}
      {res && (
        <div className="bracket-lists">
          <List title="Game Changer" items={gc.map((c) => c.card.name)} />
          <List title="Gebannt" items={banned.map((c) => c.card.name)} bad />
          <List title="Massen-Landzerstörung" items={mld.map((c) => c.card.name)} bad />
          <List title="Extra-Züge" items={extra.map((c) => c.card.name)} />
          <List title="Zwei-Karten-Combos" items={twoCard.map((c) => (
            <a key={c.combo.id} href={comboUrl(c.combo.id)} target="_blank" rel="noreferrer">{c.combo.uses.map((u) => u.card.name).join(' + ')}</a>
          ))} />
        </div>
      )}
    </div>
  )
}

function List({ title, items, bad }) {
  if (!items.length) return null
  return (
    <div className={`bracket-list ${bad ? 'bad' : ''}`}>
      <h4>{title} <span className="muted">({items.length})</span></h4>
      <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  )
}
