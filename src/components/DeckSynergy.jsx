import { useMemo, useState } from 'react'
import { analyzeSynergy, TIER_LIMITS } from '../synergy'
import Info from './Info'

const arrow = (p) => (p.both ? '↔' : p.gets.length ? '←' : '→')
const arrowTitle = (p) => (p.both ? 'beidseitig: beide Karten profitieren voneinander' : p.gets.length ? 'diese Karte profitiert von der anderen' : 'die andere Karte profitiert von dieser')

// Synergien innerhalb des Decks: wer profitiert von wem und warum
export default function DeckSynergy({ commanders, rows, onOpen }) {
  const [theme, setTheme] = useState(null)
  const [showAll, setShowAll] = useState({})
  const [tier, setTier] = useState('all')
  const res = useMemo(() => analyzeSynergy([
    ...commanders.map((r) => ({ key: r.key, card: r.card, qty: r.qty, isCommander: true })),
    ...rows.map((r) => ({ key: r.key, card: r.card, qty: r.qty, isCommander: false })),
  ]), [commanders, rows])
  const byKey = useMemo(() => Object.fromEntries(res.cards.map((c) => [c.key, c])), [res])

  if (!rows.length) return <p className="muted">Das Deck ist noch leer.</p>
  const byTheme = theme
    ? res.cards.filter((c) => c.partners.some((p) => p.gets.includes(theme) || p.gives.includes(theme)))
    : res.cards.filter((c) => c.partners.length || (tier === 'schwach' && !/\bLand\b/.test(c.card.type || '')))
  const shown = tier === 'all' ? byTheme : byTheme.filter((c) => c.tier === tier && !/\bLand\b/.test((c.card.type || '').split(' // ')[0]))

  return (
    <div className="synergy">
      <div className="syn-stats">
        <div className="stat-tile">
          <span>Deck-Synergie <Info>Wie gut die Karten untereinander harmonieren – <b>ohne</b> den Commander. Jede Verbindung zu einer anderen Deckkarte bringt 1 Punkt, eine hohe Synergie (2+ verbundene Teileffekte) 2 Punkte. Unter {TIER_LIMITS.gut} Punkten ist eine Karte schwach, {TIER_LIMITS.gut}–{TIER_LIMITS.stark - 1} gut, ab {TIER_LIMITS.stark} stark vernetzt. Der Wert: stark zählt voll, gut halb, schwach gar nicht. Länder zählen nicht mit.</Info></span>
          <b>{Math.round(res.deckScore * 100)} %</b>
          <small>{res.tiers.stark} stark · {res.tiers.gut} gut · {res.tiers.schwach} schwach</small>
        </div>
        <div className="stat-tile">
          <span>Commander-Synergie <Info>Wie gut der Commander in dieses Deck passt: Anteil der Nicht-Länder, die mit dem Commander verbunden sind. Hohe Synergie zählt voll, normale halb. Ein Commander, der wenig mit dem Deck zu tun hat, landet hier niedrig – auch wenn das Deck selbst gut harmoniert.</Info></span>
          <b>{Math.round(res.cmdScore * 100)} %</b>
          <small>{res.cmdLinked} von {res.pool} Karten verbunden · {res.cmdHigh} hoch</small>
        </div>
        <div className="stat-tile"><span>Hohe Synergie</span><b>{res.high}</b><small>Paare mit 2+ verbundenen Teileffekten</small></div>
        <div className="stat-tile"><span>Einzelgänger</span><b>{res.loners.length}</b><small>ohne erkannte Verbindung</small></div>
        <Info>
          Die App liest den englischen Regeltext jeder Karte: <b>Bedingungen</b> wie „whenever you cast a noncreature spell with mana value 3 or greater“, „whenever an Equipment enters“ oder „Elves you control get +1/+1“ verbinden die Karte mit allen passenden Karten im Deck.
          <b> Ereignisse</b> wie „whenever you draw“ verbinden sie mit Karten, die dieses Ereignis auslösen („draw a card“).
          Jede Karte wird in ihre <b>Teileffekte</b> zerlegt (Y’shtola z.B.: Nicht-Kreatur-Zauber ab Manawert 3, Gegner verlieren Leben, Karten ziehen, Leben gewinnen).
          Verbinden zwei Karten 2 oder mehr Teileffekte – egal in welche Richtung –, ist das <b>hohe Synergie</b> (2 Punkte), sonst normale (1 Punkt). Partner sind danach sortiert, die stärksten stehen vorne.
          Erkannt wird viel, aber nicht alles – ungewöhnliche Einzel-Interaktionen können fehlen.
        </Info>
      </div>

      <div className="syn-tiers">
        {[['all', 'Alle'], ['stark', `Stark vernetzt (${res.tiers.stark})`], ['gut', `Gut vernetzt (${res.tiers.gut})`], ['schwach', `Schwach vernetzt (${res.tiers.schwach})`]].map(([k, l]) => (
          <button key={k} className={`syn-tier-btn ${k} ${tier === k ? 'on' : ''}`} onClick={() => setTier(k)}>{l}</button>
        ))}
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
                  {c.high > 0 && <span className="syn-highcount" title="Partner mit 2 oder mehr verbundenen Teileffekten">{c.high}× hohe Synergie</span>}
                  {c.isCommander
                    ? <span className="syn-tier cmd" title="Deckkarten, die mit dem Commander verbunden sind">verbunden mit {res.commanders.find((x) => x.key === c.key)?.linked || 0} Karten</span>
                    : <>
                      {c.cmdPoints > 0 && <span className="syn-cmdpts" title="Punkte aus Verbindungen zum Commander (zählen nicht zur Deck-Synergie)">+{c.cmdPoints} Commander</span>}
                      {!/\bLand\b/.test((c.card.type || '').split(' // ')[0]) && <span className={`syn-tier ${c.tier}`}>{c.tier} vernetzt</span>}
                    </>}
                  <span className="syn-score" title={c.isCommander ? 'Punkte aus allen Verbindungen' : 'Deck-Punkte: normale Synergie 1, hohe Synergie 2 – ohne Commander'}>{c.isCommander ? c.score : c.deckPoints} P</span>
                </div>
                {c.facets.length > 0 && (
                  <div className="syn-facets">
                    {c.facets.map((f) => (
                      <span key={f.dir + f.label} className={`syn-facet ${f.dir}`} title={f.dir === 'gets' ? 'Teileffekt: diese Karte reagiert darauf' : 'Teileffekt: diese Karte liefert das'}>
                        {f.dir === 'gets' ? 'braucht' : 'liefert'}: {f.label} <b>{f.count}</b>
                      </span>
                    ))}
                  </div>
                )}
                <div className="syn-partners">
                  {(all ? parts : parts.slice(0, 8)).map((p) => (
                    <span key={p.key} className={`syn-chip ${p.both ? 'both' : ''} ${p.high ? 'high' : ''}`} title={`${arrowTitle(p)} · ${p.weight} verbundene Teileffekte · ${p.points} Punkt${p.points > 1 ? 'e' : ''}`}>
                      {p.high && <em className="syn-w">hoch</em>}
                      <i>{arrow(p)}</i> {byKey[p.key]?.card.name}
                      <span className="muted small"> · {[...p.gets.map((r) => '← ' + r), ...p.gives.map((r) => '→ ' + r)].join(' · ')}</span>
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
