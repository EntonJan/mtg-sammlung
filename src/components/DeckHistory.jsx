import { useMemo, useState } from 'react'
import { fromItems, toItems } from '../store'

const fmt = (t) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
const day = (t) => new Date(t).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

// Deck-Verlauf: was kam wann rein/raus + gemerkte Versionen zum Vergleichen und Zurückholen
export default function DeckHistory({ deck, cards, onUpdate, onRestore }) {
  const [name, setName] = useState('')
  const [cmp, setCmp] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [missing, setMissing] = useState(null)

  const label = (key) => {
    const [id, finish] = key.split('|')
    const c = cards[id]
    return `${c ? c.name : 'Unbekannte Karte'}${c ? ` (${c.set.toUpperCase()})` : ''}${finish !== 'normal' ? ` · ${finish}` : ''}`
  }

  const days = useMemo(() => {
    const out = []
    for (const e of [...(deck.log || [])].reverse()) {
      const d = day(e.t)
      if (!out.length || out[out.length - 1].d !== d) out.push({ d, items: [] })
      out[out.length - 1].items.push(e)
    }
    return out
  }, [deck.log])

  const save = () => {
    const v = { t: Date.now(), name: name.trim() || `Version vom ${fmt(Date.now())}`, items: toItems(deck.entries), commanders: deck.commanders, side: deck.side || [] }
    onUpdate({ versions: [...(deck.versions || []), v].slice(-20) })
    setName('')
  }
  const remove = (t) => onUpdate({ versions: (deck.versions || []).filter((v) => v.t !== t) })

  const diff = (v) => {
    const old = fromItems(v.items)
    const keys = new Set([...Object.keys(old), ...Object.keys(deck.entries)])
    const add = [], rem = []
    for (const k of keys) {
      const d = (deck.entries[k]?.qty || 0) - (old[k]?.qty || 0)
      if (d > 0) add.push([k, d]); else if (d < 0) rem.push([k, -d])
    }
    return { add, rem }
  }

  return (
    <div className="history">
      <section className="hist-versions">
        <h3 className="combo-sec">Gemerkte Versionen</h3>
        <div className="hist-save">
          <input placeholder="Name, z. B. „Vor dem Spieleabend“" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          <button className="btn primary small" onClick={save}>Aktuelle Version merken</button>
        </div>
        {!(deck.versions || []).length && <p className="muted small">Noch keine Version gemerkt. Merke dir einen Stand, bevor du größer umbaust – dann kannst du jederzeit vergleichen oder zurück.</p>}
        {[...(deck.versions || [])].reverse().map((v) => {
          const n = Object.values(fromItems(v.items)).reduce((s, e) => s + e.qty, 0)
          const open = cmp === v.t
          const d = open ? diff(v) : null
          return (
            <div key={v.t} className="hist-version">
              <div className="hist-vhead">
                <b>{v.name}</b> <span className="muted small">{fmt(v.t)} · {n} Karten</span>
                <span className="hist-actions">
                  <button className="btn small" onClick={() => setCmp(open ? null : v.t)}>{open ? 'Vergleich schließen' : 'Mit jetzt vergleichen'}</button>
                  {confirm === v.t ? <>
                    <button className="btn small primary" onClick={() => { setMissing({ name: v.name, list: onRestore(v) }); setConfirm(null) }}>Ja, wiederherstellen</button>
                    <button className="btn small ghost" onClick={() => setConfirm(null)}>Abbrechen</button>
                  </> : <button className="btn small" onClick={() => setConfirm(v.t)}>Wiederherstellen</button>}
                  <button className="mini danger" title="Version löschen" onClick={() => remove(v.t)}>🗑</button>
                </span>
              </div>
              {confirm === v.t && <p className="muted small">Karten, die jetzt zusätzlich im Deck sind, gehen zurück in die Sammlung. Fehlende werden aus der Sammlung geholt, soweit frei.</p>}
              {open && (
                <div className="hist-diff">
                  {!d.add.length && !d.rem.length && <p className="muted small">Keine Unterschiede.</p>}
                  {d.add.length > 0 && <div><h4>Seitdem dazugekommen</h4><ul>{d.add.map(([k, q]) => <li key={k} className="plus">+{q} {label(k)}</li>)}</ul></div>}
                  {d.rem.length > 0 && <div><h4>Seitdem rausgeflogen</h4><ul>{d.rem.map(([k, q]) => <li key={k} className="minus">−{q} {label(k)}</li>)}</ul></div>}
                </div>
              )}
            </div>
          )
        })}
        {missing && (
          <div className="hist-missing">
            <b>„{missing.name}“ wiederhergestellt.</b>{' '}
            {missing.list.length ? <>Diese Karten waren nicht frei in der Sammlung und fehlen jetzt: {missing.list.map((e) => `${e.qty}× ${label(`${e.id}|${e.finish}`)}`).join(', ')}</> : 'Alle Karten waren vorhanden.'}
            <button className="mini" onClick={() => setMissing(null)}>×</button>
          </div>
        )}
      </section>

      <section>
        <h3 className="combo-sec">Änderungen</h3>
        {!days.length && <p className="muted small">Noch keine Änderungen aufgezeichnet. Ab jetzt wird jede Änderung am Deck hier protokolliert.</p>}
        {days.map((g) => (
          <div key={g.d} className="hist-day">
            <h4>{g.d}</h4>
            {g.items.map((e) => (
              <div key={e.t} className="hist-entry">
                <span className="muted small">{new Date(e.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
                <span>{e.ch.map((c) => {
                  const i = c.lastIndexOf('|'); const q = Number(c.slice(i + 1)); const k = c.slice(0, i)
                  return <span key={c} className={q > 0 ? 'plus' : 'minus'}>{q > 0 ? `+${q}` : `−${-q}`} {label(k)}</span>
                })}</span>
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  )
}
