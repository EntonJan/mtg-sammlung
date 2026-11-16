import { useMemo, useState } from 'react'
import { dragProps, readDrag } from '../drag'
import { entryKey } from '../store'
import { FINISH_LABEL, cardmarketUrl, euro, unitPrice } from '../util'
import AddCards from './AddCards'

// Ordner (z. B. Tauschordner): Karten mit Preisen, als Liste teilbar
export default function BinderView({ deck, cards, onMove, onRename, onDelete, onOpen, onAddNew }) {
  const [adding, setAdding] = useState(false)
  const [mode, setModeState] = useState(() => { try { return localStorage.getItem('binderMode') || 'list' } catch { return 'list' } })
  const setMode = (m) => { setModeState(m); try { localStorage.setItem('binderMode', m) } catch { /* egal */ } }
  const [sort, setSort] = useState('price')
  const [page, setPage] = useState(0)
  const [over, setOver] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(deck.name)
  const [confirmDel, setConfirmDel] = useState(false)
  const [copied, setCopied] = useState('')
  const [minPrice, setMinPrice] = useState('')

  const rows = useMemo(() => Object.values(deck.entries)
    .filter((e) => cards[e.id])
    .map((e) => ({ ...e, key: entryKey(e.id, e.finish), card: cards[e.id], price: unitPrice(cards[e.id], e.finish) }))
    .filter((r) => !minPrice || (r.price ?? 0) >= Number(minPrice))
    .sort(sort === 'name' ? (a, b) => a.card.name.localeCompare(b.card.name)
      : sort === 'set' ? (a, b) => (b.card.released || '').localeCompare(a.card.released || '') || a.card.set.localeCompare(b.card.set) || a.card.num.localeCompare(b.card.num, undefined, { numeric: true })
        : (a, b) => (b.price ?? 0) - (a.price ?? 0)), [deck.entries, cards, minPrice, sort])

  // Raster wie eine Ordnerseite: 6 breit × 10 tief = 60 Karten pro Seite
  const PER_PAGE = 60
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE))
  const pg = Math.min(page, pages - 1)
  const pageRows = rows.slice(pg * PER_PAGE, pg * PER_PAGE + PER_PAGE)

  const count = rows.reduce((s, r) => s + r.qty, 0)
  const value = rows.reduce((s, r) => s + (r.price ?? 0) * r.qty, 0)

  const copy = async (withPrices) => {
    const text = rows.map((r) => `${r.qty} ${r.card.name} (${r.card.set}) ${r.card.num}${r.finish !== 'normal' ? ' *F*' : ''}${withPrices ? ` – ${euro(r.price)}` : ''}`).join('\n')
      + (withPrices ? `\n\nGesamt: ${count} Karten · ${euro(value)} (Cardmarket-Preise laut Scryfall)` : '')
    try { await navigator.clipboard.writeText(text); setCopied(withPrices ? 'prices' : 'plain'); setTimeout(() => setCopied(''), 1500) } catch { /* egal */ }
  }

  const save = () => { setEditing(false); if (name.trim() && name.trim() !== deck.name) onRename(name.trim()) }

  return (
    <div
      className={`deck ${over ? 'over' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-mtg-card')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false) }}
      onDrop={(e) => { e.preventDefault(); setOver(false); const d = readDrag(e); if (d && d.from !== deck.id) onMove(d, deck.id) }}
    >
      <div className="deck-head">
        {editing ? (
          <input className="deck-title-input" value={name} autoFocus onChange={(e) => setName(e.target.value)}
            onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} />
        ) : (
          <h2 onClick={() => { setName(deck.name); setEditing(true) }} title="Klicken zum Umbenennen">📁 {deck.name}</h2>
        )}
        <div className="deck-stats">
          <span><b>{count}</b> Karten</span>
          <span>Wert <b>{euro(value)}</b></span>
        </div>
        <button className={`btn small ${adding ? 'active' : 'primary'}`} onClick={() => setAdding((a) => !a)}>
          {adding ? 'Suche schließen' : '+ Neue Karte (Ordner + Sammlung)'}
        </button>
        {confirmDel ? (
          <span className="confirm">
            Alle Karten zurück in die Sammlung und Ordner löschen?
            <button className="btn small danger" onClick={onDelete}>Ja, auflösen</button>
            <button className="btn small ghost" onClick={() => setConfirmDel(false)}>Abbrechen</button>
          </span>
        ) : (
          <button className="btn ghost small danger" onClick={() => setConfirmDel(true)}>Ordner auflösen</button>
        )}
      </div>

      {adding && (
        <div className="deck-new">
          <p className="muted small">
            Gesuchte Karten kommen als <b>neues Exemplar</b> direkt in „{deck.name}“ und zählen damit automatisch zu deiner Sammlung.
            „−“ nimmt ein hier hinzugefügtes Exemplar wieder ganz heraus.
          </p>
          <AddCards entries={deck.entries} onChange={(c, f, d) => onAddNew(c, f, d)}
            placeholder="Karte suchen, die neu in diesen Ordner + die Sammlung soll (englisch oder deutsch)" />
        </div>
      )}
      <div className="hand-actions">
        <button className="btn primary" onClick={() => copy(true)} disabled={!rows.length}>{copied === 'prices' ? 'Kopiert ✓' : 'Liste mit Preisen kopieren'}</button>
        <button className="btn" onClick={() => copy(false)} disabled={!rows.length}>{copied === 'plain' ? 'Kopiert ✓' : 'Als Importliste kopieren'}</button>
        <div className="seg seg-small">
          <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>Liste</button>
          <button className={mode === 'grid' ? 'on' : ''} onClick={() => setMode('grid')}>Raster</button>
        </div>
        <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0) }} title="Sortierung">
          <option value="price">Nach Preis</option>
          <option value="name">Nach Name</option>
          <option value="set">Nach Edition</option>
        </select>
        <label className="muted small">ab €
          <input type="number" min="0" step="0.5" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} style={{ width: 70, marginLeft: 6 }} />
        </label>
      </div>

      {!rows.length && <div className="deck-empty">Ziehe Karten hierher, die du tauschen oder verkaufen möchtest.</div>}

      {mode === 'grid' && rows.length > 0 && <>
        {pages > 1 && <Pager pg={pg} pages={pages} setPage={setPage} total={rows.length} per={PER_PAGE} />}
        <div className="binder-page">
          {pageRows.map((r) => (
            <div key={r.key} className={`binder-slot ${r.finish !== 'normal' ? 'foiled' : ''}`}
              {...dragProps({ id: r.id, finish: r.finish, from: deck.id })} onClick={() => onOpen(r.card)}
              title={`${r.qty > 1 ? `${r.qty}× ` : ''}${r.card.name} · ${r.card.setName}${r.finish !== 'normal' ? ` · ${FINISH_LABEL[r.finish]}` : ''}`}>
              <img src={r.card.img} alt={r.card.name} loading="lazy" draggable={false} />
              {r.qty > 1 && <span className="raster-qty">{r.qty}×</span>}
              <span className="slot-price">{euro(r.price)}</span>
              <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                <a className="mini" href={cardmarketUrl(r.card)} target="_blank" rel="noreferrer" title="Auf Cardmarket ansehen">CM</a>
                <button className="mini" title="1 Exemplar zurück in die Sammlung" onClick={() => onMove({ id: r.id, finish: r.finish, from: deck.id }, 'collection')}>↩</button>
                {onAddNew && <button className="mini danger" title="1 Exemplar ganz entfernen – aus Ordner UND Sammlung" onClick={() => onAddNew(r.card, r.finish, -1)}>🗑</button>}
              </span>
            </div>
          ))}
          {Array.from({ length: Math.max(0, (pg === pages - 1 ? Math.ceil(pageRows.length / 6) * 6 : PER_PAGE) - pageRows.length) }, (_, i) => <div key={`e${i}`} className="binder-slot empty" />)}
        </div>
        {pages > 1 && <Pager pg={pg} pages={pages} setPage={setPage} total={rows.length} per={PER_PAGE} />}
      </>}

      {mode === 'list' && <table className="match-table binder-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} {...dragProps({ id: r.id, finish: r.finish, from: deck.id })} onClick={() => onOpen(r.card)}>
              <td className="qty">{r.qty}×</td>
              <td>{r.card.name}{r.finish !== 'normal' && <em className="foil">{FINISH_LABEL[r.finish]}</em>}</td>
              <td className="muted small">{r.card.setName} ({r.card.set} #{r.card.num})</td>
              <td className="price">{euro(r.price)}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <a className="btn small cm-btn" href={cardmarketUrl(r.card)} target="_blank" rel="noreferrer">Cardmarket ↗</a>{' '}
                <button className="mini" title="1 Exemplar zurück in die Sammlung"
                  onClick={() => onMove({ id: r.id, finish: r.finish, from: deck.id }, 'collection')}>↩</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>}
    </div>
  )
}

function Pager({ pg, pages, setPage, total, per }) {
  return (
    <div className="pager">
      <button className="btn small" disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹ Zurück</button>
      <span>Seite <b>{pg + 1}</b> von {pages} <span className="muted small">· Karten {pg * per + 1}–{Math.min(total, (pg + 1) * per)} von {total}</span></span>
      <button className="btn small" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Weiter ›</button>
    </div>
  )
}
