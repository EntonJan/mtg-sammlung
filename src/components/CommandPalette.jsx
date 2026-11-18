import { useEffect, useMemo, useRef, useState } from 'react'

// Schnellsuche (Strg+K): Seiten, Decks/Ordner und Karten aus Sammlung und Decks direkt anspringen
const PAGES = [
  ['collection', 'Sammlung'], ['add', 'Hinzufügen'], ['scan', 'Scannen'], ['wish', 'Wunschliste'], ['value', 'Wert'],
  ['sell', 'Verkaufen'], ['match', 'Was fehlt mir?'], ['pull', 'Raussuchen'], ['import', 'Import'], ['friends', 'Freunde'],
]
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export default function CommandPalette({ onClose, decks, cards, entries, deNames, onGo, onOpenCard, onSettings }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef(null)
  const listRef = useRef(null)
  useEffect(() => { input.current?.focus() }, [])

  // Karten: alle Exemplare aus Sammlung + Decks, je Name nur einmal
  const allCards = useMemo(() => {
    const m = new Map()
    const add = (e, where) => { const c = cards[e.id]; if (!c) return; const k = c.name; const v = m.get(k) || { card: c, where: new Set() }; v.where.add(where); m.set(k, v) }
    Object.values(entries || {}).forEach((e) => add(e, 'Sammlung'))
    Object.values(decks || {}).forEach((d) => Object.values(d.entries || {}).forEach((e) => add(e, d.name)))
    return [...m.values()].map((v) => ({ ...v, de: deNames?.[v.card.oracleId] || '', key: norm(v.card.name + ' ' + (deNames?.[v.card.oracleId] || '')) }))
  }, [cards, entries, decks, deNames])

  const results = useMemo(() => {
    const t = norm(q.trim())
    const out = []
    const pages = [...PAGES, ['settings', 'Einstellungen']].filter(([, l]) => !t || norm(l).includes(t))
    out.push(...pages.slice(0, t ? 5 : 10).map(([k, l]) => ({ type: 'Seite', label: l, run: () => (k === 'settings' ? onSettings() : onGo({ kind: k })) })))
    const ds = Object.values(decks || {}).filter((d) => !t || norm(d.name).includes(t)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    out.push(...ds.slice(0, t ? 8 : 6).map((d) => ({ type: d.kind === 'binder' ? 'Ordner' : 'Deck', label: d.name, run: () => onGo({ kind: 'deck', id: d.id }) })))
    if (t.length >= 2) {
      const hits = allCards.filter((c) => c.key.includes(t)).sort((a, b) => (norm(a.card.name).startsWith(t) ? 0 : 1) - (norm(b.card.name).startsWith(t) ? 0 : 1) || a.card.name.localeCompare(b.card.name))
      out.push(...hits.slice(0, 25).map((c) => ({ type: 'Karte', label: c.card.name, sub: [c.de, [...c.where].slice(0, 3).join(', ')].filter(Boolean).join(' · '), img: c.card.thumb, run: () => onOpenCard(c.card) })))
    }
    return out
  }, [q, decks, allCards, onGo, onOpenCard, onSettings])

  useEffect(() => { setSel(0) }, [q])
  useEffect(() => { listRef.current?.querySelector('.cp-item.on')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  const pick = (r) => { onClose(); r.run() }
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
    else if (e.key === 'Enter' && results[sel]) { e.preventDefault(); pick(results[sel]) }
    else if (e.key === 'Escape') onClose()
  }

  return (
    <div className="modal-bg cp-bg" onClick={onClose}>
      <div className="cp" onClick={(e) => e.stopPropagation()}>
        <input ref={input} className="cp-input" placeholder="Karte, Deck oder Seite suchen …" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} />
        <div className="cp-list" ref={listRef}>
          {results.map((r, i) => (
            <button key={r.type + r.label + i} className={`cp-item ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => pick(r)}>
              {r.img ? <img src={r.img} alt="" /> : <span className="cp-ico" />}
              <span className="cp-main"><b>{r.label}</b>{r.sub && <small>{r.sub}</small>}</span>
              <span className="cp-type">{r.type}</span>
            </button>
          ))}
          {!results.length && <p className="muted cp-empty">Nichts gefunden.</p>}
        </div>
        <div className="cp-foot muted small">↑↓ auswählen · Enter öffnen · Esc schließen · Strg+K öffnet die Suche überall</div>
      </div>
    </div>
  )
}
