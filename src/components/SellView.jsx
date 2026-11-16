import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FINISH_LABEL, cardmarketUrl, euro, unitPrice } from '../util'

const isBasic = (c) => /Basic Land/.test(c.type) || /A deck can have any number/.test(c.text || '')
const keyOf = (r) => `${r.id}|${r.finish}`
const round = (n) => Math.max(0.02, Math.round(n * 100) / 100)

// Verkaufen: freie Karten auswählen → in den Verkaufsordner; dort mit Preisvorschlag einstellen und als verkauft austragen
export default function SellView({ entries, decks, cards, deNames = {}, onMoveMany, onCreateBinder, onOpen, sales = [], onSold, onRemoveSale }) {
  const [tab, setTab] = useState('free')
  const [q, setQ] = useState('')
  const [minPrice, setMinPrice] = useState('1')
  const [onlyDupes, setOnlyDupes] = useState(false)
  const [sort, setSort] = useState('price')
  const [factor, setFactor] = useState(() => Number(localStorage.getItem('sellFactor') || 0.95))
  const [sel, setSel] = useState(() => new Set())
  const [prices, setPrices] = useState({}) // eigene Verkaufspreise je Eintrag
  const [copied, setCopied] = useState(false)
  const [confirmSold, setConfirmSold] = useState(false)
  const parentRef = useRef(null)

  const binders = Object.values(decks).filter((d) => d.kind === 'binder')
  const sellBinder = binders.find((b) => /verkauf|sell/i.test(b.name))
  const setF = (f) => { setFactor(f); localStorage.setItem('sellFactor', String(f)) }
  const switchTab = (t) => { setTab(t); setSel(new Set()); setConfirmSold(false) }

  const freeByOracle = useMemo(() => {
    const m = {}
    for (const e of Object.values(entries)) { const c = cards[e.id]; if (c) m[c.oracleId] = (m[c.oracleId] || 0) + e.qty }
    return m
  }, [entries, cards])

  const rows = useMemo(() => {
    if (tab === 'sold') return []
    const t = q.trim().toLowerCase()
    const min = tab === 'listed' ? 0 : Number(minPrice) || 0
    const source = tab === 'listed' ? (sellBinder ? Object.values(sellBinder.entries) : []) : Object.values(entries)
    return source
      .map((e) => ({ ...e, card: cards[e.id], price: unitPrice(cards[e.id], e.finish) }))
      .filter((r) => r.card && (r.price ?? 0) >= min)
      .filter((r) => tab === 'listed' || !onlyDupes || (!isBasic(r.card) && freeByOracle[r.card.oracleId] > 1))
      .filter((r) => !t || r.card.name.toLowerCase().includes(t) || (deNames[r.card.oracleId] || '').toLowerCase().includes(t))
      .sort(sort === 'price' ? (a, b) => (b.price ?? 0) - (a.price ?? 0) : (a, b) => a.card.name.localeCompare(b.card.name))
  }, [entries, sellBinder, tab, cards, q, minPrice, onlyDupes, sort, freeByOracle, deNames])

  const suggest = (r) => (r.price != null ? round(r.price * factor) : null)
  const priceOf = (r) => (prices[keyOf(r)] != null ? prices[keyOf(r)] : suggest(r))
  const selRows = rows.filter((r) => sel.has(keyOf(r)))
  const toggle = (r) => setSel((s0) => { const s = new Set(s0); s.has(keyOf(r)) ? s.delete(keyOf(r)) : s.add(keyOf(r)); return s })
  const allSel = rows.length > 0 && selRows.length === rows.length
  const selectAll = () => setSel(allSel ? new Set() : new Set(rows.map(keyOf)))
  const sum = (list, fn) => list.reduce((t, r) => t + (fn(r) ?? 0) * r.qty, 0)

  const total = sum(rows, (r) => r.price)
  const count = rows.reduce((s, r) => s + r.qty, 0)

  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 54, overscan: 10 })

  const binderId = () => sellBinder?.id || onCreateBinder('Zum Verkauf')
  const toSell = (list, all) => {
    const id = binderId()
    onMoveMany(list.map((r) => ({ id: r.id, finish: r.finish, qty: all ? r.qty : 1, from: 'collection' })), id)
    setSel(new Set())
  }
  const backToCollection = (list) => {
    onMoveMany(list.map((r) => ({ id: r.id, finish: r.finish, qty: r.qty, from: sellBinder.id })), 'collection')
    setSel(new Set())
  }
  const sold = (list) => {
    onSold(sellBinder.id, list.map((r) => ({ id: r.id, finish: r.finish, qty: r.qty, price: priceOf(r) })))
    setSel(new Set()); setConfirmSold(false)
  }
  const copyList = async (list) => {
    const text = list.map((r) => `${r.qty}x ${r.card.name} (${r.card.set.toUpperCase()} #${r.card.num})${r.finish !== 'normal' ? ` ${FINISH_LABEL[r.finish]}` : ''} – ${euro(priceOf(r))}`).join('\n')
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* egal */ }
  }
  const openCm = (list) => list.slice(0, 10).forEach((r) => window.open(cardmarketUrl(r.card), '_blank', 'noopener'))

  // Verkauft-Protokoll nach Monaten
  const months = useMemo(() => {
    const m = {}
    for (const s of [...sales].reverse()) {
      const k = new Date(s.t).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
      ;(m[k] ||= { k, items: [], sum: 0, n: 0 })
      m[k].items.push(s); m[k].sum += (s.price || 0) * s.qty; m[k].n += s.qty
    }
    return Object.values(m)
  }, [sales])
  const listedCount = sellBinder ? Object.values(sellBinder.entries).reduce((s, e) => s + e.qty, 0) : 0

  return (
    <div className="collection sell">
      <div className="sell-head">
        <h2>Verkaufen</h2>
        <div className="deck-tabs">
          <button className={tab === 'free' ? 'on' : ''} onClick={() => switchTab('free')}>Freie Karten</button>
          <button className={tab === 'listed' ? 'on' : ''} onClick={() => switchTab('listed')}>Im Verkauf <span className="muted">({listedCount})</span></button>
          <button className={tab === 'sold' ? 'on' : ''} onClick={() => switchTab('sold')}>Verkauft <span className="muted">({sales.reduce((s, x) => s + x.qty, 0)})</span></button>
        </div>
        <p className="muted small">
          {tab === 'free' && <>Karten auswählen und gesammelt <b>in den Verkauf</b> legen – sie wandern in den Ordner „{sellBinder?.name || 'Zum Verkauf'}“.</>}
          {tab === 'listed' && <>Mit Preisvorschlag bei Cardmarket einstellen (<b>Cardmarket ↗</b> öffnet die Kartenseite, dort „Verkaufen“). Verkaufte Karten markieren – sie werden aus der Sammlung ausgetragen und der Erlös gemerkt.</>}
          {tab === 'sold' && <>Deine Verkäufe nach Monaten.</>}
        </p>
      </div>

      {tab !== 'sold' && <>
        <div className="toolbar">
          <input className="search" placeholder="Karte suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
          {tab === 'free' && (
            <label className="muted small">ab €
              <input type="number" min="0" step="0.5" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} style={{ width: 70, marginLeft: 6 }} />
            </label>
          )}
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="price">Teuerste zuerst</option>
            <option value="name">Name</option>
          </select>
          {tab === 'free' && <label className="check-line small"><input type="checkbox" checked={onlyDupes} onChange={(e) => setOnlyDupes(e.target.checked)} /> nur Mehrfache</label>}
          {tab === 'listed' && (
            <label className="muted small">Preisvorschlag
              <select value={factor} onChange={(e) => setF(Number(e.target.value))} style={{ marginLeft: 6 }}>
                {[1.1, 1.05, 1, 0.95, 0.9, 0.85, 0.8].map((f) => <option key={f} value={f}>{f === 1 ? 'Trendpreis' : `Trend ${f > 1 ? '+' : '−'}${Math.round(Math.abs(1 - f) * 100)} %`}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="sell-batch">
          <label className="check-line small"><input type="checkbox" checked={allSel} onChange={selectAll} /> alle {rows.length > 0 ? `(${rows.length})` : ''}</label>
          {selRows.length > 0 ? <>
            <b className="small">{selRows.reduce((s, r) => s + r.qty, 0)} ausgewählt · {euro(sum(selRows, tab === 'listed' ? priceOf : (r) => r.price))}</b>
            {tab === 'free' && <>
              <button className="btn small primary" onClick={() => toSell(selRows, true)}>Alle Exemplare in den Verkauf</button>
              <button className="btn small" onClick={() => toSell(selRows, false)}>Je 1 in den Verkauf</button>
            </>}
            {tab === 'listed' && <>
              {confirmSold
                ? <><span className="small">Wirklich als verkauft austragen?</span>
                    <button className="btn small primary" onClick={() => sold(selRows)}>Ja, verkauft</button>
                    <button className="btn small ghost" onClick={() => setConfirmSold(false)}>Abbrechen</button></>
                : <button className="btn small primary" onClick={() => setConfirmSold(true)}>Als verkauft markieren</button>}
              <button className="btn small" onClick={() => backToCollection(selRows)}>Zurück in die Sammlung</button>
              <button className="btn small" onClick={() => openCm(selRows)} title="Öffnet bis zu 10 Kartenseiten in neuen Tabs">Cardmarket-Seiten öffnen</button>
            </>}
            <button className="btn small" onClick={() => copyList(selRows)}>{copied ? 'Kopiert ✓' : 'Liste kopieren'}</button>
          </> : <span className="muted small">{tab === 'free' ? 'Karten anhaken, um sie gesammelt in den Verkauf zu legen.' : 'Karten anhaken für Sammel-Aktionen.'}</span>}
        </div>

        <div className="summary">
          <span><b>{count.toLocaleString('de-DE')}</b> Karten</span>
          <span>Trendwert <b>{euro(total)}</b></span>
          {tab === 'listed' && <span>Verkaufspreise <b>{euro(sum(rows, priceOf))}</b></span>}
        </div>
        <div ref={parentRef} className="scroller">
          <div style={{ height: v.getTotalSize(), position: 'relative' }}>
            {v.getVirtualItems().map((vi) => {
              const r = rows[vi.index]
              const on = sel.has(keyOf(r))
              return (
                <div key={keyOf(r)} className={`row sell-row ${on ? 'selected' : ''}`} style={{ transform: `translateY(${vi.start}px)`, height: vi.size }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(r)} aria-label="auswählen" />
                  <span className="qty">{r.qty}×</span>
                  <img className="thumb" src={r.card.thumb} alt="" loading="lazy" draggable={false} onClick={() => onOpen(r.card)} />
                  <span className="row-main" onClick={() => onOpen(r.card)}>
                    <span className="row-name">{r.card.name}{r.finish !== 'normal' && <em className="foil">{FINISH_LABEL[r.finish]}</em>}</span>
                    <span className="row-sub">{r.card.setName} ({r.card.set.toUpperCase()} #{r.card.num})</span>
                  </span>
                  {tab === 'listed' ? (
                    <label className="sell-price" title={`Trend ${euro(r.price)}`}>
                      <span className="muted small">Trend {euro(r.price)}</span>
                      <input type="number" min="0" step="0.05" value={priceOf(r) ?? ''} onChange={(e) => setPrices((p) => ({ ...p, [keyOf(r)]: e.target.value === '' ? null : Number(e.target.value) }))} />
                      <span className="small">€</span>
                    </label>
                  ) : <span className="price">{euro(r.price)}</span>}
                  <a className="btn small cm-btn" href={cardmarketUrl(r.card)} target="_blank" rel="noreferrer">Cardmarket ↗</a>
                  {tab === 'free' && <button className="btn small" onClick={() => toSell([r], false)} title="1 Exemplar in den Verkaufsordner">→ Verkauf</button>}
                </div>
              )
            })}
          </div>
          {!rows.length && <p className="empty">{tab === 'listed' ? 'Noch nichts im Verkauf. Leg Karten im Reiter „Freie Karten“ hinein.' : 'Keine Karten in diesem Preisbereich.'}</p>}
        </div>
      </>}

      {tab === 'sold' && (
        <div className="sold-log">
          {!months.length && <p className="muted">Noch nichts verkauft.</p>}
          {months.map((m) => (
            <section key={m.k} className="stat-card">
              <h3>{m.k} <span className="muted">· {m.n} Karten</span> <span className="sold-sum">{euro(m.sum)}</span></h3>
              {m.items.map((s) => (
                <div key={s.t + s.id + s.finish} className="sold-row">
                  <span className="muted small">{new Date(s.t).toLocaleDateString('de-DE')}</span>
                  <span>{s.qty}× {s.name} <span className="muted small">{s.set.toUpperCase()}{s.finish !== 'normal' ? ` · ${FINISH_LABEL[s.finish]}` : ''}</span></span>
                  <span className="price">{euro((s.price || 0) * s.qty)}</span>
                  <button className="mini danger" title="Eintrag löschen (die Karte bleibt ausgetragen)" onClick={() => onRemoveSale(s)}>🗑</button>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
