import { useMemo, useState } from 'react'
import { dragProps, readDrag } from '../drag'
import { entryKey } from '../store'
import { FINISH_LABEL, euro, unitPrice } from '../util'

// Ordner (z. B. Tauschordner): Karten mit Preisen, als Liste teilbar
export default function BinderView({ deck, cards, onMove, onRename, onDelete, onOpen }) {
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
    .sort((a, b) => (b.price ?? 0) - (a.price ?? 0)), [deck.entries, cards, minPrice])

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

      <div className="hand-actions">
        <button className="btn primary" onClick={() => copy(true)} disabled={!rows.length}>{copied === 'prices' ? 'Kopiert ✓' : 'Liste mit Preisen kopieren'}</button>
        <button className="btn" onClick={() => copy(false)} disabled={!rows.length}>{copied === 'plain' ? 'Kopiert ✓' : 'Als Importliste kopieren'}</button>
        <label className="muted small">ab €
          <input type="number" min="0" step="0.5" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} style={{ width: 70, marginLeft: 6 }} />
        </label>
      </div>

      {!rows.length && <div className="deck-empty">Ziehe Karten hierher, die du tauschen oder verkaufen möchtest.</div>}

      <table className="match-table binder-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} {...dragProps({ id: r.id, finish: r.finish, from: deck.id })} onClick={() => onOpen(r.card)}>
              <td className="qty">{r.qty}×</td>
              <td>{r.card.name}{r.finish !== 'normal' && <em className="foil">{FINISH_LABEL[r.finish]}</em>}</td>
              <td className="muted small">{r.card.setName} ({r.card.set} #{r.card.num})</td>
              <td className="price">{euro(r.price)}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <button className="mini" title="1 Exemplar zurück in die Sammlung"
                  onClick={() => onMove({ id: r.id, finish: r.finish, from: deck.id }, 'collection')}>↩</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
