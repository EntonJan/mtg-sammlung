import { useEffect, useMemo, useRef, useState } from 'react'
import { loadHistory } from '../store'
import { loadPriceSnapshots } from '../scryfall'
import { FINISH_LABEL, euro, unitPrice } from '../util'

// Wertverlauf der Sammlung + größte Preissprünge bei eigenen Karten
export default function ValueView({ uid, entries, decks, cards, onOpen }) {
  const [history, setHistory] = useState(null)
  const [snaps, setSnaps] = useState(null)
  const [range, setRange] = useState(7)
  const [by, setBy] = useState('eur')
  const [minVal, setMinVal] = useState(0.5)

  useEffect(() => {
    loadHistory(uid).then(setHistory).catch(() => setHistory({}))
    loadPriceSnapshots().then(setSnaps)
  }, [uid])

  // Alle eigenen Exemplare (frei + Decks)
  const owned = useMemo(() => {
    const m = {}
    const add = (e) => { const k = `${e.id}|${e.finish}`; m[k] = { ...e, qty: (m[k]?.qty || 0) + e.qty } }
    Object.values(entries).forEach(add)
    Object.values(decks).forEach((d) => Object.values(d.entries).forEach(add))
    return Object.values(m)
  }, [entries, decks])

  const now = useMemo(() => {
    let free = 0, inDecks = 0
    for (const e of Object.values(entries)) free += (unitPrice(cards[e.id], e.finish) ?? 0) * e.qty
    const perDeck = Object.values(decks).map((d) => {
      const v = Object.values(d.entries).reduce((s, e) => s + (unitPrice(cards[e.id], e.finish) ?? 0) * e.qty, 0)
      inDecks += v
      return { name: d.name, value: v }
    }).sort((a, b) => b.value - a.value)
    return { free, inDecks, total: free + inDecks, perDeck }
  }, [entries, decks, cards])

  // Preissprünge: heutiger Preis vs. Schnappschuss vor ~range Tagen (oder ältester vorhandener)
  const movers = useMemo(() => {
    if (!snaps) return null
    const days = Object.keys(snaps).sort()
    if (days.length < 2) return { days, list: [] }
    const target = new Date(Date.now() - range * 864e5).toLocaleDateString('sv-SE')
    const base = days.filter((d) => d <= target).pop() || days[0]
    const old = snaps[base]
    const list = []
    for (const e of owned) {
      const c = cards[e.id]; const o = old[e.id]
      if (!c || !o) continue
      const before = e.finish === 'normal' ? (o[0] ?? o[1]) : (o[1] ?? o[0])
      const after = unitPrice(c, e.finish)
      if (before == null || after == null || before === after) continue
      list.push({ e, c, before, after, diff: (after - before) * e.qty, pct: ((after - before) / before) * 100 })
    }
    const relevant = list.filter((m) => Math.max(m.before, m.after) >= minVal)
    const key = by === 'pct' ? (m) => m.pct : (m) => m.diff
    const up = relevant.filter((m) => m.after > m.before).sort((a, b) => key(b) - key(a))
    const down = relevant.filter((m) => m.after < m.before).sort((a, b) => key(a) - key(b))
    const sum = (l) => l.reduce((t, m) => t + m.diff, 0)
    return { base, days, list, up, down, gain: sum(up), loss: sum(down) }
  }, [snaps, owned, cards, range, by, minVal])

  const points = useMemo(() => Object.entries(history || {}).sort(([a], [b]) => a.localeCompare(b)), [history])
  const todayStr = new Date().toLocaleDateString('sv-SE')
  const prev = points.filter(([d]) => d < todayStr).pop()?.[1].total ?? null

  return (
    <div className="import value">
      <h2>Wert deiner Sammlung</h2>
      <div className="stat-tiles">
        <div className="tile-stat"><span className="muted small">Gesamt (Sammlung + Decks)</span><b>{euro(now.total)}</b>
          {prev != null && <span className={`tiny ${now.total >= prev ? 'ok-text' : 'error'}`}>{now.total >= prev ? '▲' : '▼'} {euro(Math.abs(now.total - prev))} seit {points.filter(([d]) => d < todayStr).pop()?.[0].split('-').reverse().join('.')}</span>}
        </div>
        <div className="tile-stat"><span className="muted small">Freie Karten</span><b>{euro(now.free)}</b></div>
        <div className="tile-stat"><span className="muted small">In Decks</span><b>{euro(now.inDecks)}</b></div>
      </div>

      <section className="stat-card">
        <h3>Verlauf</h3>
        {points.length < 2
          ? <p className="muted small">Die App speichert ab jetzt einmal täglich den Gesamtwert. Ab dem zweiten Tag siehst du hier die Kurve.</p>
          : <LineChart points={points.map(([d, p]) => [d, p.total])} />}
      </section>

      <section className="stat-card">
        <div className="cat-top">
          <h3>Preis-Gewinner &amp; -Verlierer</h3>
          <div className="seg seg-small">
            {[[1, '1 Tag'], [7, '7 Tage'], [30, '30 Tage']].map(([n, l]) => (
              <button key={n} className={range === n ? 'on' : ''} onClick={() => setRange(n)}>{l}</button>
            ))}
          </div>
        </div>
        {!movers || movers.days.length < 2 ? (
          <p className="muted small">Preise werden einmal täglich aktualisiert und lokal gemerkt. Ab morgen siehst du hier, welche deiner Karten im Wert gestiegen oder gefallen sind.</p>
        ) : !movers.list.length ? (
          <p className="muted small">Keine Preisänderungen seit {movers.base.split('-').reverse().join('.')}.</p>
        ) : (
          <>
            <div className="movers-bar">
              <span className="muted small">Vergleich mit {movers.base.split('-').reverse().join('.')}</span>
              <div className="seg seg-small">
                <button className={by === 'eur' ? 'on' : ''} onClick={() => setBy('eur')}>nach €</button>
                <button className={by === 'pct' ? 'on' : ''} onClick={() => setBy('pct')}>nach %</button>
              </div>
              <label className="muted small">ab Kartenwert
                <select value={minVal} onChange={(e) => setMinVal(Number(e.target.value))}>
                  {[0, 0.5, 1, 2, 5, 10].map((v) => <option key={v} value={v}>{v ? euro(v) : 'alle'}</option>)}
                </select>
              </label>
            </div>
            <div className="movers">
              <MoverList title="Gewinner" sum={movers.gain} list={movers.up} onOpen={onOpen} />
              <MoverList title="Verlierer" sum={movers.loss} list={movers.down} onOpen={onOpen} />
            </div>
          </>
        )}
      </section>

      {now.perDeck.length > 0 && (
        <section className="stat-card">
          <h3>Wert je Deck</h3>
          {now.perDeck.map((d) => (
            <div key={d.name} className="hbar">
              <span className="hbar-label wide">{d.name}</span>
              <span className="hbar-track"><span style={{ width: `${(d.value / (now.perDeck[0].value || 1)) * 100}%` }} /></span>
              <span className="hbar-n">{euro(d.value)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function MoverList({ title, sum, list, onOpen }) {
  const up = sum >= 0
  return (
    <div className="mover-col">
      <h4 className={up ? 'ok-text' : 'error'}>{title} <span className="muted small">({list.length})</span> <span className="mover-sum">{up ? '+' : ''}{euro(sum)}</span></h4>
      {!list.length && <p className="muted small">Keine.</p>}
      {list.slice(0, 20).map((m) => (
        <div key={`${m.e.id}|${m.e.finish}`} className="mover" onClick={() => onOpen(m.c)}>
          <img src={m.c.thumb || m.c.img} alt="" loading="lazy" />
          <span className="mover-name">{m.c.name}<span className="muted small"> {m.c.set.toUpperCase()}{m.e.finish !== 'normal' ? ` · ${FINISH_LABEL[m.e.finish]}` : ''}{m.e.qty > 1 ? ` · ${m.e.qty}×` : ''}</span>
            <span className="muted small">{euro(m.before)} → {euro(m.after)}</span>
          </span>
          <span className={`mover-diff ${m.diff > 0 ? 'ok-text' : 'error'}`}>{m.pct > 0 ? '+' : ''}{m.pct.toFixed(0)} %<br /><small>{m.diff > 0 ? '+' : ''}{euro(m.diff)}</small></span>
        </div>
      ))}
    </div>
  )
}

// Einfaches SVG-Liniendiagramm
function LineChart({ points }) {
  const ref = useRef(null)
  const [W, setW] = useState(720)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el); return () => ro.disconnect()
  }, [])
  const H = W < 500 ? 180 : 220, P = { l: W < 500 ? 56 : 70, r: 12, t: 12, b: 28 }
  const vals = points.map((p) => p[1])
  const min = Math.min(...vals), max = Math.max(...vals)
  const span = max - min || 1
  const x = (i) => P.l + (i / Math.max(1, points.length - 1)) * (W - P.l - P.r)
  const y = (v) => P.t + (1 - (v - min) / span) * (H - P.t - P.b)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')
  const ticks = [min, min + span / 2, max]
  const labelEvery = Math.ceil(points.length / 6)
  return (
    <div ref={ref} className="linechart-wrap"><svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="linechart" role="img" aria-label="Wertverlauf">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={P.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{euro(t)}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={p[0]}>
          <circle cx={x(i)} cy={y(p[1])} r="3" fill="var(--accent)"><title>{`${p[0]}: ${euro(p[1])}`}</title></circle>
          {i % labelEvery === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{p[0].slice(5).split('-').reverse().join('.')}</text>}
        </g>
      ))}
    </svg></div>
  )
}
