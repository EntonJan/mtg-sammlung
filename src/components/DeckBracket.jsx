import { useEffect, useState } from 'react'
import { comboUrl, estimateBracket, findCombos } from '../spellbook'
import { loadSuggestions } from '../edhrec'
import { analyzeSynergy } from '../synergy'
import { suggestTags, tagKey } from '../categories'
import Info from './Info'

const INFO = {
  'Tempo (Ø Manawert)': 'Durchschnittlicher Manawert aller Nicht-Länder. Je niedriger, desto schneller kommt das Deck ins Spiel. Volle Punkte bis Ø 2,6.',
  'Ramp & schnelles Mana': 'Karten mit der Kategorie „Ramp“ plus besonders schnelles Mana (Sol Ring, Signets, Mana-Elfen …). Volle Punkte ab 12 Ramp.',
  'Kartenvorteil': 'Karten mit der Kategorie „Draw“. Volle Punkte ab 12.',
  'Interaktion': 'Karten mit „Removal“ oder „Board Wipe“. Volle Punkte ab 12.',
  'Tutoren': 'Karten, die eine beliebige Karte aus der Bibliothek suchen (nicht nur Länder). Je Tutor 0,35 Punkte.',
  'Combos (3+ Karten)': 'Combos aus 3 oder mehr Karten, die komplett im Deck stecken (Commander Spellbook). Zwei-Karten-Combos zählen schon beim Mindest-Bracket.',
  'Interne Synergie': 'Wie stark die Karten untereinander zusammenspielen – aus dem Reiter „Synergie“: Anteil der Nicht-Länder, die stark vernetzt sind: mindestens ein Partner mit hoher Synergie (2+ verbundene Teileffekte) oder mindestens 7 verschiedene Partner. Länder zählen nicht mit. Volle Punkte ab 60 %.',
  'Passung zum Commander': 'Wie gut das Deck auf genau diesen Commander zugeschnitten ist – aus EDHREC-Daten: 40 % Abdeckung (Anteil deiner Karten, die EDHREC für diesen Commander empfiehlt), 30 % Spielquote (wie oft diese Karten in Decks mit dem Commander stecken) und 30 % Synergie-Karten (Anteil mit deutlich überdurchschnittlicher Synergie). Allrounder wie Signets zählen damit auch mit, wenn sie typisch für den Commander sind.',
}

