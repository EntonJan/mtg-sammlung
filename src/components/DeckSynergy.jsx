import { useMemo, useState } from 'react'
import { analyzeSynergy } from '../synergy'
import Info from './Info'

const arrow = (p) => (p.both ? '↔' : p.gets.length ? '←' : '→')
const arrowTitle = (p) => (p.both ? 'beidseitig: beide Karten profitieren voneinander' : p.gets.length ? 'diese Karte profitiert von der anderen' : 'die andere Karte profitiert von dieser')

// Synergien innerhalb des Decks: wer profitiert von wem und warum
export default function DeckSynergy({ commanders, rows, onOpen }) {
  const [theme, setTheme] = useState(null)
  const [showAll, setShowAll] = useState({})
  const res = useMemo(() => analyzeSynergy([
    ...commanders.map((r) => ({ key: r.key, card: r.card, qty: r.qty, isCommander: true })),
    ...rows.map((r) => ({ key: r.key, card: r.card, qty: r.qty, isCommander: false })),
  ]), [commanders, rows])
  const byKey = useMemo(() => Object.fromEntries(res.cards.map((c) => [c.key, c])), [res])

  if (!rows.length) return <p className="muted">Das Deck ist noch leer.</p>
  const shown = theme
    ? res.cards.filter((c) => c.partners.some((p) => p.gets.includes(theme) || p.gives.includes(theme)))
    : res.cards.filter((c) => c.partners.length)

  return (
    <div className="synergy">
      <div className="syn-stats">
        <div className="stat-tile"><span>Vernetzt</span><b>{Math.round(res.share * 100)} %</b><small>der Nicht-Länder haben mind. einen Partner</small></div>
        <div className="stat-tile"><span>Beidseitige Paare</span><b>{res.mutual}</b><small>beide profitieren voneinander</small></div>
        <div className="stat-tile"><span>Einzelgänger</span><b>{res.loners.length}</b><small>ohne erkannte Verbindung</small></div>
        <Info>
          Die App liest den englischen Regeltext jeder Karte: <b>Bedingungen</b> wie „whenever you cast a noncreature spell with mana value 3 or greater“, „whenever an Equipment enters“ oder „Elves you control get +1/+1“ verbinden die Karte mit allen passenden Karten im Deck.
          <b> Ereignisse</b> wie „whenever you draw“ verbinden sie mit Karten, die dieses Ereignis auslösen („draw a card“). Geht es in beide Richtungen, ist die Verbindung beidseitig (↔) und zählt doppelt.
          Erkannt wird viel, aber nicht alles – ungewöhnliche Einzel-Interaktionen können fehlen.
        </Info>
      </div>

      {res.themes.length > 0 && (
        <section>
          <h3 className="combo-sec">Themen im Deck <span className="muted small">– antippen zum Filtern</span></h3>
          <div className="syn-themes">
            {res.themes.slice(0, 16).map((t) => (
              <button key={t.label} className={`syn-theme ${theme === t.label ? 'on' : ''}`} onClick={() => setTheme(theme === t.label ? null : t.label)}>
                <b>{t.label}</b>
                <span className="muted small">{t.payoffs.length} profitiert · {t.sources.length} liefert</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="combo-sec">{theme ? `Karten zum Thema „${theme}“` : 'Verbindungen je Karte'} <span className="muted">({shown.length})</span></h3>
        {shown.map((c) => {
          const parts = theme ? c.partners.filter((p) => p.gets.includes(theme) || p.gives.includes(theme)) : c.partners
          const all = showAll[c.key]
          return (
            <div key={c.key} className={`syn-row ${c.isCommander ? 'cmd' : ''}`}>
              <img src={c.card.thumb || c.card.img} alt="" onClick={() => onOpen(c.card)} />
              <div className="syn-main">
                <div className="syn-name">
                  <b onClick={() => onOpen(c.card)}>{c.card.name}</b>
                  {c.isCommander && <span className="chip">Commander</span>}
                  <span className="syn-score" title="Summe der Verbindungen (beidseitig zählt doppelt)">{c.score}</span>
                </div>
                <div className="syn-partners">
                  {(all ? parts : parts.slice(0, 8)).map((p) => (
                    <span key={p.key} className={`syn-chip ${p.both ? 'both' : ''}`} title={arrowTitle(p)}>
                      <i>{arrow(p)}</i> {byKey[p.key]?.card.name}
                      <span className="muted small"> · {[...new Set([...p.gets, ...p.gives])].join(', ')}</span>
                    </span>
                  ))}
                  {!all && parts.length > 8 && <button className="linklike small" onClick={() => setShowAll((s) => ({ ...s, [c.key]: true }))}>+{parts.length - 8} weitere</button>}
                </div>
              </div>
            </div>
          )
        })}
      </section>

      {!theme && res.loners.length > 0 && (
        <section>
          <h3 className="combo-sec">Einzelgänger <span className="muted">({res.loners.length})</span> <Info>Karten ohne erkannte Verbindung zum Rest des Decks. Oft sind das Allrounder (Removal, Ramp), die trotzdem ihren Platz verdienen – aber wenn du Platz brauchst, schau hier zuerst.</Info></h3>
          <div className="syn-loners">
            {res.loners.map((c) => <span key={c.key} className="chip" onClick={() => onOpen(c.card)}>{c.card.name}</span>)}
          </div>
        </section>
      )}
    </div>
  )
}
