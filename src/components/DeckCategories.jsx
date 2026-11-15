import { useState } from 'react'
import { catsOf, suggestTags, tagKey } from '../categories'

// Reiter „Kategorien“: Sollwerte, Fortschritt, automatische Vorschläge
export default function DeckCategories({ deck, rows, onUpdate }) {
  const [newCat, setNewCat] = useState('')
  const cats = catsOf(deck)
  const tags = deck.tags || {}

  const count = (name) => rows.reduce((s, r) => s + ((tags[tagKey(r.card)] || []).includes(name) ? r.qty : 0), 0)
  const cardsIn = (name) => rows.filter((r) => (tags[tagKey(r.card)] || []).includes(name))

  const untagged = rows.filter((r) => !(tags[tagKey(r.card)] || []).length)
  const suggestions = untagged.map((r) => ({ r, s: suggestTags(r.card) })).filter((x) => x.s.length)

  const setCats = (next) => onUpdate({ cats: next })
  const applySuggestions = () => {
    const next = { ...tags }
    for (const { r, s } of suggestions) next[tagKey(r.card)] = s.filter((x) => cats.some((c) => c.name === x))
    onUpdate({ tags: next })
  }

  return (
    <div className="cats">
      <div className="cats-actions">
        <button className="btn primary" disabled={!suggestions.length} onClick={applySuggestions}>
          Vorschläge übernehmen ({suggestions.length})
        </button>
        <span className="muted small">
          Ordnet Karten ohne Kategorie anhand des Regeltexts zu – bitte kurz prüfen.
          Einzelne Karten änderst du in der Liste über 🏷.
        </span>
      </div>

      <div className="cat-grid">
        {cats.map((c, i) => {
          const n = count(c.name)
          const pct = c.target ? Math.min(100, (n / c.target) * 100) : 0
          const state = !c.target ? '' : n >= c.target ? 'ok' : n >= c.target * 0.7 ? 'mid' : 'low'
          return (
            <section key={c.name} className="stat-card cat-card">
              <div className="cat-top">
                <h3>{c.name}</h3>
                <span className={`cat-count ${state}`}>{n}</span>
                <span className="muted">/</span>
                <input
                  type="number" min="0" className="cat-target" value={c.target}
                  onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, target: Number(e.target.value) } : x)))}
                  title="Sollwert"
                />
                <button className="mini" title="Kategorie entfernen"
                  onClick={() => setCats(cats.filter((_, j) => j !== i))}>×</button>
              </div>
              <div className="hbar-track"><span className={state} style={{ width: `${pct}%` }} /></div>
              <ul className="cat-cards">
                {cardsIn(c.name).map((r) => <li key={r.key}>{r.qty > 1 ? `${r.qty}× ` : ''}{r.card.name}</li>)}
              </ul>
            </section>
          )
        })}
      </div>

      <form className="cat-new" onSubmit={(e) => {
        e.preventDefault()
        const n = newCat.trim()
        if (n && !cats.some((c) => c.name === n)) setCats([...cats, { name: n, target: 0 }])
        setNewCat('')
      }}>
        <input placeholder="Neue Kategorie, z. B. Tokens oder Lifegain" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
        <button className="btn" type="submit">Hinzufügen</button>
      </form>
    </div>
  )
}

// Kleines Auswahlfenster an einer Kartenzeile
export function TagPicker({ deck, card, onUpdate, onClose }) {
  const cats = catsOf(deck)
  const key = tagKey(card)
  const current = (deck.tags || {})[key] || []
  const toggle = (name) => {
    const next = current.includes(name) ? current.filter((x) => x !== name) : [...current, name]
    onUpdate({ tags: { ...(deck.tags || {}), [key]: next } })
  }
  return (
    <div className="tag-picker" onClick={(e) => e.stopPropagation()}>
      {cats.map((c) => (
        <label key={c.name}>
          <input type="checkbox" checked={current.includes(c.name)} onChange={() => toggle(c.name)} /> {c.name}
        </label>
      ))}
      <button className="btn small" onClick={onClose}>Fertig</button>
    </div>
  )
}
