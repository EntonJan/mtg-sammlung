import { useState } from 'react'
import { readDrag } from '../drag'
import { GROUPS, euro } from '../util'

// Linke Leiste: „Sammlung“ + alle Decks. Jeder Eintrag ist ein Ablageziel für Drag & Drop.
export default function Sidebar({ view, setView, freeCount, catCounts, decks, deckStats, onDrop, onCreate, open, onClose }) {
  const [over, setOver] = useState(null)
  const [newName, setNewName] = useState('')

  const list = Object.values(decks).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))

  const target = (key) => ({
    onDragOver: (e) => { if (e.dataTransfer.types.includes('application/x-mtg-card')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(key) } },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e) => { e.preventDefault(); setOver(null); const d = readDrag(e); if (d) onDrop(d, key) },
  })

  const go = (v) => { setView(v); onClose?.() }

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div
        className={`side-item main ${view.kind === 'collection' && !view.cat ? 'on' : ''} ${over === 'collection' ? 'over' : ''}`}
        onClick={() => go({ kind: 'collection' })}
        {...target('collection')}
      >
        <span className={`caret ${view.kind === 'collection' ? 'open' : ''}`}>▸</span>
        <span className="side-name">Sammlung</span>
        <span className="side-count">{freeCount.toLocaleString('de-DE')}</span>
      </div>
      {view.kind === 'collection' && (
        <div className="side-sub">
          {GROUPS.filter(([k]) => catCounts[k]).map(([k, label]) => (
            <div
              key={k}
              className={`side-item sub ${view.cat === k ? 'on' : ''}`}
              onClick={() => go(view.cat === k ? { kind: 'collection' } : { kind: 'collection', cat: k })}
              {...target('collection')}
            >
              <span className="side-name">{label}</span>
              <span className="side-count">{catCounts[k].toLocaleString('de-DE')}</span>
            </div>
          ))}
        </div>
      )}

      <div className="side-head">Decks</div>
      <div className="side-list">
        {list.map((d) => {
          const s = deckStats[d.id] || { count: 0, value: 0 }
          return (
            <div
              key={d.id}
              className={`side-item ${view.kind === 'deck' && view.id === d.id ? 'on' : ''} ${over === d.id ? 'over' : ''}`}
              onClick={() => go({ kind: 'deck', id: d.id })}
              {...target(d.id)}
              title={`${s.count} Karten · ${euro(s.value)}`}
            >
              <span className="side-name">{d.name}</span>
              <span className={`side-count ${s.count === 100 ? 'full' : ''}`}>{s.count}</span>
            </div>
          )
        })}
        {!list.length && <p className="side-empty">Noch keine Decks. Lege unten eins an und ziehe Karten darauf.</p>}
      </div>

      <form
        className="side-new"
        onSubmit={(e) => { e.preventDefault(); if (newName.trim()) { const id = onCreate(newName.trim()); setNewName(''); go({ kind: 'deck', id }) } }}
      >
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="+ Neues Deck" />
      </form>
    </aside>
  )
}
