import { useState } from 'react'
import { readDrag } from '../drag'
import { GROUPS, euro } from '../util'
import { activeModuleOf, isCore, isModule, modulesOf } from '../konsole'

// Linke Leiste: „Sammlung“ + alle Decks. Jeder Eintrag ist ein Ablageziel für Drag & Drop.
export default function Sidebar({ view, setView, freeCount, catCounts, subCounts, decks, deckStats, onDrop, onCreate, open, onClose, recent = [] }) {
  const [over, setOver] = useState(null)
  const [newName, setNewName] = useState('')
  const [subFilter, setSubFilter] = useState('')

  const all = Object.values(decks).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  // Module erscheinen nur eingerückt unter ihrer Konsole (verwaiste Module wie normale Decks)
  const list = all.filter((d) => d.kind !== 'binder' && !(isModule(d) && isCore(decks[d.coreId])))
  const binders = all.filter((d) => d.kind === 'binder')
  const [newKind, setNewKind] = useState('deck')
  // Auf-/Zugeklappte Konsolen merken
  const [shut, setShut] = useState(() => { try { return JSON.parse(localStorage.getItem('konsoleShut') || '{}') } catch { return {} } })
  const toggleShut = (id) => setShut((p) => { const n = { ...p, [id]: !p[id] }; try { localStorage.setItem('konsoleShut', JSON.stringify(n)) } catch { /* egal */ } return n })
  const placeholder = { binder: '+ Neuer Ordner', core: '+ Neue Konsole' }[newKind] || '+ Neues Deck'

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
        {all.length > 4 && recent.filter((id) => decks[id]).length > 0 && <>
          <div className="side-head">Zuletzt geöffnet</div>
          {recent.filter((id) => decks[id]).slice(0, 3).map((id) => <Entry key={'r' + id} d={decks[id]} decks={decks} binder={decks[id].kind === 'binder'} st={deckStats[id]} on={false} over={over === id} go={go} target={target} />)}
        </>}
        <div className="side-head">Decks</div>
        {list.map((d) => {
          if (!isCore(d)) return <Entry key={d.id} d={d} decks={decks} st={deckStats[d.id]} on={view.kind === 'deck' && view.id === d.id} over={over === d.id} go={go} target={target} />
          const mods = modulesOf(decks, d.id)
          const act = activeModuleOf(decks, d)
          const isOpen = !shut[d.id]
          return (
            <div key={d.id} className="side-konsole">
              <Entry d={d} decks={decks} st={deckStats[d.id]} on={view.kind === 'deck' && view.id === d.id} over={over === d.id} go={go} target={target}
                caret={mods.length > 0 ? { open: isOpen, toggle: () => toggleShut(d.id) } : null} />
              {isOpen && mods.map((m) => (
                <Entry key={m.id} d={m} decks={decks} st={deckStats[m.id]} mod active={act?.id === m.id} on={view.kind === 'deck' && view.id === m.id} over={over === m.id} go={go} target={target} />
              ))}
            </div>
          )
        })}
        {!list.length && <p className="side-empty">Noch keine Decks. Lege unten eins an und ziehe Karten darauf.</p>}
        {binders.length > 0 && <div className="side-head">Ordner</div>}
        {binders.map((d) => <Entry key={d.id} d={d} decks={decks} binder st={deckStats[d.id]} on={view.kind === 'deck' && view.id === d.id} over={over === d.id} go={go} target={target} />)}
      </div>

      <form
        className="side-new"
        onSubmit={(e) => { e.preventDefault(); if (newName.trim()) { const id = onCreate(newName.trim(), newKind === 'deck' ? undefined : newKind); setNewName(''); go({ kind: 'deck', id }) } }}
      >
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={placeholder} enterKeyHint="done" />
        <select value={newKind} onChange={(e) => setNewKind(e.target.value)} title="Deck oder Ordner (z. B. Tauschordner) – oder Konsole (Core-Deck mit austauschbaren Modulen)">
          <option value="deck">Deck</option>
          <option value="binder">Ordner</option>
          <option value="core">Konsole</option>
        </select>
        {/* Sichtbarer Knopf: Handy-Tastaturen senden „Enter“ nicht zuverlässig */}
        <button type="submit" className="btn small primary side-new-btn" disabled={!newName.trim()} aria-label="Anlegen">Anlegen</button>
      </form>
    </aside>
  )
}

// Eigene Komponente außerhalb von Sidebar – sonst würde React den Eintrag bei jedem
// Hover neu erzeugen und das Ablageziel während des Ziehens verschwinden.
function Entry({ d, decks, binder, mod, active, caret, st = { count: 0, value: 0 }, on, over, go, target }) {
  const core = isCore(d)
  const module = mod || isModule(d)
  const n = core ? st.total ?? st.count : st.count
  const title = core
    ? `Konsole: Core ${st.core ?? st.count}${st.mod ? ` + Modul ${st.mod}` : ' (kein Modul eingelegt)'} = ${n} Karten`
    : module && decks?.[d.coreId] ? `Modul von „${decks[d.coreId].name}“: ${st.count} Karten${active ? ' · eingelegt' : ''}` : `${st.count} Karten · ${euro(st.value)}`
  return (
    <div
      className={`side-item ${module && mod ? 'side-mod' : ''} ${on ? 'on' : ''} ${over ? 'over' : ''}`}
      onClick={() => go({ kind: 'deck', id: d.id })}
      {...target(d.id)}
      title={title}
    >
      {caret && <span className={`caret konsole-caret ${caret.open ? 'open' : ''}`} onClick={(e) => { e.stopPropagation(); caret.toggle() }} title={caret.open ? 'Module einklappen' : 'Module ausklappen'}>▸</span>}
      {binder && <span className="side-icon">📁</span>}
      {core && <span className="side-icon">🎮</span>}
      {module && <span className="side-icon">💾</span>}
      <span className="side-name">{module && !mod && decks?.[d.coreId] ? `${decks[d.coreId].name} › ${d.name}` : d.name}</span>
      {active && <span className="side-slot">eingelegt</span>}
      <span className={`side-count ${!binder && !module && n === 100 ? 'full' : ''}`}>{n}</span>
    </div>
  )
}
