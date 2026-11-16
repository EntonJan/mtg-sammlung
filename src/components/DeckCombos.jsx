import { useEffect, useMemo, useState } from 'react'
import { comboUrl, findCombos } from '../spellbook'

// Combos im Deck + Combos, denen genau eine Karte fehlt (mit Hinweis, ob du sie schon besitzt)
export default function DeckCombos({ deck, commanders, rows, owned, deNames = {}, onTake }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState({})
  const [onlyOwned, setOnlyOwned] = useState(false)

  const inDeck = useMemo(() => new Set([...commanders.map((c) => c.oracleId), ...rows.map((r) => r.card.oracleId)]), [commanders, rows])

  const run = () => {
    setBusy(true); setError('')
    findCombos(commanders, rows).then(setData).catch((e) => setError(e.message)).finally(() => setBusy(false))
  }
  useEffect(() => { if (rows.length) run() }, [deck.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const missingOf = (v) => v.uses.filter((u) => !inDeck.has(u.card.oracleId))
  const almost = useMemo(() => {
    if (!data) return []
    return data.almost
      .map((v) => {
        const miss = missingOf(v)
        const own = miss.map((u) => owned(u.card.oracleId))
        return { v, miss, own, ownedAll: own.every((o) => o.free > 0 || o.decks.length) }
      })
      .sort((a, b) => (b.ownedAll - a.ownedAll) || (b.v.popularity || 0) - (a.v.popularity || 0))
  }, [data, inDeck, owned]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!rows.length) return <p className="muted">Das Deck ist noch leer.</p>
  const shownAlmost = onlyOwned ? almost.filter((a) => a.ownedAll) : almost

  return (
    <div className="combos">
      <div className="combos-head">
        <p className="muted small">Daten von <a href="https://commanderspellbook.com" target="_blank" rel="noreferrer">Commander Spellbook</a>. Sideboard zählt nicht mit.</p>
        <button className="btn small" onClick={run} disabled={busy}>{busy ? 'Suche …' : 'Neu prüfen'}</button>
      </div>
      {error && <p className="error">{error}</p>}
      {busy && !data && <p className="muted">Suche Combos …</p>}
      {data && <>
        <h3 className="combo-sec">Im Deck <span className="muted">({data.included.length})</span></h3>
        {!data.included.length && <p className="muted small">Keine bekannten Combos im Deck.</p>}
        {data.included.map((v) => <Combo key={v.id} v={v} open={open[v.id]} toggle={() => setOpen((o) => ({ ...o, [v.id]: !o[v.id] }))} deNames={deNames} />)}

        <h3 className="combo-sec">
          Fehlt nur eine Karte <span className="muted">({almost.length})</span>
          <label className="small muted combo-filter"><input type="checkbox" checked={onlyOwned} onChange={(e) => setOnlyOwned(e.target.checked)} /> nur Karten, die ich besitze</label>
        </h3>
        {!shownAlmost.length && <p className="muted small">Nichts gefunden.</p>}
        {shownAlmost.map(({ v, miss, own }) => (
          <Combo key={v.id} v={v} missing={new Set(miss.map((u) => u.card.oracleId))} open={open[v.id]} toggle={() => setOpen((o) => ({ ...o, [v.id]: !o[v.id] }))} deNames={deNames}
            hint={miss.map((u, i) => (
              <span key={u.card.oracleId} className={`combo-need ${own[i].free ? 'have' : own[i].decks.length ? 'deck' : 'no'}`}>
                {u.card.name}: {own[i].free ? `${own[i].free}× frei in der Sammlung` : own[i].decks.length ? `nur in ${own[i].decks.join(', ')}` : 'besitzt du nicht'}
                {own[i].free > 0 && own[i].pick && <button className="btn small primary combo-take" onClick={() => onTake(own[i].pick)}>Ins Deck holen</button>}
              </span>
            ))} />
        ))}
      </>}
    </div>
  )
}

function Combo({ v, open, toggle, missing, hint, deNames }) {
  return (
    <div className={`combo ${open ? 'open' : ''}`}>
      <div className="combo-cards" onClick={toggle}>
        {v.uses.map((u) => (
          <div key={u.card.id} className={`combo-card ${missing?.has(u.card.oracleId) ? 'missing' : ''}`} title={deNames[u.card.oracleId] ? `${u.card.name} (${deNames[u.card.oracleId]})` : u.card.name}>
            <img src={u.card.imageUriFrontSmall || u.card.imageUriFrontNormal} alt={u.card.name} loading="lazy" />
            {missing?.has(u.card.oracleId) && <span className="combo-miss">fehlt</span>}
          </div>
        ))}
      </div>
      <div className="combo-body">
        <div className="combo-produces">{v.produces.map((p) => <span key={p.feature.id || p.feature.name} className="chip">{p.feature.name}</span>)}</div>
        {hint && <div className="combo-hint">{hint}</div>}
        <div className="combo-meta muted small">
          {v.manaValueNeeded ? `Mana nötig: ${v.manaValueNeeded} · ` : ''}{v.popularity ? `in ${v.popularity.toLocaleString('de-DE')} Decks · ` : ''}
          <button className="linklike" onClick={toggle}>{open ? 'Ablauf ausblenden' : 'Ablauf anzeigen'}</button>
          {' · '}<a href={comboUrl(v.id)} target="_blank" rel="noreferrer">Spellbook ↗</a>
        </div>
        {open && (
          <div className="combo-steps">
            {(v.easyPrerequisites || v.notablePrerequisites) && <p><b>Voraussetzungen:</b> {[v.easyPrerequisites, v.notablePrerequisites].filter(Boolean).join(' ')}</p>}
            <ol>{(v.description || '').split('\n').filter(Boolean).map((s, i) => <li key={i}>{s}</li>)}</ol>
          </div>
        )}
      </div>
    </div>
  )
}
