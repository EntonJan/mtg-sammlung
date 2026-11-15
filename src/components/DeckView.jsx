import { useMemo, useState } from 'react'
import { dragProps, readDrag } from '../drag'
import { entryKey } from '../store'
import { COLOR_NAMES, FINISH_LABEL, GROUPS, groupOf, unitPrice, euro } from '../util'
import Mana from './Mana'
import DeckStats from './DeckStats'
import DeckHand from './DeckHand'
import DeckCategories, { TagPicker } from './DeckCategories'
import { catsOf, tagKey } from '../categories'

const isBasic = (c) => /Basic Land/.test(c.type) || /A deck can have any number/.test(c.text || '')

export default function DeckView({ deck, cards, onMove, onRename, onDelete, onToggleCommander, onOpen, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(deck.name)
  const [over, setOver] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [tab, setTab] = useState('list')
  const [groupBy, setGroupBy] = useState('type')
  const [picker, setPicker] = useState(null)

  const rows = useMemo(() => Object.values(deck.entries)
    .filter((e) => cards[e.id])
    .map((e) => ({ ...e, key: entryKey(e.id, e.finish), card: cards[e.id], price: unitPrice(cards[e.id], e.finish) }))
    .sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name)), [deck.entries, cards])

  const cmdKeys = new Set(deck.commanders)
  const commanders = rows.filter((r) => cmdKeys.has(r.key))
  const rest = rows.filter((r) => !cmdKeys.has(r.key))

  const groups = useMemo(() => {
    const m = {}
    if (groupBy === 'cat') {
      const tags = deck.tags || {}
      for (const r of rest) {
        const t = tags[tagKey(r.card)] || []
        if (!t.length) (m[groupOf(r.card.type) === 'Land' ? '__land' : '__none'] ||= []).push(r)
        for (const c of t) (m[c] ||= []).push(r)
      }
      return [...catsOf(deck).map((c) => [c.name, c.name]), ['__none', 'Ohne Kategorie'], ['__land', 'Länder']]
        .filter(([k]) => m[k]).map(([k, label]) => ({ k, label, rows: m[k] }))
    }
    for (const r of rest) (m[groupOf(r.card.type)] ||= []).push(r)
    return GROUPS.filter(([k]) => m[k]).map(([k, label]) => ({ k, label, rows: m[k] }))
  }, [rest, groupBy, deck])

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

      <div className="deck-tabs">
        {[['list', 'Liste'], ['cats', 'Kategorien'], ['stats', 'Statistik'], ['hand', 'Probehand']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'stats' && <DeckStats rows={rows} />}
      {tab === 'hand' && <DeckHand key={count} deck={deck} rows={rows} commanderKeys={cmdKeys} onOpen={onOpen} />}
      {tab === 'cats' && <DeckCategories deck={deck} rows={rows} onUpdate={onUpdate} />}

      {tab === 'list' && <>
      {rows.length > 0 && (
        <div className="seg seg-small">
          <button className={groupBy === 'type' ? 'on' : ''} onClick={() => setGroupBy('type')}>Nach Typ</button>
          <button className={groupBy === 'cat' ? 'on' : ''} onClick={() => setGroupBy('cat')}>Nach Kategorie</button>
        </div>
      )}
      {warnings.map((w) => <p key={w} className="warn">{w}</p>)}

      {!rows.length && (
        <div className="deck-empty">
          Ziehe Karten aus der Sammlung auf dieses Deck – hier hinein oder links auf den Decknamen.
        </div>
      )}

      <div className="deck-cols">
        {commanders.length > 0 && (
          <Group label="Commander" rows={commanders} deck={deck} cmd onMove={onMove} onToggleCommander={onToggleCommander} onOpen={onOpen} picker={picker} setPicker={setPicker} onUpdate={onUpdate} />
        )}
        {groups.map((g) => (
          <Group key={g.k} gk={g.k} label={g.label} rows={g.rows} deck={deck} onMove={onMove} onToggleCommander={onToggleCommander} onOpen={onOpen} picker={picker} setPicker={setPicker} onUpdate={onUpdate} />
        ))}
      </div>
      </>}
    </div>
  )
}

function Group({ gk = 'cmd', label, rows, deck, cmd, onMove, onToggleCommander, onOpen, picker, setPicker, onUpdate }) {
  const deckId = deck.id
  const tags = deck.tags || {}
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
            {(tags[tagKey(r.card)] || []).length > 0 && (
              <span className="chips">{tags[tagKey(r.card)].map((t) => <span key={t} className="chip">{t}</span>)}</span>
            )}
          </span>
          <Mana cost={r.card.cost} />
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            {(cmd || /Legendary/.test(r.card.type) || /can be your commander/.test(r.card.text || '')) && (
              <button className={`mini ${cmd ? 'on' : ''}`} title={cmd ? 'Kein Commander mehr' : 'Als Commander festlegen'}
                onClick={() => onToggleCommander(r.key)}>★</button>
            )}
            <button className="mini" title="Kategorien" onClick={() => setPicker(picker === `${gk}|${r.key}` ? null : `${gk}|${r.key}`)}>🏷</button>
            <button className="mini" title="1 Exemplar zurück in die Sammlung"
              onClick={() => onMove({ id: r.id, finish: r.finish, from: deckId }, 'collection')}>↩</button>
          </span>
          {picker === `${gk}|${r.key}` && <TagPicker deck={deck} card={r.card} onUpdate={onUpdate} onClose={() => setPicker(null)} />}
        </div>
      ))}
    </section>
  )
}
