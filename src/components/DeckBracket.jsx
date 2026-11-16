import { useEffect, useState } from 'react'
import { comboUrl, estimateBracket, findCombos } from '../spellbook'
import { loadSuggestions } from '../edhrec'
import { suggestTags, tagKey } from '../categories'

const FAST_MANA = /^(Sol Ring|Mana Crypt|Mana Vault|Chrome Mox|Mox Diamond|Mox Opal|Mox Amber|Jeweled Lotus|Lotus Petal|Grim Monolith|Ancient Tomb|Dark Ritual|Cabal Ritual|Simian Spirit Guide|Elvish Spirit Guide|Mana Drain|Arcane Signet|Fellwar Stone|Talisman of .*|.* Signet|Birds of Paradise|Llanowar Elves|Elvish Mystic|Fyndhorn Elves|Avacyn's Pilgrim|Noble Hierarch|Deathrite Shaman|Carpet of Flowers|Utopia Sprawl|Wild Growth)$/

// Spielstärke-Schätzung (0–10) aus Tempo, Ressourcen, Interaktion, Tutoren, Combos und Commander-Synergie
function powerOf(deck, commanders, rows, combos, edh) {
  const nonland = rows.filter((r) => !/Land/.test((r.card.type || '').split(' // ')[0]))
  const n = (pred) => nonland.reduce((t, r) => t + (pred(r) ? r.qty : 0), 0)
  const tagsOf = (c) => { const own = deck.tags?.[tagKey(c)]; return own?.length ? own : suggestTags(c) }
  const cmc = nonland.length ? nonland.reduce((t, r) => t + (r.card.cmc || 0) * r.qty, 0) / nonland.reduce((t, r) => t + r.qty, 0) : 0
  const ramp = n((r) => tagsOf(r.card).includes('Ramp'))
  const draw = n((r) => tagsOf(r.card).includes('Draw'))
  const inter = n((r) => tagsOf(r.card).some((t) => t === 'Removal' || t === 'Board Wipe'))
  const tutors = n((r) => tagsOf(r.card).includes('Tutor'))
  const fast = n((r) => FAST_MANA.test(r.card.name))
  const multi = combos.filter((v) => v.uses.length >= 3).length
  // Synergie: Durchschnitt der EDHREC-Synergie der Deckkarten mit dem Commander
  let syn = null, known = 0
  if (edh) {
    const m = new Map()
    for (const l of edh.lists) for (const c of l.cards) if (!m.has(c.name)) m.set(c.name, c)
    const vals = []
    for (const r of nonland) { const c = m.get(r.card.name) || m.get(r.card.name.split(' // ')[0]); if (c) { known++; vals.push(c.synergy || 0) } }
    if (vals.length >= 5) syn = vals.reduce((a, b) => a + b, 0) / vals.length
  }
  const f = []
  const add = (label, pts, max, detail) => f.push({ label, pts: Math.min(pts, max), max, detail })
  add('Tempo (Ø Manawert)', cmc <= 2.6 ? 2 : cmc <= 3.0 ? 1.5 : cmc <= 3.4 ? 1 : cmc <= 3.8 ? 0.5 : 0, 2, `Ø ${cmc.toFixed(2)} ohne Länder`)
  add('Ramp & schnelles Mana', (ramp >= 12 ? 1 : ramp >= 9 ? 0.6 : ramp >= 6 ? 0.3 : 0) + Math.min(fast * 0.15, 0.5), 1.5, `${ramp} Ramp, davon ${fast} schnelles Mana`)
  add('Kartenvorteil', draw >= 12 ? 1.5 : draw >= 9 ? 1 : draw >= 6 ? 0.5 : 0, 1.5, `${draw} Draw-Karten`)
  add('Interaktion', inter >= 12 ? 1.5 : inter >= 9 ? 1 : inter >= 6 ? 0.5 : 0, 1.5, `${inter} Removal/Board Wipes`)
  add('Tutoren', tutors * 0.35, 1, `${tutors} Tutoren`)
  add('Combos (3+ Karten)', multi * 0.35, 1, `${multi} im Deck`)
  if (syn != null) add('Synergie mit dem Commander', syn >= 0.3 ? 1.5 : syn >= 0.2 ? 1.1 : syn >= 0.12 ? 0.7 : syn >= 0.06 ? 0.3 : 0, 1.5, `Ø ${Math.round(syn * 100)} % Synergie (EDHREC, ${known} Karten erkannt)`)
  else add('Synergie mit dem Commander', 0, 1.5, edh === undefined ? 'wird geladen …' : 'keine EDHREC-Daten')
  const score = Math.round(f.reduce((t, x) => t + x.pts, 0) * 10) / 10
  const plays = score >= 7.5 ? 4 : score >= 4.5 ? 3 : score >= 2.5 ? 2 : 1
  return { score, plays, f }
}

const NAMES = { 1: 'Exhibition', 2: 'Core', 3: 'Upgraded', 4: 'Optimized', 5: 'cEDH' }
const SB_TAG = {
  E: 'Exhibition', C: 'Core', O: 'Oddball (ungewöhnlich)', P: 'Powerful (stark)', S: 'Spicy (scharf)', R: 'Ruthless (gnadenlos)', B: 'enthält gebannte Karten',
}

// Bracket-Check nach den offiziellen Commander-Brackets, Daten von Commander Spellbook
export default function DeckBracket({ deck, commanders, rows }) {
  const [res, setRes] = useState(null)
  const [error, setError] = useState('')
  const [deckCombos, setDeckCombos] = useState([])
  const [edh, setEdh] = useState(undefined)
  useEffect(() => {
    let alive = true
    findCombos(commanders, rows).then((c) => alive && setDeckCombos(c.included)).catch(() => {})
    if (commanders.length) loadSuggestions(commanders).then((d) => alive && setEdh(d)).catch(() => alive && setEdh(null))
    else setEdh(null)
    return () => { alive = false }
  }, [deck.id, rows.length]) // eslint-disable-line react-hooks/exhaustive-deps
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

  const power = powerOf(deck, commanders, rows, deckCombos, edh)
  const eff = Math.max(min, power.plays)

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
      <div className="power">
        <div className="power-head">
          <div className={`bracket-badge b${eff}`}>
            <span className="bracket-num">{eff === 1 ? '1–2' : eff}</span>
            <span className="bracket-name">spielt sich wie</span>
          </div>
          <div className="bracket-why">
            <b>Spielstärke-Einschätzung: {power.score.toLocaleString('de-DE')} / 10</b>
            <p className="muted small">
              {eff > min
                ? `Formal reicht Bracket ${min === 2 ? '1–2' : min}, aber Tempo, Ressourcen und Synergie sprechen eher für Bracket ${eff}. Für faire Partien lieber so ansagen.`
                : 'Passt zum Mindest-Bracket – die Spielstärke liegt nicht höher als die Regeln vorgeben.'}
            </p>
            <div className="power-bar"><span style={{ width: `${power.score * 10}%` }} /></div>
          </div>
        </div>
        <div className="power-factors">
          {power.f.map((x) => (
            <div key={x.label} className="power-f">
              <span>{x.label}</span>
              <span className="power-track"><span style={{ width: `${(x.pts / x.max) * 100}%` }} /></span>
              <span className="muted small">{x.detail}</span>
            </div>
          ))}
        </div>
        <p className="muted small">Eine Schätzung, keine offizielle Einstufung. Kategorien (Ramp, Draw …) kommen aus deinen Tags im Reiter „Kategorien“, sonst aus dem Kartentext.</p>
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
