import { useMemo, useState } from 'react'
import { entryKey } from '../store'
import { euro, unitPrice } from '../util'
import { suggestTags, tagKey } from '../categories'
import { analyzeSynergy } from '../synergy'

// Zwei eigene Decks nebeneinander: Kennzahlen + welche Karten beide gemeinsam haben
const isLand = (c) => /\bLand\b/.test((c.type || '').split(' // ')[0])

function summarize(d, cards) {
  const side = new Set(d.side || []), cmd = new Set(d.commanders || [])
  const rows = Object.values(d.entries || {}).filter((e) => cards[e.id] && !side.has(entryKey(e.id, e.finish)))
    .map((e) => ({ ...e, key: entryKey(e.id, e.finish), card: cards[e.id], isCmd: cmd.has(entryKey(e.id, e.finish)) }))
  const tagsOf = (c) => { const own = d.tags?.[tagKey(c)]; return own?.length ? own : suggestTags(c) }
  const nonland = rows.filter((r) => !isLand(r.card) && !r.isCmd)
  const n = (pred) => rows.filter((r) => !r.isCmd).reduce((t, r) => t + (pred(r) ? r.qty : 0), 0)
  const nlQty = nonland.reduce((t, r) => t + r.qty, 0)
  const syn = analyzeSynergy(rows.map((r) => ({ key: r.key, card: r.card, qty: r.qty, isCommander: r.isCmd })))
  return {
    name: d.name,
    cmd: rows.filter((r) => r.isCmd).map((r) => r.card.name).join(' & ') || '–',
    count: rows.reduce((t, r) => t + r.qty, 0),
    value: rows.reduce((t, r) => t + (unitPrice(r.card, r.finish) || 0) * r.qty, 0),
    cmc: nlQty ? nonland.reduce((t, r) => t + (r.card.cmc || 0) * r.qty, 0) / nlQty : 0,
    lands: n((r) => isLand(r.card)),
    ramp: n((r) => tagsOf(r.card).includes('Ramp')),
    draw: n((r) => tagsOf(r.card).includes('Draw')),
    removal: n((r) => tagsOf(r.card).some((t) => t === 'Removal' || t === 'Board Wipe')),
    deckSyn: syn.deckScore, cmdSyn: syn.cmdScore,
    names: new Map(rows.filter((r) => !/Basic Land/.test(r.card.type)).map((r) => [r.card.name, r.card])),
  }
}

export default function DeckCompare({ deck, decks, cards, onOpen }) {
  const others = Object.values(decks).filter((d) => d.kind !== 'binder' && d.id !== deck.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const [other, setOther] = useState(others[0]?.id || '')
  const a = useMemo(() => summarize(deck, cards), [deck, cards])
  const b = useMemo(() => (decks[other] ? summarize(decks[other], cards) : null), [decks, other, cards])
  if (!others.length) return <p className="muted">Du brauchst mindestens ein zweites Deck zum Vergleichen.</p>

  const shared = b ? [...a.names.keys()].filter((n) => b.names.has(n)).sort() : []
  const onlyA = b ? [...a.names.keys()].filter((n) => !b.names.has(n)).sort() : []
  const onlyB = b ? [...b.names.keys()].filter((n) => !a.names.has(n)).sort() : []
  const pct = (v) => `${Math.round(v * 100)} %`
  const rowsDef = [
    ['Commander', (x) => x.cmd, null],
    ['Karten', (x) => x.count, null],
    ['Wert', (x) => euro(x.value), (x) => -x.value],
    ['Ø Manawert (ohne Länder)', (x) => x.cmc.toFixed(2), (x) => -x.cmc],
    ['Länder', (x) => x.lands, null],
    ['Ramp', (x) => x.ramp, (x) => x.ramp],
    ['Draw', (x) => x.draw, (x) => x.draw],
    ['Removal & Board Wipes', (x) => x.removal, (x) => x.removal],
    ['Deck-Synergie', (x) => pct(x.deckSyn), (x) => x.deckSyn],
    ['Commander-Synergie', (x) => pct(x.cmdSyn), (x) => x.cmdSyn],
  ]
  const Chips = ({ list, src }) => (
    <div className="cmp-chips">{list.map((n) => <span key={n} className="chip" onClick={() => onOpen?.(src.get(n))}>{n}</span>)}{!list.length && <span className="muted small">keine</span>}</div>
  )
  return (
    <div className="cmp">
      <div className="pt-pick">
        <b>Vergleichen mit</b>
        <select value={other} onChange={(e) => setOther(e.target.value)}>
          {others.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      {b && (
        <>
          <table className="cmp-table">
            <thead><tr><th /><th>{a.name}</th><th>{b.name}</th></tr></thead>
            <tbody>
              {rowsDef.map(([label, get, better]) => {
                const win = better ? Math.sign(better(a) - better(b)) : 0
                return (
                  <tr key={label}>
                    <td className="muted">{label}</td>
                    <td className={win > 0 ? 'better' : ''}>{get(a)}</td>
                    <td className={win < 0 ? 'better' : ''}>{get(b)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="muted small">Gold markiert den jeweils höheren Wert bei Ramp, Draw, Removal und Synergie bzw. den niedrigeren bei Manawert und Preis.</p>
          <h3 className="combo-sec">In beiden Decks <span className="muted">({shared.length})</span></h3>
          <Chips list={shared} src={a.names} />
          <div className="cmp-cols">
            <div><h3 className="combo-sec">Nur in {a.name} <span className="muted">({onlyA.length})</span></h3><Chips list={onlyA} src={a.names} /></div>
            <div><h3 className="combo-sec">Nur in {b.name} <span className="muted">({onlyB.length})</span></h3><Chips list={onlyB} src={b.names} /></div>
          </div>
        </>
      )}
    </div>
  )
}
