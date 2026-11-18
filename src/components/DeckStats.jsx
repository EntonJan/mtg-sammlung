import Info from './Info'
import { useMemo } from 'react'
import { COLOR_NAMES, GROUPS, groupOf, manaSymbols, euro } from '../util'

const LAND_TYPE = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }
const PIP_COLOR = { W: '#f8f3d6', U: '#a9d6f5', B: '#bfb3b0', R: '#f4a68a', G: '#9ed3a8', C: '#d5d0cc' }

// Statistiken eines Decks: Manakurve, Farben, Typen, Länder, teuerste Karten
export default function DeckStats({ rows, identity }) {
  const s = useMemo(() => {
    const curve = Array(8).fill(0) // 0..6, 7+
    const pips = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
    const produces = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
    const types = {}
    const mdfcBy = {} // je Typ: davon MDFC
    let lands = 0, mdfc = 0, spells = 0, cmcSum = 0, total = 0
    for (const r of rows) {
      const c = r.card
      total += r.qty
      const g = groupOf(c.type)
      if (g === 'MDFC') {
        // MDFC zählt bei beiden Seiten mit: Typ der Vorderseite UND Land
        const front = groupOf(c.type.split(' // ')[0])
        mdfc += r.qty
        types[front] = (types[front] || 0) + r.qty
        types.Land = (types.Land || 0) + r.qty
        mdfcBy[front] = (mdfcBy[front] || 0) + r.qty
        mdfcBy.Land = (mdfcBy.Land || 0) + r.qty
        lands += r.qty
      } else types[g] = (types[g] || 0) + r.qty
      if (g === 'Land') {
        lands += r.qty
        // Welche Farben das Land erzeugt: {G} im Regeltext oder Landtyp (Forest, Plains …)
        const made = new Set()
        for (const col of Object.keys(produces)) {
          if ((c.text || '').includes(`{${col}}`) || (LAND_TYPE[col] && c.type.includes(LAND_TYPE[col]))) made.add(col)
        }
        if (/any color/i.test(c.text || '')) ['W', 'U', 'B', 'R', 'G'].forEach((col) => made.add(col))
        // Im Deck zählen nur Farben, die der Commander erlaubt (Command Tower, Exotic Orchard, City of Brass …)
        if (identity?.length) for (const col of [...made]) if (col !== 'C' && !identity.includes(col)) made.delete(col)
        made.forEach((col) => { produces[col] += r.qty })
        continue
      }
      spells += r.qty
      cmcSum += c.cmc * r.qty
      curve[Math.min(7, Math.floor(c.cmc))] += r.qty
      for (const sym of manaSymbols(c.cost.split(' // ')[0])) {
        for (const ch of sym.split('/')) if (pips[ch] !== undefined) pips[ch] += r.qty
      }
    }
    const top = [...rows].sort((a, b) => (b.price ?? 0) - (a.price ?? 0)).slice(0, 8)
    return { curve, pips, produces, types, mdfcBy, lands, mdfc, spells, total, avg: spells ? cmcSum / spells : 0, top }
  }, [rows, identity])

  if (!rows.length) return <p className="muted">Noch keine Karten im Deck.</p>

  const maxCurve = Math.max(1, ...s.curve)
  const pipTotal = Object.values(s.pips).reduce((a, b) => a + b, 0) || 1
  const typeList = GROUPS.filter(([k]) => s.types[k])
  const maxType = Math.max(1, ...Object.values(s.types))

  return (
    <div className="stats">
      <div className="stat-tiles">
        <Tile label="Karten" value={s.total} />
        <Tile label="Länder" value={s.lands} sub={s.mdfc ? `davon ${s.mdfc} MDFC` : ''} hint={`${Math.round((s.lands / s.total) * 100)} % · Commander: meist 35–38`} />
        <Tile label="Ø Manawert" value={s.avg.toFixed(2).replace('.', ',')} hint="ohne Länder" />
        <Tile label="Zauber" value={s.spells} />
      </div>

      <section className="stat-card">
        <h3>Manakurve <span className="muted small">(ohne Länder)</span></h3>
        <div className="curve">
          {s.curve.map((n, i) => (
            <div key={i} className="curve-col">
              <span className="curve-n">{n || ''}</span>
              <div className="curve-bar" style={{ height: `${(n / maxCurve) * 100}%` }} />
              <span className="curve-x">{i === 7 ? '7+' : i}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="stat-card">
        <h3>Farben</h3>
        <p className="muted small">Farbsymbole in den Manakosten</p>
        <div className="pip-bar">
          {Object.entries(s.pips).filter(([, n]) => n).map(([c, n]) => (
            <div key={c} style={{ flex: n, background: PIP_COLOR[c] }} title={`${COLOR_NAMES[c]}: ${n}`}>
              {Math.round((n / pipTotal) * 100)} %
            </div>
          ))}
        </div>
        <table className="pip-table">
          <thead><tr><th></th><th>Symbole</th><th>Länder, die sie erzeugen <Info>Zählt Länder, deren Regeltext oder Landtyp die Farbe erzeugt. Länder mit „Mana einer beliebigen Farbe“ (Command Tower, City of Brass …) zählen nur für die Farben deines Commanders.</Info></th></tr></thead>
          <tbody>
            {Object.keys(s.pips).filter((c) => s.pips[c] || s.produces[c]).map((c) => (
              <tr key={c}>
                <td><span className="pip-dot" style={{ background: PIP_COLOR[c] }} /> {COLOR_NAMES[c]}</td>
                <td>{s.pips[c]}</td>
                <td>{s.produces[c]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="stat-card">
        <h3>Kartentypen</h3>
        {s.mdfc > 0 && <p className="muted small">MDFCs zählen bei ihrer Vorderseite und als Land – die Summe liegt daher über der Kartenzahl.</p>}
        {typeList.map(([k, label]) => (
          <div key={k} className="hbar">
            <span className="hbar-label">{label}</span>
            <span className="hbar-track"><span style={{ width: `${(s.types[k] / maxType) * 100}%` }} /></span>
            <span className="hbar-n">{s.types[k]}{s.mdfcBy[k] ? <span className="muted small"> (davon {s.mdfcBy[k]} MDFC)</span> : null}</span>
          </div>
        ))}
      </section>

      <section className="stat-card">
        <h3>Teuerste Karten</h3>
        {s.top.map((r) => (
          <div key={r.key} className="hbar">
            <span className="hbar-label wide">{r.card.name}</span>
            <span className="hbar-n">{euro(r.price)}</span>
          </div>
        ))}
      </section>
    </div>
  )
}

function Tile({ label, value, hint, sub }) {
  return (
    <div className="tile-stat" title={hint}>
      <span className="muted small">{label}</span>
      <b>{value}{sub && <small className="tile-sub"> {sub}</small>}</b>
      {hint && <span className="muted tiny">{hint}</span>}
    </div>
  )
}
