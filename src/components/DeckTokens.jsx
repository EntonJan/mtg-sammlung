import { useEffect, useMemo, useState } from 'react'
import { getTokens } from '../scryfall'

// Marker/Spielhilfen, die man anhand des Kartentexts erkennt
const MARKERS = [
  [/\+1\/\+1 counter/i, '+1/+1-Marker'], [/-1\/-1 counter/i, '−1/−1-Marker'], [/loyalty/i, 'Loyalitätsmarker'],
  [/poison counter|toxic|infect/i, 'Giftmarker'], [/\{E\}|energy counter/i, 'Energie'], [/experience counter/i, 'Erfahrungsmarker'],
  [/charge counter/i, 'Ladungsmarker'], [/time counter|suspend/i, 'Zeitmarker'], [/lore counter|^\(As this Saga/im, 'Sagen-Kapitelmarker'],
  [/shield counter/i, 'Schildmarker'], [/stun counter/i, 'Betäubungsmarker'], [/oil counter/i, 'Ölmarker'], [/rad counter/i, 'Strahlungsmarker'],
  [/monarch/i, 'Monarch-Karte'], [/initiative|Undercity/i, 'Initiative / Undercity-Dungeon'], [/venture into the dungeon/i, 'Dungeon-Karten'],
  [/day|night/i, null], [/the ring tempts you/i, 'Der Ring (Ringträger-Karte)'], [/city's blessing|ascend/i, 'Segen der Stadt'],
  [/storm|copy/i, null], [/\bmeld\b/i, null], [/commander tax/i, null],
]

export default function DeckTokens({ rows }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const ids = rows.map((r) => r.card.id)
  const key = ids.join(',')
  useEffect(() => {
    let alive = true
    setError('')
    getTokens(ids).then((d) => alive && setData(d)).catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const tokens = useMemo(() => {
    if (!data) return []
    const map = {}
    for (const r of rows) {
      for (const tid of data.parts[r.card.id] || []) {
        const t = data.tokens[tid]
        if (!t) continue
        const k = t.oracleId || t.name
        ;(map[k] ||= { t, from: [] }).from.push(r.card.name)
      }
    }
    return Object.values(map).sort((a, b) => b.from.length - a.from.length || a.t.name.localeCompare(b.t.name))
  }, [data, rows])

  const markers = useMemo(() => {
    const out = {}
    for (const r of rows) for (const [re, label] of MARKERS) if (label && re.test(r.card.text || '')) (out[label] ||= []).push(r.card.name)
    return Object.entries(out).sort((a, b) => b[1].length - a[1].length)
  }, [rows])

  return (
    <div className="tokens">
      <div className="combos-head">
        <p className="muted small">Token und Embleme laut Scryfall, Marker anhand des Kartentexts erkannt. Sideboard zählt nicht mit.</p>
        <button className="btn small" onClick={() => window.print()} disabled={!tokens.length}>Drucken</button>
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Lade Token …</p>}
      {data && <>
        <h3 className="combo-sec">Token & Embleme <span className="muted">({tokens.length})</span></h3>
        {!tokens.length && <p className="muted small">Dieses Deck erzeugt keine Token.</p>}
        <div className="raster token-grid print-area">
          {tokens.map(({ t, from }) => (
            <div key={t.id} className="raster-card token" title={`${t.name} – erzeugt von: ${from.join(', ')}`}>
              <img src={t.img} alt={t.name} loading="lazy" />
              <div className="token-info">
                <b>{t.name}{t.pt ? ` ${t.pt}` : ''}</b>
                <span className="muted small">von {from.length > 2 ? `${from.slice(0, 2).join(', ')} +${from.length - 2}` : from.join(', ')}</span>
              </div>
            </div>
          ))}
        </div>
      </>}
      <h3 className="combo-sec">Marker & Spielhilfen <span className="muted">({markers.length})</span></h3>
      {!markers.length && <p className="muted small">Keine besonderen Marker nötig.</p>}
      <div className="marker-list">
        {markers.map(([label, from]) => (
          <div key={label} className="marker"><b>{label}</b> <span className="muted small">({from.length}) {from.slice(0, 4).join(', ')}{from.length > 4 ? ' …' : ''}</span></div>
        ))}
      </div>
    </div>
  )
}
