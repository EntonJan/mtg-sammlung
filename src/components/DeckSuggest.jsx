import { useEffect, useMemo, useState } from 'react'
import { loadSuggestions } from '../edhrec'
import { getImagesByName } from '../scryfall'
import Info from './Info'

const LABELS = {
  newcards: 'Neue Karten', highsynergycards: 'Hohe Synergie', topcards: 'Top-Karten', gamechangers: 'Game Changer',
  creatures: 'Kreaturen', instants: 'Spontanzauber', sorceries: 'Hexereien', utilityartifacts: 'Artefakte', enchantments: 'Verzauberungen',
  planeswalkers: 'Planeswalker', utilitylands: 'Besondere Länder', manaartifacts: 'Mana-Artefakte', lands: 'Länder', battles: 'Schlachten',
}

const LIST_INFO = {
  highsynergycards: 'Karten, die bei diesem Commander deutlich öfter gespielt werden als sonst in diesen Farben – also typisch für seine Strategie.',
  topcards: 'Die meistgespielten Karten in Decks mit diesem Commander, unabhängig von der Synergie.',
  newcards: 'Neu erschienene Karten, die bereits in Decks mit diesem Commander auftauchen.',
  gamechangers: 'Karten von der offiziellen Game-Changer-Liste – sie heben das Deck mindestens auf Bracket 3.',
}

// EDHREC-Vorschläge für den Commander – mit Markierung, was du schon besitzt
export default function DeckSuggest({ commanders, rows, ownedByName, onTake, deNames = {} }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('owned')
  const [list, setList] = useState('all')
  const [imgs, setImgs] = useState({})

  const key = commanders.map((c) => c.name).join('|')
  useEffect(() => {
    if (!commanders.length) return
    let alive = true
    setData(null); setError('')
    loadSuggestions(commanders).then((d) => {
      if (!alive) return
      setData(d)
      getImagesByName(d.lists.flatMap((l) => l.cards.map((c) => c.name))).then((m) => alive && setImgs({ ...m })).catch(() => {})
    }).catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Doppelseitige Karten: voller Name „A // B“ und jede Seite einzeln zählen als „im Deck“
  const inDeck = useMemo(() => {
    const s = new Set()
    for (const n of [...commanders.map((c) => c.name), ...rows.map((r) => r.card.name)]) {
      const l = n.toLowerCase()
      s.add(l)
      for (const part of l.split(' // ')) s.add(part.trim())
    }
    return s
  }, [commanders, rows])

  const lists = useMemo(() => {
    if (!data) return []
    return data.lists.map((l) => ({
      ...l,
      label: LABELS[l.tag] || l.header,
      cards: l.cards
        .filter((c) => { const l = c.name.toLowerCase(); return !inDeck.has(l) && !l.split(' // ').some((x) => inDeck.has(x.trim())) })
        .map((c) => ({ ...c, own: ownedByName(c.name) }))
        .filter((c) => filter === 'all' || (filter === 'owned' ? c.own.free > 0 || c.own.decks.length : filter === 'free' ? c.own.free > 0 : !c.own.free && !c.own.decks.length)),
    })).filter((l) => l.cards.length)
  }, [data, inDeck, ownedByName, filter])

  if (!commanders.length) return <p className="muted">Lege zuerst einen Commander fest (★ an der Karte), dann gibt es Vorschläge.</p>
  const shown = list === 'all' ? lists : lists.filter((l) => l.tag === list)

  return (
    <div className="suggest">
      <div className="suggest-head">
        <p className="muted small">
          Beliebte Karten für {commanders.map((c) => c.name).join(' + ')} laut <a href={data?.url} target="_blank" rel="noreferrer">EDHREC</a>.
          Karten, die schon im Deck sind, sind ausgeblendet.{' '}
          <Info>
            <b>Prozent oben links</b> = Spielquote: in wie viel Prozent der Decks mit diesem Commander die Karte steckt.<br />
            <b>Grüne Zahl oben rechts</b> = Synergie: um wie viele Prozentpunkte die Karte bei diesem Commander häufiger gespielt wird als in allen Decks mit denselben Farben. Hohe Synergie = typisch für genau diesen Commander, 0 % = Allrounder wie Sol Ring.
          </Info>
        </p>
        <div className="seg seg-small">
          {[['owned', 'Besitze ich'], ['free', 'Frei verfügbar'], ['missing', 'Fehlt mir'], ['all', 'Alle']].map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        {lists.length > 0 && (
          <select value={list} onChange={(e) => setList(e.target.value)}>
            <option value="all">Alle Listen</option>
            {lists.map((l) => <option key={l.tag} value={l.tag}>{l.label} ({l.cards.length})</option>)}
          </select>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Lade Vorschläge …</p>}
      {data && !shown.length && <p className="muted">Keine passenden Karten.</p>}
      {shown.map((l) => (
        <section key={l.tag} className="deck-raster-group">
          <h3>{l.label} <span className="muted">({l.cards.length})</span>{LIST_INFO[l.tag] && <Info>{LIST_INFO[l.tag]}</Info>}</h3>
          <div className="raster suggest-grid">
            {l.cards.map((c) => (
              <div key={c.name} className={`raster-card sugg ${c.own.free ? 'have' : c.own.decks.length ? 'indeck' : 'missing'}`} title={deNames[c.own.oracleId] ? `${c.name} (${deNames[c.own.oracleId]})` : c.name}>
                {c.own.img || imgs[c.name] ? <img src={c.own.img || imgs[c.name]} alt={c.name} loading="lazy" /> : <div className="sugg-ph">{c.name}</div>}
                {c.pct != null && <span className="sugg-pct" title={`in ${c.decks?.toLocaleString('de-DE')} von ${c.potential?.toLocaleString('de-DE')} Decks`}>{c.pct}%</span>}
                {c.synergy ? <span className="sugg-syn" title="Synergie mit dem Commander">{c.synergy > 0 ? '+' : ''}{Math.round(c.synergy * 100)}%</span> : null}
                <div className="sugg-own">
                  {c.own.free > 0
                    ? <button className="btn small primary" onClick={() => onTake(c.own.pick)}>Ins Deck holen ({c.own.free} frei)</button>
                    : c.own.decks.length ? <span>in {c.own.decks.join(', ')}</span> : <span>fehlt</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
