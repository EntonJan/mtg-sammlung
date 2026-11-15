import { useMemo, useState } from 'react'
import { parseDecklist } from '../decklist'
import { resolveDeckLines } from '../scryfall'
import { euro } from '../util'

// „Was fehlt mir?“ – fremde Deckliste gegen Sammlung und Decks abgleichen
export default function MatchView({ entries, decks, cards, onCreateDeck }) {
  const [text, setText] = useState('')
  const [deckName, setDeckName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  const lines = useMemo(() => parseDecklist(text), [text])

  // Index: oracleId → freie Einträge / Deck-Vorkommen
  const index = useMemo(() => {
    const free = {}, inDecks = {}
    for (const e of Object.values(entries)) {
      const c = cards[e.id]; if (!c) continue
      ;(free[c.oracleId] ||= []).push(e)
    }
    for (const d of Object.values(decks)) {
      for (const e of Object.values(d.entries)) {
        const c = cards[e.id]; if (!c) continue
        ;(inDecks[c.oracleId] ||= []).push({ deck: d, qty: e.qty })
      }
    }
    return { free, inDecks }
  }, [entries, decks, cards])

  async function run() {
    setBusy(true); setError(''); setResult(null)
    try {
      const { ok, missing } = await resolveDeckLines(lines.map((l) => ({ ...l })))
      // gleiche Karte mehrfach in der Liste zusammenfassen
      const byOracle = new Map()
      for (const l of ok) {
        const k = l.card.oracleId
        const prev = byOracle.get(k)
        if (prev) prev.need += l.qty
        else byOracle.set(k, { card: l.card, need: l.qty, commander: l.commander })
      }
      const rows = [...byOracle.values()].map((r) => {
        const freeList = index.free[r.card.oracleId] || []
        const free = freeList.reduce((s, e) => s + e.qty, 0)
        const elsewhere = index.inDecks[r.card.oracleId] || []
        const fromFree = Math.min(free, r.need)
        const missingQty = r.need - fromFree
        return { ...r, free, freeList, elsewhere, fromFree, missingQty }
      }).sort((a, b) => (b.missingQty > 0) - (a.missingQty > 0) || a.card.name.localeCompare(b.card.name))
      setResult({ rows, notFound: missing })
      setDeckName(lines.find((l) => l.commander)?.name || '')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const sum = result && {
    need: result.rows.reduce((s, r) => s + r.need, 0),
    have: result.rows.reduce((s, r) => s + r.fromFree, 0),
    missing: result.rows.reduce((s, r) => s + r.missingQty, 0),
    cost: result.rows.reduce((s, r) => s + r.missingQty * (r.card.eur ?? r.card.eurFoil ?? 0), 0),
    elsewhere: result.rows.filter((r) => r.missingQty > 0 && r.elsewhere.length).length,
  }

  const missingText = result ? result.rows.filter((r) => r.missingQty > 0).map((r) => `${r.missingQty} ${r.card.name}`).join('\n') : ''
  const copy = async () => {
    try { await navigator.clipboard.writeText(missingText); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* egal */ }
  }

  const create = () => {
    // Vorhandene freie Exemplare auswählen (bevorzugt nicht-Foil, günstigste Version)
    const picks = []
    const commanders = []
    for (const r of result.rows) {
      let left = r.fromFree
      const sorted = [...r.freeList].sort((a, b) => (a.finish !== 'normal') - (b.finish !== 'normal') || (cards[a.id].eur ?? 0) - (cards[b.id].eur ?? 0))
      for (const e of sorted) {
        if (!left) break
        const q = Math.min(left, e.qty)
        picks.push({ id: e.id, finish: e.finish, qty: q })
        if (r.commander) commanders.push(`${e.id}|${e.finish}`)
        left -= q
      }
    }
    onCreateDeck(deckName.trim() || 'Neues Deck', picks, commanders)
  }

  return (
    <div className="import match">
      <h2>Was fehlt mir?</h2>
      <p className="muted">
        Füge eine Deckliste ein (z. B. von EDHREC, Moxfield oder Archidekt). Die App prüft, was du frei in der Sammlung
        hast, was in anderen Decks steckt und was dir fehlt – inklusive Preis.
      </p>
      <textarea className="mono-area" rows={10} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={'1 Sol Ring\n1 Arcane Signet\n1 Cultivate\n…'} />
      <div className="hand-actions">
        <button className="btn primary" disabled={busy || !lines.length} onClick={run}>
          {busy ? 'Prüfe …' : `Abgleichen (${lines.reduce((s, l) => s + l.qty, 0)} Karten)`}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {result && (
        <>
          <div className="stat-tiles">
            <div className="tile-stat"><span className="muted small">Frei vorhanden</span><b className="ok-text">{sum.have} / {sum.need}</b></div>
            <div className="tile-stat"><span className="muted small">Fehlen</span><b>{sum.missing}</b></div>
            <div className="tile-stat"><span className="muted small">davon in anderen Decks</span><b>{sum.elsewhere}</b></div>
            <div className="tile-stat"><span className="muted small">Kosten fehlender Karten</span><b>{euro(sum.cost)}</b></div>
          </div>

          <div className="match-actions">
            <input placeholder="Name für das neue Deck" value={deckName} onChange={(e) => setDeckName(e.target.value)} />
            <button className="btn primary" disabled={!sum.have} onClick={create}>
              Deck aus {sum.have} vorhandenen Karten anlegen
            </button>
            <button className="btn" disabled={!sum.missing} onClick={copy}>{copied ? 'Kopiert ✓' : 'Fehlende Karten kopieren'}</button>
          </div>

          <table className="match-table">
            <thead><tr><th>Karte</th><th>Bedarf</th><th>Frei</th><th>In Decks</th><th>Fehlt</th><th>Preis</th></tr></thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.card.oracleId} className={r.missingQty ? (r.elsewhere.length ? 'elsewhere' : 'missing') : 'have'}>
                  <td>{r.card.name}{r.commander && <span className="chip">Commander</span>}</td>
                  <td>{r.need}</td>
                  <td>{r.free}</td>
                  <td className="small">{r.elsewhere.map((x) => `${x.deck.name} (${x.qty})`).join(', ')}</td>
                  <td>{r.missingQty || ''}</td>
                  <td>{r.missingQty ? euro(r.card.eur ?? r.card.eurFoil) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.notFound.length > 0 && (
            <div className="warn">Nicht gefunden: {result.notFound.map((l) => l.name).join(', ')}</div>
          )}
        </>
      )}
    </div>
  )
}
