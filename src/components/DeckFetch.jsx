import { useMemo, useState } from 'react'
import { FINISH_LABEL } from '../util'

// „Karte holen“: eigene Karte suchen und ins Deck legen – aus der Sammlung
// oder, wenn kein freies Exemplar mehr da ist, aus einem anderen Deck umlegen.
export default function DeckFetch({ deck, entries, decks, cards, onMove, deNames = {}, onNew }) {
  const [q, setQ] = useState('')

  // Alle Fundorte je Karte (oracleId): Sammlung + andere Decks
  const sources = useMemo(() => {
    const m = new Map()
    const add = (e, from, label) => {
      const c = cards[e.id]; if (!c) return
      const k = c.oracleId || c.name
      if (!m.has(k)) m.set(k, { name: c.name, de: deNames[c.oracleId] || '', list: [] })
      m.get(k).list.push({ ...e, from, label, card: c })
    }
    for (const e of Object.values(entries)) add(e, 'collection', 'Sammlung')
    for (const d of Object.values(decks)) {
      if (d.id === deck.id) continue
      for (const e of Object.values(d.entries)) add(e, d.id, d.name)
    }
    return m
  }, [entries, decks, cards, deck.id, deNames])

  const hits = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (t.length < 2) return []
    return [...sources.values()].filter((s) => s.name.toLowerCase().includes(t) || s.de.toLowerCase().includes(t)).slice(0, 8)
  }, [q, sources])

  return (
    <div className="fetch">
      <div className="fetch-bar">
        <input className="search" placeholder="Karte suchen (Sammlung, andere Decks, neu) …" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn small" onClick={() => onNew(q.trim())} title="Karte, die du noch nicht in der App hast: neu ins Deck und damit in die Sammlung">+ Neue Karte (Deck + Sammlung)</button>
      </div>
      {hits.length > 0 && (
        <div className="fetch-list">
          {hits.map((h) => (
            <div key={h.name} className="fetch-item">
              <b>{h.name}</b>{h.de && h.de !== h.name && <span className="muted small"> · {h.de}</span>}
              <div className="fetch-sources">
                {h.list
                  .sort((a, b) => (a.from !== 'collection') - (b.from !== 'collection'))
                  .map((x) => (
                    <button
                      key={`${x.from}|${x.id}|${x.finish}`}
                      className={`btn small ${x.from === 'collection' ? 'primary' : ''}`}
                      title={`${x.card.setName} (${x.card.set} #${x.card.num})`}
                      onClick={() => onMove({ id: x.id, finish: x.finish, from: x.from }, deck.id)}
                    >
                      {x.from === 'collection' ? 'Aus Sammlung' : `Aus „${x.label}“ umlegen`} · {x.card.set}
                      {x.finish !== 'normal' ? ` ${FINISH_LABEL[x.finish]}` : ''} ({x.qty})
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {q.trim().length >= 2 && !hits.length && (
        <p className="muted small">
          Diese Karte ist noch nicht in deiner Sammlung.{' '}
          <button className="btn small primary" onClick={() => onNew(q.trim())}>„{q.trim()}“ diesem Deck und der Sammlung hinzufügen</button>
        </p>
      )}
      {hits.length > 0 && <p className="muted small">Weiteres echtes Exemplar, das noch fehlt? <button className="linklike" onClick={() => onNew(q.trim())}>Neu zu Deck + Sammlung hinzufügen</button></p>}
    </div>
  )
}
