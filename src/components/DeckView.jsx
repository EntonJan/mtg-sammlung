import { useMemo, useState } from 'react'
import { dragProps, readDrag } from '../drag'
import { entryKey } from '../store'
import { COLOR_NAMES, FINISH_LABEL, GROUPS, groupOf, unitPrice, euro } from '../util'
import Mana from './Mana'

const isBasic = (c) => /Basic Land/.test(c.type) || /A deck can have any number/.test(c.text || '')

export default function DeckView({ deck, cards, onMove, onRename, onDelete, onToggleCommander, onOpen }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(deck.name)
  const [over, setOver] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  const rows = useMemo(() => Object.values(deck.entries)
    .filter((e) => cards[e.id])
    .map((e) => ({ ...e, key: entryKey(e.id, e.finish), card: cards[e.id], price: unitPrice(cards[e.id], e.finish) }))
    .sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name)), [deck.entries, cards])

  const cmdKeys = new Set(deck.commanders)
  const commanders = rows.filter((r) => cmdKeys.has(r.key))
  const rest = rows.filter((r) => !cmdKeys.has(r.key))

  const groups = useMemo(() => {
    const m = {}
    for (const r of rest) (m[groupOf(r.card.type)] ||= []).push(r)
    return GROUPS.filter(([k]) => m[k]).map(([k, label]) => ({ k, label, rows: m[k] }))
  }, [rest])

  const count = rows.reduce((s, r) => s + r.qty, 0)
  const value = rows.reduce((s, r) => s + (r.price ?? 0) * r.qty, 0)
  const identity = [...new Set(commanders.flatMap((r) => r.card.ci))]

  // Commander-Hinweise: Singleton und Farbidentität
  const warnings = []
  const byName = {}
  for (const r of rows) byName[r.card.name] = (byName[r.card.name] || 0) + r.qty
  const dupes = Object.entries(byName).filter(([n, q]) => q > 1 && !isBasic(rows.find((r) => r.card.name === n).card))
  if (dupes.length) warnings.push(`Mehrfach im Deck: ${dupes.map(([n, q]) => `${n} (${q}×)`).join(', ')}`)
  if (commanders.length) {
    const off = rest.filter((r) => r.card.ci.some((c) => !identity.includes(c)))
    if (off.length) warnings.push(`Außerhalb der Farbidentität: ${off.map((r) => r.card.name).join(', ')}`)
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
          <h2 onClick={() => { setName(deck.name); setEditing(true) }} title="Klicken zum Umbenennen">{deck.name}</h2>
        )}
        <div className="deck-stats">
          <span className={count === 100 ? 'ok' : ''}><b>{count}</b>/100 Karten</span>
          <span>Wert <b>{euro(value)}</b></span>
          {identity.length > 0 && <span>Farbidentität <b>{identity.map((c) => COLOR_NAMES[c]).join(', ')}</b></span>}
        </div>
        {confirmDel ? (
          <span className="confirm">
            Alle {count} Karten zurück in die Sammlung und Deck löschen?
            <button className="btn small danger" onClick={onDelete}>Ja, auflösen</button>
            <button className="btn small ghost" onClick={() => setConfirmDel(false)}>Abbrechen</button>
          </span>
        ) : (
          <button className="btn ghost small danger" onClick={() => setConfirmDel(true)}>Deck auflösen</button>
        )}
      </div>

      {warnings.map((w) => <p key={w} className="warn">{w}</p>)}

      {!rows.length && (
        <div className="deck-empty">
          Ziehe Karten aus der Sammlung auf dieses Deck – hier hinein oder links auf den Decknamen.
        </div>
      )}

      <div className="deck-cols">
        {commanders.length > 0 && (
          <Group label="Commander" rows={commanders} deckId={deck.id} cmd onMove={onMove} onToggleCommander={onToggleCommander} onOpen={onOpen} />
        )}
        {groups.map((g) => (
          <Group key={g.k} label={g.label} rows={g.rows} deckId={deck.id} onMove={onMove} onToggleCommander={onToggleCommander} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
}

function Group({ label, rows, deckId, cmd, onMove, onToggleCommander, onOpen }) {
  const n = rows.reduce((s, r) => s + r.qty, 0)
  return (
    <section className="deck-group">
      <h3>{label} <span className="muted">({n})</span></h3>
      {rows.map((r) => (
        <div key={r.key} className="deck-row" {...dragProps({ id: r.id, finish: r.finish, from: deckId })} onClick={() => onOpen(r.card)}>
          <span className="qty">{r.qty}</span>
          <img className="thumb" src={r.card.thumb} alt="" loading="lazy" draggable={false} />
          <span className="row-main">
            <span className="row-name">{r.card.name}{r.finish !== 'normal' && <em className="foil">{FINISH_LABEL[r.finish]}</em>}</span>
          </span>
          <Mana cost={r.card.cost} />
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            {(cmd || /Legendary/.test(r.card.type) || /can be your commander/.test(r.card.text || '')) && (
              <button className={`mini ${cmd ? 'on' : ''}`} title={cmd ? 'Kein Commander mehr' : 'Als Commander festlegen'}
                onClick={() => onToggleCommander(r.key)}>★</button>
            )}
            <button className="mini" title="1 Exemplar zurück in die Sammlung"
              onClick={() => onMove({ id: r.id, finish: r.finish, from: deckId }, 'collection')}>↩</button>
          </span>
        </div>
      ))}
    </section>
  )
}
