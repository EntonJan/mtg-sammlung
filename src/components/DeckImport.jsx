import { useMemo, useState } from 'react'
import { parseDecklist } from '../decklist'

// Bestehende physische Decks importieren: Karten werden NEU angelegt und liegen direkt im Deck
// (zählen also zur Sammlung insgesamt, sind aber nicht „frei“). Entfernt man sie aus dem Deck,
// landen sie wie gewohnt in der Sammlung.
export default function DeckImport({ decks, onImportDeck }) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const lines = useMemo(() => parseDecklist(text), [text])
  const count = lines.reduce((s, l) => s + l.qty, 0)
  const cmd = lines.filter((l) => l.commander).map((l) => l.name)

  async function run() {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const res = await onImportDeck(target || null, name.trim() || cmd[0] || 'Importiertes Deck', lines)
      if (res.deckId) setTarget(res.deckId)
      setResult(res)
      setText(res.missing.map((l) => l.raw).join('\n'))
      setName('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="import-box">
      <h2>Bestehendes Deck importieren</h2>
      <p className="muted small">
        Für Decks, die nicht in ManaBox erfasst sind. Die Karten kommen zusätzlich in deinen Bestand und liegen direkt
        im Deck. Nimmst du sie später heraus, landen sie in der Sammlung.
        Einfach die Deckliste einfügen – z. B. aus Archidekt/Moxfield „Export → Text“:
        <code> 1 Sol Ring</code>, <code>1x Sol Ring (C21) 263</code>, <code>1 Atraxa, Praetors&apos; Voice *CMDR*</code>.
      </p>
      <div className="deck-target">
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Neues Deck anlegen</option>
          {Object.values(decks).sort((a, b) => a.name.localeCompare(b.name)).map((d) => (
            <option key={d.id} value={d.id}>Zu „{d.name}“ hinzufügen</option>
          ))}
        </select>
        {!target && <input placeholder="Deckname (sonst Name des Commanders)" value={name} onChange={(e) => setName(e.target.value)} />}
      </div>
      <textarea
        rows={12}
        placeholder={'Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring\n1x Command Tower (CMM) 410\n…'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {lines.length > 0 && (
        <p className="small">
          Erkannt: <b>{count}</b> Karten in <b>{lines.length}</b> Zeilen
          {cmd.length > 0 && <> · Commander: <b>{cmd.join(', ')}</b></>}
          {!target && count !== 100 && <span className="muted"> (Commander-Decks haben 100 Karten)</span>}
        </p>
      )}
      <button className="btn primary" disabled={busy || !lines.length} onClick={run}>
        {busy ? 'Importiere …' : target ? 'Karten ins Deck importieren' : 'Deck anlegen'}
      </button>
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="small">
          <p className="ok-text">✓ {result.added} Karten in „{result.name}“ importiert.</p>
          {result.missing.length > 0 && (
            <div className="warn">
              Nicht gefunden ({result.missing.length}) – Schreibweise korrigieren und nur diese Zeilen nochmal importieren
              (das Deck ist oben schon ausgewählt):
              <ul>{result.missing.map((l) => <li key={l.raw}>{l.raw}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
