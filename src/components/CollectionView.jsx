import { useEffect, useMemo, useRef, useState, useDeferredValue } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { COLORS, COLOR_NAMES, TYPES, RARITIES, FINISH_LABEL, GROUPS, groupOf, subtypesOf, unitPrice, euro } from '../util'
import Mana from './Mana'
import { dragProps } from '../drag'

const DEFAULT_FILTER = {
  name: '', text: '', type: '', rarity: '', set: '',
  colors: [], colorMode: 'any', cmcMin: '', cmcMax: '', minPrice: '',
  finish: '', sort: 'name', dir: 'asc', group: true, german: false, onlyFree: false,
}

function loadPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? { ...fallback, ...JSON.parse(v) } : fallback } catch { return fallback }
}
function savePref(key, v) { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* egal */ } }

export default function CollectionView({ entries, cards, onOpen, cat, sub, identity, onQuickAdd, decks, onMoveMany, deNames = {}, reserved = {}, onShare }) {
  const [selected, setSelected] = useState(() => new Set())
  const lastIdx = useRef(-1)
  const [f, setF] = useState(() => loadPref('filter', DEFAULT_FILTER))
  const [view, setView] = useState(() => loadPref('view', { mode: 'list' }).mode)
  const [showFilters, setShowFilters] = useState(false)
  const df = useDeferredValue(f)

  useEffect(() => savePref('filter', { ...f, name: '', text: '' }), [f])
  useEffect(() => savePref('view', { mode: view }), [view])

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))
  const toggleColor = (c) =>
    setF((p) => ({ ...p, colors: p.colors.includes(c) ? p.colors.filter((x) => x !== c) : [...p.colors, c] }))

  // Alle Einträge mit Kartendaten verbinden
  // Sammlung = alles, was du besitzt: freie Exemplare + in Decks/Ordnern reservierte
  const rows = useMemo(() => {
    const keys = new Set([...Object.keys(entries), ...Object.keys(reserved)])
    const list = []
    for (const k of keys) {
      const [id, finish] = k.split('|')
      const c = cards[id]
      if (!c) continue
      const free = entries[k]?.qty || 0
      const res = reserved[k] || []
      const used = res.reduce((t, x) => t + x.qty, 0)
      if (free + used <= 0) continue
      list.push({ id, finish, qty: free + used, free, used, usedIn: res, card: c, price: unitPrice(c, finish) })
    }
    return list
  }, [entries, cards, reserved])

  const sets = useMemo(() => {
    const m = new Map()
    rows.forEach((r) => m.set(r.card.set, r.card.setName))
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const filtered = useMemo(() => {
    const name = df.name.trim().toLowerCase()
    const text = df.text.trim().toLowerCase()
    const cmin = df.cmcMin === '' ? -1 : Number(df.cmcMin)
    const cmax = df.cmcMax === '' ? 99 : Number(df.cmcMax)
    const pmin = df.minPrice === '' ? 0 : Number(df.minPrice)
    const sel = df.colors

    let out = rows.filter((r) => {
      const { card: c, finish, price } = r
      if (cat && groupOf(c.type) !== cat) return false
      if (df.onlyFree && !r.free) return false
      if (identity && !c.ci.every((x) => identity.includes(x))) return false
      if (sub && !subtypesOf(c.type).includes(sub)) return false
      if (name && !c.name.toLowerCase().includes(name) && !(deNames[c.oracleId] || '').toLowerCase().includes(name)) return false
      if (text && !(c.text || '').toLowerCase().includes(text) && !c.type.toLowerCase().includes(text)) return false
      if (df.type && !c.type.includes(df.type)) return false
      if (df.rarity && c.rarity !== df.rarity) return false
      if (df.set && c.set !== df.set) return false
      if (df.finish && finish !== df.finish) return false
      if (c.cmc < cmin || c.cmc > cmax) return false
      if (pmin && (price ?? 0) < pmin) return false
      if (sel.length) {
        const wantC = sel.includes('C')
        const want = sel.filter((x) => x !== 'C')
        const has = df.colorMode === 'identity' ? c.ci : c.colors
        if (df.colorMode === 'any') {
          if (!(want.some((x) => has.includes(x)) || (wantC && has.length === 0))) return false
        } else if (df.colorMode === 'exact') {
          if (wantC) { if (has.length) return false }
          else if (has.length !== want.length || !want.every((x) => has.includes(x))) return false
        } else if (df.colorMode === 'identity') {
          // Commander-Logik: Farbidentität liegt innerhalb der gewählten Farben
          if (!has.every((x) => want.includes(x))) return false
        }
      }
      return true
    })

    if (df.group) {
      const m = new Map()
      for (const r of out) {
        const k = r.card.oracleId || r.card.name
        const g = m.get(k)
        if (g) {
          g.free += r.free
          g.used += r.used
          g.usedIn = [...g.usedIn, ...r.usedIn]
          // Zum Ziehen eine Version nehmen, von der noch etwas frei ist
          if (!g.repFree && r.free) { g.id = r.id; g.finish = r.finish; g.repFree = true }
          g.qty += r.qty
          g.value += (r.price ?? 0) * r.qty
          g.printings += 1
          if ((r.price ?? 0) > (g.price ?? 0)) { g.price = r.price }
        } else {
          m.set(k, { ...r, key: k, value: (r.price ?? 0) * r.qty, printings: 1, repFree: r.free > 0 })
        }
      }
      out = [...m.values()]
    } else {
      out = out.map((r) => ({ ...r, key: `${r.id}|${r.finish}`, value: (r.price ?? 0) * r.qty, printings: 1 }))
    }

    const dir = df.dir === 'asc' ? 1 : -1
    const cmp = {
      name: (a, b) => (df.german ? (deNames[a.card.oracleId] || a.card.name).localeCompare(deNames[b.card.oracleId] || b.card.name, 'de') : a.card.name.localeCompare(b.card.name)),
      price: (a, b) => (a.price ?? 0) - (b.price ?? 0),
      value: (a, b) => a.value - b.value,
      cmc: (a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name),
      qty: (a, b) => a.qty - b.qty,
      set: (a, b) => a.card.set.localeCompare(b.card.set) || a.card.num.localeCompare(b.card.num, undefined, { numeric: true }),
    }[df.sort]
    out.sort((a, b) => dir * cmp(a, b))
    return out
  }, [rows, df, cat, sub, identity, deNames])

  const totals = useMemo(() => {
    let qty = 0, value = 0, used = 0
    for (const r of filtered) { qty += r.qty; value += r.value; used += r.used }
    return { qty, value, used, lines: filtered.length }
  }, [filtered])

  // Mehrfachauswahl: Strg/Cmd+Klick einzeln, Shift+Klick Bereich, normaler Klick öffnet Details
  const onRowClick = (e, r, idx) => {
    if (e.ctrlKey || e.metaKey) {
      setSelected((s) => { const n = new Set(s); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n })
      lastIdx.current = idx
    } else if (e.shiftKey && lastIdx.current >= 0) {
      const [a, b] = [Math.min(lastIdx.current, idx), Math.max(lastIdx.current, idx)]
      setSelected((s) => { const n = new Set(s); for (let i = a; i <= b; i++) n.add(filtered[i].key); return n })
      window.getSelection()?.removeAllRanges()
    } else if (selected.size) {
      setSelected(new Set()); lastIdx.current = idx
    } else {
      lastIdx.current = idx
      onOpen(r.card)
    }
  }
  const selectedRows = filtered.filter((r) => selected.has(r.key) && r.free > 0)
  const payloadFor = (r) => (!r.free ? null : selected.has(r.key) && selectedRows.length > 1
    ? { multi: selectedRows.map((x) => ({ id: x.id, finish: x.finish, qty: 1, from: 'collection' })) }
    : { id: r.id, finish: r.finish, from: 'collection' })
  const moveSelected = (to) => {
    onMoveMany(selectedRows.map((x) => ({ id: x.id, finish: x.finish, qty: 1, from: 'collection' })), to)
    setSelected(new Set())
  }
  const targets = Object.values(decks || {}).sort((a, b) => (a.kind === 'binder') - (b.kind === 'binder') || a.name.localeCompare(b.name))

  const activeFilters = ['text', 'type', 'rarity', 'set', 'cmcMin', 'cmcMax', 'minPrice', 'finish']
    .filter((k) => f[k] !== '').length + (f.colors.length ? 1 : 0)

  return (
    <div className="collection">
      <div className="toolbar">
        <input
          className="search"
          placeholder="Karte suchen …"
          value={f.name}
          onChange={(e) => set('name', e.target.value)}
        />
        <button className={`btn ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters((s) => !s)}>
          Filter{activeFilters ? ` (${activeFilters})` : ''}
        </button>
        <select value={f.sort} onChange={(e) => set('sort', e.target.value)} title="Sortierung">
          <option value="name">Name</option>
          <option value="price">Preis</option>
          <option value="value">Gesamtwert</option>
          <option value="cmc">Manawert</option>
          <option value="qty">Anzahl</option>
          <option value="set">Set</option>
        </select>
        <button className="btn icon" onClick={() => set('dir', f.dir === 'asc' ? 'desc' : 'asc')} title="Richtung">
          {f.dir === 'asc' ? '↑' : '↓'}
        </button>
        <div className="seg">
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>Liste</button>
          <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>Bilder</button>
        </div>
      </div>

      {showFilters && (
        <div className="filters">
          <label>Regeltext / Typ
            <input value={f.text} onChange={(e) => set('text', e.target.value)} placeholder="z. B. draw a card" />
          </label>
          <label>Kartentyp
            <select value={f.type} onChange={(e) => set('type', e.target.value)}>
              <option value="">Alle</option>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>Seltenheit
            <select value={f.rarity} onChange={(e) => set('rarity', e.target.value)}>
              <option value="">Alle</option>
              {RARITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>Set
            <select value={f.set} onChange={(e) => set('set', e.target.value)}>
              <option value="">Alle</option>
              {sets.map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
            </select>
          </label>
          <label>Ausführung
            <select value={f.finish} onChange={(e) => set('finish', e.target.value)}>
              <option value="">Alle</option>
              <option value="normal">Normal</option>
              <option value="foil">Foil</option>
              <option value="etched">Etched</option>
              <option value="proxy">Proxy</option>
            </select>
          </label>
          <label>Manawert
            <span className="range">
              <input type="number" min="0" value={f.cmcMin} onChange={(e) => set('cmcMin', e.target.value)} placeholder="von" />
              <input type="number" min="0" value={f.cmcMax} onChange={(e) => set('cmcMax', e.target.value)} placeholder="bis" />
            </span>
          </label>
          <label>Mindestpreis €
            <input type="number" min="0" step="0.5" value={f.minPrice} onChange={(e) => set('minPrice', e.target.value)} />
          </label>
          <div className="colors">
            <span>Farben</span>
            <div className="color-row">
              {[...COLORS, 'C'].map((c) => (
                <button
                  key={c}
                  className={`pip pip-${c} ${f.colors.includes(c) ? 'on' : ''}`}
                  onClick={() => toggleColor(c)}
                  title={COLOR_NAMES[c]}
                >{c}</button>
              ))}
            </div>
            <select value={f.colorMode} onChange={(e) => set('colorMode', e.target.value)}>
              <option value="any">enthält eine davon</option>
              <option value="exact">genau diese Farben</option>
              <option value="identity">passt in Farbidentität (Commander)</option>
            </select>
          </div>
          <label className="check">
            <input type="checkbox" checked={f.group} onChange={(e) => set('group', e.target.checked)} />
            Gleiche Karten zusammenfassen
          </label>
          <label className="check">
            <input type="checkbox" checked={f.onlyFree} onChange={(e) => set('onlyFree', e.target.checked)} />
            Nur verfügbare (nicht in Decks)
          </label>
          <label className="check">
            <input type="checkbox" checked={f.german} onChange={(e) => set('german', e.target.checked)} />
            Deutsche Namen anzeigen
          </label>
          <button className="btn ghost" onClick={() => setF({ ...DEFAULT_FILTER, group: f.group })}>Filter zurücksetzen</button>
        </div>
      )}

      <div className="summary">
        {cat && <span className="cat-label">{GROUPS.find(([k]) => k === cat)?.[1]}{sub && ` › ${sub}`}</span>}
        <span><b>{totals.qty.toLocaleString('de-DE')}</b> Karten</span>
        <span><b>{totals.lines.toLocaleString('de-DE')}</b> {f.group ? 'verschiedene' : 'Einträge'}</span>
        <span>Wert <b>{euro(totals.value)}</b></span>
        {totals.used > 0 && <span>davon in Decks <b>{totals.used.toLocaleString('de-DE')}</b></span>}
        {onShare && <button className="btn small share-btn" onClick={onShare}>Teilen</button>}
      </div>

      {selectedRows.length > 0 && (
        <div className="selbar">
          <b>{selectedRows.length} ausgewählt</b>
          {onMoveMany && targets.length > 0 && (
            <select value="" onChange={(e) => e.target.value && moveSelected(e.target.value)}>
              <option value="">→ je 1 Exemplar verschieben nach …</option>
              {targets.map((d) => <option key={d.id} value={d.id}>{d.kind === 'binder' ? '📁 ' : ''}{d.name}</option>)}
            </select>
          )}
          <span className="muted small">oder die Auswahl auf ein Deck ziehen</span>
          <button className="btn small ghost" onClick={() => setSelected(new Set())}>Auswahl aufheben</button>
        </div>
      )}

      {view === 'list'
        ? <VirtualList items={filtered} onRowClick={onRowClick} payloadFor={payloadFor} selected={selected} onQuickAdd={onQuickAdd} deNames={f.german ? deNames : null} />
        : <VirtualGrid items={filtered} onRowClick={onRowClick} payloadFor={payloadFor} selected={selected} onQuickAdd={onQuickAdd} />}
    </div>
  )
}

function VirtualList({ items, onRowClick, payloadFor, selected, onQuickAdd, deNames }) {
  const parentRef = useRef(null)
  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 12,
  })
  return (
    <div ref={parentRef} className="scroller">
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((vi) => {
          const r = items[vi.index]
          const c = r.card
          return (
            <div
              key={r.key}
              className={`row ${selected.has(r.key) ? 'sel' : ''} ${!r.free ? 'used' : ''}`}
              style={{ transform: `translateY(${vi.start}px)`, height: vi.size }}
              onClick={(e) => onRowClick(e, r, vi.index)}
              {...dragProps(payloadFor(r))}
            >
              <span className="qty">{r.qty}×</span>
              <img className="thumb" src={c.thumb} alt="" loading="lazy" draggable={false} />
              <span className="row-main">
                <span className="row-name">
                  {deNames?.[c.oracleId] || c.name}
                  {r.finish !== 'normal' && r.printings === 1 && <em className="foil">{FINISH_LABEL[r.finish]}</em>}
                </span>
                <span className="row-sub">
                  {deNames?.[c.oracleId] ? `${c.name} · ` : ''}{c.type}
                  {r.printings > 1 ? ` · ${r.printings} Versionen` : ` · ${c.set} #${c.num}`}
                </span>
              </span>
              <Avail r={r} />
              <Mana cost={c.cost} />
              <span className={`rar rar-${c.rarity}`} title={c.rarity}>●</span>
              <span className="price">{euro(r.price)}</span>
              {onQuickAdd && (
                <button className="mini add-mini" title="1 Exemplar ins Deck" disabled={!r.free}
                  onClick={(e) => { e.stopPropagation(); onQuickAdd(r) }}>+</button>
              )}
            </div>
          )
        })}
      </div>
      {!items.length && <p className="empty">Keine Karten gefunden.</p>}
    </div>
  )
}

