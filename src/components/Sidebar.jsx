import { useState } from 'react'
import { readDrag } from '../drag'
import { GROUPS, euro } from '../util'

// Linke Leiste: „Sammlung“ + alle Decks. Jeder Eintrag ist ein Ablageziel für Drag & Drop.
export default function Sidebar({ view, setView, freeCount, catCounts, subCounts, decks, deckStats, onDrop, onCreate, open, onClose }) {
  const [over, setOver] = useState(null)
  const [newName, setNewName] = useState('')
  const [subFilter, setSubFilter] = useState('')

  const all = Object.values(decks).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  const list = all.filter((d) => d.kind !== 'binder')
  const binders = all.filter((d) => d.kind === 'binder')
  const [newKind, setNewKind] = useState('deck')

  const target = (key) => ({
    onDragOver: (e) => { if (e.dataTransfer.types.includes('application/x-mtg-card')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(key) } },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e) => { e.preventDefault(); setOver(null); const d = readDrag(e); if (d) onDrop(d, key) },
  })

  const go = (v) => { setView(v); onClose?.() }

  const Entry = ({ d, binder }) => {
    const st = deckStats[d.id] || { count: 0, value: 0 }
    return (
      <div
        className={`side-item ${view.kind === 'deck' && view.id === d.id ? 'on' : ''} ${over === d.id ? 'over' : ''}`}
        onClick={() => go({ kind: 'deck', id: d.id })}
        {...target(d.id)}
        title={`${st.count} Karten · ${euro(st.value)}`}
      >
        {binder && <span className="side-icon">📁</span>}
        <span className="side-name">{d.name}</span>
        <span className={`side-count ${!binder && st.count === 100 ? 'full' : ''}`}>{st.count}</span>
      </div>
    )
  }

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
          {GROUPS.filter(([k]) => catCounts[k]).map(([k, label]) => {
            const subs = Object.entries(subCounts[k] || {})
              .filter(([st]) => !subFilter || st.toLowerCase().includes(subFilter.toLowerCase()))
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            const openCat = view.cat === k
            return (
              <div key={k}>
                <div
                  className={`side-item sub ${openCat && !view.sub ? 'on' : ''}`}
                  onClick={() => { setSubFilter(''); go(openCat && !view.sub ? { kind: 'collection' } : { kind: 'collection', cat: k }) }}
                  {...target('collection')}
                >
                  <span className={`caret ${openCat ? 'open' : ''}`} style={{ visibility: Object.keys(subCounts[k] || {}).length ? 'visible' : 'hidden' }}>▸</span>
                  <span className="side-name">{label}</span>
                  <span className="side-count">{catCounts[k].toLocaleString('de-DE')}</span>
                </div>
                {openCat && Object.keys(subCounts[k] || {}).length > 0 && (
                  <div className="side-subsub">
                    {Object.keys(subCounts[k]).length > 12 && (
                      <input className="sub-filter" placeholder="Untertyp suchen …" value={subFilter}
                        onChange={(e) => setSubFilter(e.target.value)} onClick={(e) => e.stopPropagation()} />
                    )}
                    {subs.map(([st, n]) => (
                      <div
                        key={st}
                        className={`side-item subsub ${view.sub === st ? 'on' : ''}`}
                        onClick={() => go(view.sub === st ? { kind: 'collection', cat: k } : { kind: 'collection', cat: k, sub: st })}
                        {...target('collection')}
                      >
                        <span className="side-name">{st}</span>
                        <span className="side-count">{n.toLocaleString('de-DE')}</span>
                      </div>
                    ))}
                    {!subs.length && <p className="side-empty">Kein Treffer.</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="side-list">
        <div className="side-head">Decks</div>
        {list.map((d) => <Entry key={d.id} d={d} />)}
        {!list.length && <p className="side-empty">Noch keine Decks. Lege unten eins an und ziehe Karten darauf.</p>}
        {binders.length > 0 && <div className="side-head">Ordner</div>}
        {binders.map((d) => <Entry key={d.id} d={d} binder />)}
      </div>

      <form
        className="side-new"
        onSubmit={(e) => { e.preventDefault(); if (newName.trim()) { const id = onCreate(newName.trim(), newKind === 'binder' ? 'binder' : undefined); setNewName(''); go({ kind: 'deck', id }) } }}
      >
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={newKind === 'binder' ? '+ Neuer Ordner' : '+ Neues Deck'} />
        <select value={newKind} onChange={(e) => setNewKind(e.target.value)} title="Deck oder Ordner (z. B. Tauschordner)">
          <option value="deck">Deck</option>
          <option value="binder">Ordner</option>
        </select>
      </form>
    </aside>
  )
}
