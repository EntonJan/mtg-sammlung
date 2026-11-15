import { useMemo, useState } from 'react'
import { FINISH_LABEL } from '../util'

// „Karte holen“: eigene Karte suchen und ins Deck legen – aus der Sammlung
// oder, wenn kein freies Exemplar mehr da ist, aus einem anderen Deck umlegen.
export default function DeckFetch({ deck, entries, decks, cards, onMove }) {
  const [q, setQ] = useState('')

  // Alle Fundorte je Karte (oracleId): Sammlung + andere Decks
  const sources = useMemo(() => {
    const m = new Map()
    const add = (e, from, label) => {
      const c = cards[e.id]; if (!c) return
      const k = c.oracleId || c.name
      if (!m.has(k)) m.set(k, { name: c.name, list: [] })
      m.get(k).list.push({ ...e, from, label, card: c })
    }
    for (const e of Object.values(entries)) add(e, 'collection', 'Sammlung')
    for (const d of Object.values(decks)) {
      if (d.id === deck.id) continue
      for (const e of Object.values(d.entries)) add(e, d.id, d.name)
    }
    return m
  }, [entries, decks, cards, deck.id])

  const hits = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (t.length < 2) return []
    return [...sources.values()].filter((s) => s.name.toLowerCase().includes(t)).slice(0, 8)
  }, [q, sources])

  return (
    <div className="fetch">
      <input className="search" placeholder="Karte aus Sammlung oder anderem Deck holen …" value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.length > 0 && (
        <div className="fetch-list">
          {hits.map((h) => (
            <div key={h.name} className="fetch-item">
              <b>{h.name}</b>
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
      {q.trim().length >= 2 && !hits.length && <p className="muted small">Diese Karte besitzt du nicht – weder frei noch in einem Deck.</p>}
    </div>
  )
}