function VirtualGrid({ items, onRowClick, payloadFor, selected, onQuickAdd }) {
  const parentRef = useRef(null)
  const [width, setWidth] = useState(800)
  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const minCard = width < 500 ? 110 : 160
  const cols = Math.max(2, Math.floor(width / minCard))
  const cardW = width / cols
  const rowH = cardW * 1.396 + 30
  const rowCount = Math.ceil(items.length / cols)
  const v = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 3,
  })
  useEffect(() => { v.measure() }, [rowH]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={parentRef} className="scroller">
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((vi) => (
          <div
            key={vi.key}
            className="grid-row"
            style={{ transform: `translateY(${vi.start}px)`, height: rowH, gridTemplateColumns: `repeat(${cols}, 1fr)` }}
          >
            {items.slice(vi.index * cols, vi.index * cols + cols).map((r, j) => (
              <div key={r.key} className={`tile ${selected.has(r.key) ? 'sel' : ''} ${!r.free ? 'used' : ''}`} title={availText(r)} onClick={(e) => onRowClick(e, r, vi.index * cols + j)} {...dragProps(payloadFor(r))}>
                <img src={r.card.img} alt={r.card.name} loading="lazy" draggable={false} />
                <span className="tile-badge">{r.qty}×</span>
                {r.finish === 'foil' && r.printings === 1 && <span className="tile-foil">Foil</span>}
                <span className="tile-price">{euro(r.price)}{r.used > 0 && <span className={`tile-avail ${r.free ? '' : 'none'}`}> · {r.free}/{r.qty} frei</span>}</span>
                {onQuickAdd && (
                  <button className="mini tile-add" title="1 Exemplar ins Deck" disabled={!r.free}
                    onClick={(e) => { e.stopPropagation(); onQuickAdd(r) }}>+</button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      {!items.length && <p className="empty">Keine Karten gefunden.</p>}
    </div>
  )
}

// Verfügbarkeit: „2 von 3 verfügbar“ bzw. „in Yshtola“
function availText(r) {
  if (!r.used) return ''
  const where = [...new Set(r.usedIn.map((x) => x.name))].join(', ')
  return r.free ? `${r.free} von ${r.qty} verfügbar · ${r.used} in ${where}` : `alle in ${where}`
}

function Avail({ r }) {
  if (!r.used) return null
  const where = [...new Set(r.usedIn.map((x) => x.name))]
  return (
    <span className={`avail ${r.free ? 'part' : 'none'}`} title={availText(r)}>
      {r.free ? `noch ${r.free} von ${r.qty} verfügbar` : `in ${where.length > 1 ? `${where.length} Decks` : where[0]}`}
    </span>
  )
}
