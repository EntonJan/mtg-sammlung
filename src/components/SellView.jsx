import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FINISH_LABEL, cardmarketUrl, euro, unitPrice } from '../util'

const isBasic = (c) => /Basic Land/.test(c.type) || /A deck can have any number/.test(c.text || '')

// Verkaufen: alle freien Karten nach Wert, mit Link zu Cardmarket und „in den Verkaufsordner“
export default function SellView({ entries, decks, cards, deNames = {}, onMoveMany, onCreateBinder, onOpen }) {
  const [q, setQ] = useState('')
  const [minPrice, setMinPrice] = useState('1')
  const [onlyDupes, setOnlyDupes] = useState(false)
  const [sort, setSort] = useState('price')
  const parentRef = useRef(null)

  const binders = Object.values(decks).filter((d) => d.kind === 'binder')
  const sellBinder = binders.find((b) => /verkauf|sell/i.test(b.name))

  // Wie viele Exemplare je Karte insgesamt frei? (für „nur Mehrfache“)
  const freeByOracle = useMemo(() => {
    const m = {}
    for (const e of Object.values(entries)) { const c = cards[e.id]; if (c) m[c.oracleId] = (m[c.oracleId] || 0) + e.qty }
    return m
  }, [entries, cards])

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    const min = Number(minPrice) || 0
    return Object.values(entries)
      .map((e) => ({ ...e, card: cards[e.id], price: unitPrice(cards[e.id], e.finish) }))
      .filter((r) => r.card && (r.price ?? 0) >= min)
      .filter((r) => !onlyDupes || (!isBasic(r.card) && freeByOracle[r.card.oracleId] > 1))
      .filter((r) => !t || r.card.name.toLowerCase().includes(t) || (deNames[r.card.oracleId] || '').toLowerCase().includes(t))
      .sort(sort === 'price' ? (a, b) => (b.price ?? 0) - (a.price ?? 0) : (a, b) => a.card.name.localeCompare(b.card.name))
  }, [entries, cards, q, minPrice, onlyDupes, sort, freeByOracle, deNames])

  const total = rows.reduce((s, r) => s + (r.price ?? 0) * r.qty, 0)
  const count = rows.reduce((s, r) => s + r.qty, 0)

  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 52, overscan: 10 })

  const toSell = (r) => {
    const id = sellBinder?.id || onCreateBinder('Zum Verkauf')
    onMoveMany([{ id: r.id, finish: r.finish, qty: 1, from: 'collection' }], id)
  }

  return (
    <div className="collection sell">
      <div className="sell-head">
        <h2>Verkaufen</h2>
        <p className="muted small">
          Alle freien Karten deiner Sammlung, die teuersten zuerst. <b>Cardmarket ↗</b> öffnet die Produktseite der Karte
          (dort „Verkaufen“ anklicken). Mit <b>→ Verkauf</b> legst du ein Exemplar in den Ordner
          „{sellBinder?.name || 'Zum Verkauf'}“ – so behältst du den Überblick, was gerade online steht.
        </p>
      </div>
      <div className="toolbar">
        <input className="search" placeholder="Karte suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="muted small">ab €
          <input type="number" min="0" step="0.5" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} style={{ width: 70, marginLeft: 6 }} />
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="price">Teuerste zuerst</option>
          <option value="name">Name</option>
        </select>
        <label className="check-line small"><input type="checkbox" checked={onlyDupes} onChange={(e) => setOnlyDupes(e.target.checked)} /> nur Karten, die ich mehrfach habe</label>
      </div>
      <div className="summary">
        <span><b>{count.toLocaleString('de-DE')}</b> Karten</span>
        <span>Wert <b>{euro(total)}</b></span>
        {sellBinder && <span>im Verkaufsordner: <b>{Object.values(sellBinder.entries).reduce((s, e) => s + e.qty, 0)}</b></span>}
      </div>
      <div ref={parentRef} className="scroller">
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((vi) => {
            const r = rows[vi.index]
            return (
              <div key={`${r.id}|${r.finish}`} className="row" style={{ transform: `translateY(${vi.start}px)`, height: vi.size, cursor: 'pointer' }} onClick={() => onOpen(r.card)}>
                <span className="qty">{r.qty}×</span>
                <img className="thumb" src={r.card.thumb} alt="" loading="lazy" draggable={false} />
                <span className="row-main">
                  <span className="row-name">{r.card.name}{r.finish !== 'normal' && <em className="foil">{FINISH_LABEL[r.finish]}</em>}</span>
                  <span className="row-sub">{r.card.setName} ({r.card.set} #{r.card.num})</span>
                </span>
                <span className="price">{euro(r.price)}</span>
                <a className="btn small cm-btn" href={cardmarketUrl(r.card)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Cardmarket ↗</a>
                <button className="btn small" onClick={(e) => { e.stopPropagation(); toSell(r) }} title="1 Exemplar in den Verkaufsordner">→ Verkauf</button>
              </div>
            )
          })}
        </div>
        {!rows.length && <p className="empty">Keine Karten in diesem Preisbereich.</p>}
      </div>
    </div>
  )
}
