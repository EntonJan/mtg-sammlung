import { useMemo, useState } from 'react'
import { catsOf, tagKey } from '../categories'
import { GROUPS, groupOf, euro } from '../util'

const FORMATS = [
  ['moxfield', 'Moxfield / MTG Arena (mit Set)'],
  ['archidekt', 'Archidekt (mit Kategorien)'],
  ['plain', 'Einfach (nur Anzahl + Name)'],
]

// Reiter „Export“: Deckliste als Text (kopieren/herunterladen) oder druckbare Liste
export default function DeckExport({ deck, rows, commanderKeys }) {
  const [fmt, setFmt] = useState('moxfield')
  const [copied, setCopied] = useState(false)

  const text = useMemo(() => {
    const cmd = rows.filter((r) => commanderKeys.has(r.key))
    const rest = rows.filter((r) => !commanderKeys.has(r.key)).sort((a, b) => a.card.name.localeCompare(b.card.name))
    const tags = deck.tags || {}
    const foil = (r) => (r.finish === 'foil' ? ' *F*' : r.finish === 'etched' ? ' *E*' : '')
    if (fmt === 'plain') {
      return [...cmd, ...rest].map((r) => `${r.qty} ${r.card.name}`).join('\n')
    }
    if (fmt === 'archidekt') {
      const line = (r, extra = []) => {
        const t = [...extra, ...(tags[tagKey(r.card)] || [])]
        return `${r.qty}x ${r.card.name} (${r.card.set.toLowerCase()}) ${r.card.num}${foil(r)}${t.length ? ` [${t.join(',')}]` : ''}`
      }
      return [...cmd.map((r) => line(r, ['Commander{top}'])), ...rest.map((r) => line(r))].join('\n')
    }
    const line = (r) => `${r.qty} ${r.card.name} (${r.card.set}) ${r.card.num}${foil(r)}`
    return (cmd.length ? `Commander\n${cmd.map(line).join('\n')}\n\nDeck\n` : '') + rest.map(line).join('\n')
  }, [rows, commanderKeys, fmt, deck.tags])

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* egal */ }
  }

  const download = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${deck.name.replace(/[^\w\- äöüÄÖÜß]/g, '')}.txt`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const print = () => {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(printHtml(deck, rows, commanderKeys))
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }

  return (
    <div className="export">
      <div className="hand-actions">
        <select value={fmt} onChange={(e) => setFmt(e.target.value)}>
          {FORMATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="btn primary" onClick={copy}>{copied ? 'Kopiert ✓' : 'Kopieren'}</button>
        <button className="btn" onClick={download}>Als .txt herunterladen</button>
        <button className="btn" onClick={print}>Druckliste</button>
      </div>
      <textarea className="mono-area" rows={18} readOnly value={text} onFocus={(e) => e.target.select()} />
      <p className="muted small">
        Archidekt: Deck → Import → Text einfügen (Kategorien wie Ramp/Draw werden übernommen).
        Moxfield: Deck → Import. Die Druckliste enthält Kästchen zum Abhaken, z. B. zum Zusammensuchen der Karten.
        Kategorien in deinem Deck: {catsOf(deck).map((c) => c.name).join(', ')}.
      </p>
    </div>
  )
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function printHtml(deck, rows, commanderKeys) {
  const groups = {}
  for (const r of rows) {
    const g = commanderKeys.has(r.key) ? 'Commander' : groupOf(r.card.type)
    ;(groups[g] ||= []).push(r)
  }
  const order = [['Commander', 'Commander'], ...GROUPS]
  const count = rows.reduce((s, r) => s + r.qty, 0)
  const value = rows.reduce((s, r) => s + (r.price ?? 0) * r.qty, 0)
  const sections = order.filter(([k]) => groups[k]).map(([k, label]) => `
    <section><h2>${esc(label)} (${groups[k].reduce((s, r) => s + r.qty, 0)})</h2>
    ${groups[k].sort((a, b) => a.card.name.localeCompare(b.card.name)).map((r) => `
      <div class="l"><span class="b"></span><span class="q">${r.qty}</span><span class="n">${esc(r.card.name)}</span><span class="s">${esc(r.card.set)} ${esc(r.card.num)}${r.finish !== 'normal' ? ' ✦' : ''}</span></div>`).join('')}
    </section>`).join('')
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(deck.name)}</title>
  <style>
    body { font: 11pt system-ui, sans-serif; margin: 14mm; color: #000; }
    h1 { font-size: 18pt; margin: 0 0 2mm; } .meta { color: #555; margin-bottom: 6mm; }
    .cols { columns: 2; column-gap: 10mm; }
    section { break-inside: avoid; margin-bottom: 5mm; }
    h2 { font-size: 11pt; border-bottom: 1px solid #000; margin: 0 0 1.5mm; padding-bottom: 1mm; }
    .l { display: flex; gap: 2mm; align-items: center; padding: .6mm 0; font-size: 10pt; }
    .b { width: 3mm; height: 3mm; border: 1px solid #000; flex-shrink: 0; }
    .q { width: 5mm; text-align: right; } .n { flex: 1; } .s { color: #666; font-size: 8.5pt; }
  </style></head><body>
  <h1>${esc(deck.name)}</h1><div class="meta">${count} Karten · ${euro(value)} · ${new Date().toLocaleDateString('de-DE')}</div>
  <div class="cols">${sections}</div></body></html>`
}
