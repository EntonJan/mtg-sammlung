import { useMemo, useState } from 'react'
import { catsOf, tagKey } from '../categories'
import { groupOf } from '../util'

// Fisher-Yates
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const isLand = (c) => groupOf(c.type) === 'Land'

// Reiter „Probehand“: Starthand ziehen, Mulligan, weiterziehen + Simulation über viele Hände
export default function DeckHand({ deck, rows, commanderKeys, onOpen }) {
  // Bibliothek = alle Karten außer Commander, nach Anzahl aufgefächert
  const library = useMemo(() => {
    const lib = []
    for (const r of rows) {
      if (commanderKeys.has(r.key)) continue
      for (let i = 0; i < r.qty; i++) lib.push({ uid: `${r.key}#${i}`, card: r.card })
    }
    return lib
  }, [rows, commanderKeys])

  const [deckOrder, setDeckOrder] = useState(() => shuffle(library))
  const [drawn, setDrawn] = useState(7)
  const [mulligans, setMulligans] = useState(0)

  const newHand = (mull = 0) => { setDeckOrder(shuffle(library)); setDrawn(7); setMulligans(mull) }
  const hand = deckOrder.slice(0, drawn)
  const lands = hand.filter((x) => isLand(x.card)).length

  if (library.length < 7) return <p className="muted">Für eine Probehand braucht das Deck mindestens 7 Karten (ohne Commander).</p>

  return (
    <div className="hand-wrap">
      <div className="hand-actions">
        <button className="btn primary" onClick={() => newHand(0)}>Neue Hand</button>
        <button className="btn" onClick={() => newHand(mulligans + 1)}>Mulligan</button>
        <button className="btn" disabled={drawn >= deckOrder.length} onClick={() => setDrawn((d) => d + 1)}>Karte ziehen</button>
        <span className="muted">
          {drawn} Karten · {lands} {lands === 1 ? 'Land' : 'Länder'}
          {drawn > 7 && ` · Zug ${drawn - 7}`}
        </span>
      </div>
      {mulligans > 0 && (
        <p className="hint">
          Mulligan {mulligans}: Lege {mulligans === 1 ? 'keine Karte (der erste Mulligan ist im Commander frei)' : `${mulligans - 1} Karte${mulligans > 2 ? 'n' : ''}`} unter die Bibliothek.
        </p>
      )}
      <div className="hand">
        {hand.map((x, i) => (
          <img key={x.uid} src={x.card.img} alt={x.card.name} title={x.card.name}
            className={i >= 7 ? 'drawn' : ''} onClick={() => onOpen(x.card)} />
        ))}
      </div>

      <Simulation library={library} deck={deck} />
    </div>
  )
}

function Simulation({ library, deck }) {
  const [res, setRes] = useState(null)
  const N = 2000

  const run = () => {
    const tags = deck.tags || {}
    const cats = catsOf(deck).map((c) => c.name)
    const landDist = Array(8).fill(0)
    const catOpen = Object.fromEntries(cats.map((c) => [c, 0]))
    const catT3 = Object.fromEntries(cats.map((c) => [c, 0]))
    let goodHands = 0, landsT3ok = 0
    for (let n = 0; n < N; n++) {
      const s = shuffle(library)
      const open = s.slice(0, 7)
      const t3 = s.slice(0, 10) // Commander/Mehrspieler: jeder zieht ab Zug 1 → bis Zug 3 = 10 Karten
      const l = open.filter((x) => isLand(x.card)).length
      landDist[l]++
      if (l >= 2 && l <= 4) goodHands++
      if (t3.filter((x) => isLand(x.card)).length >= 3) landsT3ok++
      for (const c of cats) {
        if (open.some((x) => (tags[tagKey(x.card)] || []).includes(c))) catOpen[c]++
        if (t3.some((x) => (tags[tagKey(x.card)] || []).includes(c))) catT3[c]++
      }
    }
    setRes({ landDist, catOpen, catT3, goodHands, landsT3ok, cats: cats.filter((c) => library.some((x) => (tags[tagKey(x.card)] || []).includes(c))) })
  }

  const pct = (n) => `${Math.round((n / N) * 100)} %`
  const max = res ? Math.max(...res.landDist) : 1

  return (
    <section className="stat-card sim">
      <div className="cat-top">
        <h3>Simulation ({N.toLocaleString('de-DE')} Starthände)</h3>
        <button className="btn small" onClick={run}>{res ? 'Neu berechnen' : 'Berechnen'}</button>
      </div>
      {!res && <p className="muted small">Wie oft hat deine Starthand genug Länder – und wie oft Ramp, Draw usw.?</p>}
      {res && (
        <>
          <div className="stat-tiles">
            <div className="tile-stat"><span className="muted small">Starthand mit 2–4 Ländern</span><b>{pct(res.goodHands)}</b></div>
            <div className="tile-stat"><span className="muted small">3+ Länder bis Zug 3</span><b>{pct(res.landsT3ok)}</b></div>
          </div>
          <h4>Länder in der Starthand</h4>
          <div className="curve small-curve">
            {res.landDist.map((n, i) => (
              <div key={i} className="curve-col">
                <span className="curve-n">{n ? pct(n) : ''}</span>
                <div className={`curve-bar ${i >= 2 && i <= 4 ? 'good' : ''}`} style={{ height: `${(n / max) * 100}%` }} />
                <span className="curve-x">{i}</span>
              </div>
            ))}
          </div>
          {res.cats.length > 0 ? (
            <table className="pip-table">
              <thead><tr><th>Kategorie</th><th>in der Starthand</th><th>bis Zug 3</th></tr></thead>
              <tbody>
                {res.cats.map((c) => (
                  <tr key={c}><td>{c}</td><td>{pct(res.catOpen[c])}</td><td>{pct(res.catT3[c])}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small">Tipp: Ordne im Reiter „Kategorien“ Karten zu, dann siehst du hier z. B. wie oft du früh Ramp hast.</p>
          )}
        </>
      )}
    </section>
  )
}