const FAST_MANA = /^(Sol Ring|Mana Crypt|Mana Vault|Chrome Mox|Mox Diamond|Mox Opal|Mox Amber|Jeweled Lotus|Lotus Petal|Grim Monolith|Ancient Tomb|Dark Ritual|Cabal Ritual|Simian Spirit Guide|Elvish Spirit Guide|Mana Drain|Arcane Signet|Fellwar Stone|Talisman of .*|.* Signet|Birds of Paradise|Llanowar Elves|Elvish Mystic|Fyndhorn Elves|Avacyn's Pilgrim|Noble Hierarch|Deathrite Shaman|Carpet of Flowers|Utopia Sprawl|Wild Growth)$/

// Spielstärke-Schätzung (0–10) aus Tempo, Ressourcen, Interaktion, Tutoren, Combos und Passung zum Commander
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
  // Commander-Passung (0–100 %) aus drei EDHREC-Signalen – reine Durchschnitts-Synergie wäre zu niedrig,
  // weil starke Allrounder (Signets, Removal) fast 0 % Synergie haben, obwohl sie perfekt ins Deck passen:
  //  · Abdeckung: Anteil deiner Nicht-Land-Karten, die EDHREC für diesen Commander überhaupt empfiehlt
  //  · Spielquote: wie oft die erkannten Karten in Decks mit diesem Commander stecken (Ø, 50 %+ = voll)
  //  · Synergie-Karten: Anteil der Karten mit deutlich positiver Synergie (≥ 10 %), 40 %+ = voll
  let fit = null, known = 0, detail = ''
  if (edh) {
    const m = new Map()
    for (const l of edh.lists) for (const c of l.cards) if (!m.has(c.name)) m.set(c.name, c)
    const hits = []
    for (const r of nonland) { const c = m.get(r.card.name) || m.get(r.card.name.split(' // ')[0]); if (c) hits.push(c) }
    known = hits.length
    if (nonland.length >= 10 && known >= 5) {
      const coverage = known / nonland.length
      const incl = hits.reduce((t, c) => t + (c.pct || 0), 0) / known / 100
      const synShare = hits.filter((c) => (c.synergy || 0) >= 0.1).length / nonland.length
      fit = 0.4 * Math.min(1, coverage / 0.8) + 0.3 * Math.min(1, incl / 0.5) + 0.3 * Math.min(1, synShare / 0.4)
      detail = `${Math.round(fit * 100)} % Passung · ${known}/${nonland.length} Karten von EDHREC empfohlen · Ø ${Math.round(incl * 100)} % Spielquote · ${Math.round(synShare * 100)} % Synergie-Karten`
    }
  }
  const f = []
  const add = (label, pts, max, detail) => f.push({ label, pts: Math.min(pts, max), max, detail, info: INFO[label] })
  add('Tempo (Ø Manawert)', cmc <= 2.6 ? 2 : cmc <= 3.0 ? 1.5 : cmc <= 3.4 ? 1 : cmc <= 3.8 ? 0.5 : 0, 2, `Ø ${cmc.toFixed(2)} ohne Länder`)
  add('Ramp & schnelles Mana', (ramp >= 12 ? 1 : ramp >= 9 ? 0.6 : ramp >= 6 ? 0.3 : 0) + Math.min(fast * 0.15, 0.5), 1.5, `${ramp} Ramp, davon ${fast} schnelles Mana`)
  add('Kartenvorteil', draw >= 12 ? 1.5 : draw >= 9 ? 1 : draw >= 6 ? 0.5 : 0, 1.5, `${draw} Draw-Karten`)
  add('Interaktion', inter >= 12 ? 1.5 : inter >= 9 ? 1 : inter >= 6 ? 0.5 : 0, 1.5, `${inter} Removal/Board Wipes`)
  add('Tutoren', tutors * 0.35, 1, `${tutors} Tutoren`)
  add('Combos (3+ Karten)', multi * 0.35, 1, `${multi} im Deck`)
  if (fit != null) add('Passung zum Commander', fit >= 0.75 ? 1 : fit >= 0.6 ? 0.75 : fit >= 0.45 ? 0.5 : fit >= 0.3 ? 0.2 : 0, 1, detail)
  else add('Passung zum Commander', 0, 1, edh === undefined ? 'wird geladen …' : known ? 'zu wenige Karten erkannt' : 'keine EDHREC-Daten')
  // Rohpunkte (0–10) auf die Bracket-Skala 1–5 abbilden: 2,5 → 2 · 4,5 → 3 · 7,5 → 4 · 10 → 5
  // Interne Synergie: wie stark die Karten untereinander vernetzt sind (Reiter „Synergie“)
  const syn = analyzeSynergy([...commanders.map((c) => ({ key: c.id, card: c, qty: 1, isCommander: true })), ...rows.map((r) => ({ key: r.key || r.card.id, card: r.card, qty: r.qty }))])
  const st = syn.strongShare
  add('Interne Synergie', st >= 0.6 ? 1 : st >= 0.45 ? 0.7 : st >= 0.3 ? 0.4 : st >= 0.15 ? 0.2 : 0, 1, `${Math.round(st * 100)} % stark vernetzt · ${syn.high} Paare mit hoher Synergie`)
  const raw = f.reduce((t, x) => t + x.pts, 0)
  const pts = [[0, 1], [2.5, 2], [4.5, 3], [7.5, 4], [10, 5]]
  let score = 5
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]
    if (raw <= x1) { score = y0 + ((raw - x0) / (x1 - x0)) * (y1 - y0); break }
  }
  score = Math.round(score * 10) / 10
  const plays = Math.min(4, Math.floor(score))
  const edge = plays < 4 && score - plays >= 0.6
  return { score, plays, edge, f }
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
          <b>Mindest-Bracket nach den offiziellen Regeln <Info>Die offiziellen Commander-Brackets: Bracket 1–2 ohne Game Changer, Massen-Landzerstörung und frühe Zwei-Karten-Combos; Bracket 3 erlaubt bis zu 3 Game Changer; ab Bracket 4 ist alles erlaubt. Die Game-Changer-Liste kommt von Scryfall.</Info></b>
          <ul>{why.map((w) => <li key={w}>{w}</li>)}</ul>
          {res?.bracketTag && <p className="muted small">Commander Spellbook stuft das Deck ein als: <b>{SB_TAG[res.bracketTag] || res.bracketTag}</b></p>}
          <p className="muted small">Game Changer laut offizieller Liste (Scryfall), Landzerstörung und Extra-Züge anhand des Kartentexts.</p>
        </div>
        <button className="btn small" onClick={run}>Neu prüfen</button>
      </div>
      <div className="power">
        <div className="power-head">
          <div className={`bracket-badge b${eff}`}>
            <span className="bracket-num">{power.score.toLocaleString('de-DE', { minimumFractionDigits: 1 })}</span>
            <span className="bracket-name">Spielstärke · Bracket {eff === 1 ? '1–2' : eff}</span>
          </div>
          <div className="bracket-why">
            <b><Info>Eine Schätzung von 1 bis 5 auf der Bracket-Skala: Tempo, Ressourcen, Interaktion, Tutoren, Combos und die Passung zum Commander ergeben Rohpunkte (0–10), die auf 1–5 umgerechnet werden. Ab x,6 gibt es den Hinweis „an der Grenze zum nächsten Bracket“.</Info> Spielstärke: {power.score.toLocaleString('de-DE', { minimumFractionDigits: 1 })} von 5 – spielt sich wie Bracket {eff === 1 ? '1–2' : eff}</b>
            <p className="muted small">
              {eff > min
                ? `Formal reicht Bracket ${min === 2 ? '1–2' : min}, aber Tempo, Ressourcen und die Passung zum Commander sprechen eher für Bracket ${eff}. Für faire Partien lieber so ansagen.`
                : 'Passt zum Mindest-Bracket – die Spielstärke liegt nicht höher als die Regeln vorgeben.'}
              {power.edge && eff === power.plays && <> <b className="power-edge">Starkes Bracket {eff} – an der Grenze zu Bracket {eff + 1}.</b></>}
            </p>
            <div className="power-bar">
              {[2, 3, 4].map((b) => <i key={b} style={{ left: `${((b - 1) / 4) * 100}%` }} />)}
              <span style={{ width: `${((power.score - 1) / 4) * 100}%` }} />
            </div>
            <div className="power-scale muted small"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>
          </div>
        </div>
        <div className="power-factors">
          {power.f.map((x) => (
            <div key={x.label} className="power-f">
              <span>{x.label} {x.info && <Info>{x.info}</Info>}</span>
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
