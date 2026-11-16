import { useEffect, useMemo, useState } from 'react'
import { loadShare } from '../share'
import { GROUPS, euro, groupOf } from '../util'

const KIND = { deck: 'Deck', binder: 'Ordner', collection: 'Sammlung', wishlist: 'Wunschliste' }

// Öffentliche Nur-Lesen-Ansicht eines geteilten Decks/Ordners/der Sammlung/Wunschliste
export default function SharedView({ id, embedded }) {
  const [share, setShare] = useState(undefined)
  const [mode, setMode] = useState('grid')
  const [q, setQ] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => { loadShare(id).then(setShare).catch(() => setShare(null)) }, [id])

  const rows = useMemo(() => {
    if (!share) return []
    const s = q.trim().toLowerCase()
    return share.rows.filter((r) => !s || r.n.toLowerCase().includes(s) || r.s.toLowerCase() === s)
  }, [share, q])

  const groups = useMemo(() => {
    if (!share) return []
    if (share.kind === 'deck') {
      const cmd = rows.filter((r) => r.z === 'cmd'), side = rows.filter((r) => r.z === 'side')
      const main = rows.filter((r) => r.z !== 'cmd' && r.z !== 'side')
      const m = {}
      for (const r of main) (m[groupOf(r.t)] ||= []).push(r)
      return [
        ...(cmd.length ? [{ k: 'cmd', label: 'Commander', rows: cmd }] : []),
        ...GROUPS.filter(([k]) => m[k]).map(([k, label]) => ({ k, label, rows: m[k].sort((a, b) => a.m - b.m || a.n.localeCompare(b.n)) })),
        ...(side.length ? [{ k: 'side', label: 'Sideboard', rows: side }] : []),
      ]
    }
    const sorted = [...rows].sort((a, b) => (b.p || 0) - (a.p || 0))
    return [{ k: 'all', label: KIND[share.kind], rows: sorted }]
  }, [share, rows])

  const copyList = async () => {
    const text = share.rows.map((r) => `${r.q} ${r.n} (${r.s.toUpperCase()}) ${r.c}${r.f === 'foil' ? ' *F*' : ''}`).join('\n')
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* egal */ }
  }

  if (share === undefined) return <div className="shared"><p className="muted">Lade …</p></div>
  if (share === null) return <div className="shared"><h2>Link nicht gefunden</h2><p className="muted">Dieser Link wurde deaktiviert oder existiert nicht.</p></div>
  const big = share.rows.length > 400

  return (
    <div className={`shared ${embedded ? 'embedded' : ''}`}>
      {!embedded && <header className="shared-top"><span className="shared-brand">❖ MTG SAMMLUNG ❖</span><a className="btn small" href="https://entonjan.github.io/mtg-sammlung/">Eigene Sammlung</a></header>}
      <div className="deck-head">
        <h2>{share.kind === 'binder' ? '📁 ' : ''}{share.name}</h2>
        <div className="deck-stats">
          <span className="muted">{KIND[share.kind]} · nur lesen</span>
          <span><b>{share.count}</b> Karten</span>
          <span>Wert <b>{euro(share.value)}</b></span>
        </div>
      </div>
      <div className="shared-bar">
        <input className="search" placeholder="Karte suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg seg-small">
          <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>Liste</button>
          <button className={mode === 'grid' ? 'on' : ''} onClick={() => setMode('grid')}>Bilder</button>
        </div>
        <button className="btn small" onClick={copyList}>{copied ? 'Kopiert ✓' : 'Als Liste kopieren'}</button>
      </div>
      {groups.map((g) => (
        <section key={g.k} className="deck-raster-group">
          <h3>{g.label} <span className="muted">({g.rows.reduce((s, r) => s + r.q, 0)})</span></h3>
          {mode === 'grid' && !(big && !q) ? (
            <div className="raster">
              {g.rows.slice(0, 600).map((r, i) => (
                <div key={i} className={`raster-card ${r.f !== 'normal' ? 'foiled' : ''}`} title={`${r.n} · ${r.s.toUpperCase()} #${r.c}`}>
                  <img src={r.i} alt={r.n} loading="lazy" />
                  {r.q > 1 && <span className="raster-qty">{r.q}×</span>}
                  {r.p != null && <span className="slot-price">{euro(r.p)}</span>}
                </div>
              ))}
            </div>
          ) : (
            <table className="match-table">
              <tbody>
                {g.rows.slice(0, 3000).map((r, i) => (
                  <tr key={i}><td className="qty">{r.q}×</td><td>{r.n}{r.f !== 'normal' && <em className="foil">{r.f}</em>}</td><td className="muted small">{r.s.toUpperCase()} #{r.c}</td><td className="price">{euro(r.p)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {mode === 'grid' && big && !q && <p className="muted small">Viele Karten – Bilder erscheinen, sobald du suchst. Sonst siehst du die Liste.</p>}
        </section>
      ))}
    </div>
  )
}
