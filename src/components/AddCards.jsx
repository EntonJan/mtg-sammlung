import { useEffect, useRef, useState } from 'react'
import { autocomplete, searchCards } from '../scryfall'
import { entryKey } from '../store'
import { euro } from '../util'

// Karten manuell über die Scryfall-Suche hinzufügen
export default function AddCards({ entries, onChange }) {
  const [q, setQ] = useState('')
  const [suggest, setSuggest] = useState([])
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef()

  useEffect(() => {
    clearTimeout(timer.current)
    if (q.length < 2) { setSuggest([]); return }
    timer.current = setTimeout(async () => setSuggest(await autocomplete(q)), 200)
  }, [q])

  async function run(query) {
    setSuggest([])
    setLoading(true)
    setError('')
    try {
      setResults(await searchCards(query))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const pick = (name) => { setQ(name); run(`!"${name}"`) }

  return (
    <div className="add">
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); if (q.trim()) run(q.trim()) }}>
        <div className="ac">
          <input
            className="search"
            placeholder="Kartenname (englisch oder deutsch) oder Scryfall-Suche, z. B. t:dragon c:r"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          {suggest.length > 0 && (
            <ul className="ac-list">
              {suggest.map((s) => <li key={s} onMouseDown={() => pick(s)}>{s}</li>)}
            </ul>
          )}
        </div>
        <button className="btn primary" type="submit">Suchen</button>
      </form>

      {loading && <p className="muted">Suche …</p>}
      {error && <p className="error">{error}</p>}
      {!loading && results.length === 0 && q && !suggest.length && <p className="muted">Enter drücken zum Suchen.</p>}

      <div className="add-results">
        {results.map((c) => {
          const n = entries[entryKey(c.id, 'normal')]?.qty || 0
          const fo = entries[entryKey(c.id, 'foil')]?.qty || 0
          return (
            <div key={c.id} className="add-card">
              <img src={c.thumb} alt={c.name} loading="lazy" />
              <div className="add-info">
                <b>{c.name}</b>
                <span className="muted small">{c.setName} ({c.set} #{c.num})</span>
                <div className="add-line">
                  <span>Normal {euro(c.eur)}</span>
                  <span className="stepper">
                    <button onClick={() => onChange(c, 'normal', -1)} disabled={!n}>−</button>
                    <b>{n}</b>
                    <button onClick={() => onChange(c, 'normal', +1)}>+</button>
                  </span>
                </div>
                <div className="add-line">
                  <span>Foil {euro(c.eurFoil)}</span>
                  <span className="stepper">
                    <button onClick={() => onChange(c, 'foil', -1)} disabled={!fo}>−</button>
                    <b>{fo}</b>
                    <button onClick={() => onChange(c, 'foil', +1)}>+</button>
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
