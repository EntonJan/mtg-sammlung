import { useState } from 'react'
import { searchCards } from '../scryfall'
import { FINISH_LABEL, euro, unitPrice, wishAlarm } from '../util'


// Wunschliste mit Zielpreis („Preisalarm“)
export default function WishlistView({ wishlist, setWishlist, cards, ownedOracles, onOpen, onShare }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const search = async (e) => {
    e.preventDefault()
    if (!q.trim()) return
    setBusy(true)
    try { setResults(await searchCards(q.trim())) } finally { setBusy(false) }
  }

  const add = (card, finish) => {
    if (wishlist.some((w) => w.id === card.id && w.finish === finish)) return
    const price = unitPrice(card, finish)
    setWishlist([...wishlist, { id: card.id, finish, target: price != null ? Math.floor(price * 0.8 * 2) / 2 : '', added: new Date().toLocaleDateString('sv-SE') }], [card])
  }
  const update = (i, patch) => setWishlist(wishlist.map((w, j) => (j === i ? { ...w, ...patch } : w)))
  const remove = (i) => setWishlist(wishlist.filter((_, j) => j !== i))

  const items = wishlist.map((w, i) => ({ w, i, c: cards[w.id] })).filter((x) => x.c)
  const alarms = items.filter((x) => wishAlarm(x.w, cards))
  const total = items.reduce((s, x) => s + (unitPrice(x.c, x.w.finish) ?? 0), 0)

  const copy = async () => {
    const text = items.map((x) => `1 ${x.c.name} (${x.c.set}) ${x.c.num}${x.w.finish !== 'normal' ? ' *F*' : ''}`).join('\n')
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* egal */ }
  }

  return (
    <div className="import wish">
      <h2>Wunschliste {onShare && <button className="btn small share-btn" onClick={onShare}>Teilen</button>}</h2>
      <div className="stat-tiles">
        <div className="tile-stat"><span className="muted small">Karten</span><b>{items.length}</b></div>
        <div className="tile-stat"><span className="muted small">Aktueller Preis gesamt</span><b>{euro(total)}</b></div>
        <div className="tile-stat"><span className="muted small">Unter Zielpreis 🔔</span><b className={alarms.length ? 'ok-text' : ''}>{alarms.length}</b></div>
      </div>

      <form className="toolbar" style={{ padding: 0 }} onSubmit={search}>
        <input className="search" placeholder="Karte suchen und auf die Wunschliste setzen …" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" type="submit">{busy ? 'Suche …' : 'Suchen'}</button>
        {items.length > 0 && <button className="btn" type="button" onClick={copy}>{copied ? 'Kopiert ✓' : 'Liste kopieren'}</button>}
      </form>

      {results.length > 0 && (
        <div className="wish-results">
          {results.slice(0, 24).map((c) => (
            <div key={c.id} className="wish-result">
              <img src={c.thumb} alt="" loading="lazy" onClick={() => onOpen(c)} />
              <div>
                <b>{c.name}</b>
                <span className="muted small">{c.set} #{c.num}</span>
                <span className="wish-buttons">
                  <button className="btn small" onClick={() => add(c, 'normal')}>☆ {euro(c.eur)}</button>
                  {c.eurFoil != null && <button className="btn small" onClick={() => add(c, 'foil')}>☆ Foil {euro(c.eurFoil)}</button>}
                </span>
              </div>
            </div>
          ))}
          <button className="btn ghost small" onClick={() => setResults([])}>Suchergebnisse schließen</button>
        </div>
      )}

      {items.length > 0 ? (
        <table className="match-table">
          <thead><tr><th>Karte</th><th>Preis jetzt</th><th>Zielpreis €</th><th></th><th></th></tr></thead>
          <tbody>
            {items.sort((a, b) => wishAlarm(b.w, cards) - wishAlarm(a.w, cards)).map(({ w, i, c }) => {
              const alarm = wishAlarm(w, cards)
              return (
                <tr key={`${w.id}|${w.finish}`} className={alarm ? 'have' : ''}>
                  <td onClick={() => onOpen(c)} style={{ cursor: 'pointer' }}>
                    {c.name} <span className="muted small">{c.set}{w.finish !== 'normal' ? ` ${FINISH_LABEL[w.finish]}` : ''}</span>
                    {ownedOracles.has(c.oracleId) && <span className="chip">schon im Besitz</span>}
                  </td>
                  <td>{euro(unitPrice(c, w.finish))}</td>
                  <td><input type="number" min="0" step="0.5" className="cat-target" value={w.target} onChange={(e) => update(i, { target: e.target.value })} /></td>
                  <td>{alarm ? <span className="ok-text">🔔 Zielpreis erreicht</span> : ''}</td>
                  <td><button className="mini" title="Entfernen" onClick={() => remove(i)}>×</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <p className="muted">Noch leer. Suche oben nach Karten oder setze sie über „Was fehlt mir?“ auf die Liste. Der Zielpreis wird mit 80 % des aktuellen Preises vorbelegt.</p>
      )}
      <p className="muted small">Preise werden einmal täglich beim Öffnen der App aktualisiert. Ist eine Karte unter deinem Zielpreis, erscheint oben in der Leiste ein 🔔.</p>
    </div>
  )
}
