import { useState } from 'react'
import { parseManaBox } from '../csv'
import DeckImport from './DeckImport'

// ManaBox-CSV importieren: Sammlung ersetzen (Abgleich) oder hinzufügen
export default function ImportView({ entries, decks, onImport, onImportDeck }) {
  const hasDecks = Object.keys(decks).length > 0
  const [parsed, setParsed] = useState(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [mode, setMode] = useState('replace')
  const [busy, setBusy] = useState(false)
  const [subtract, setSubtract] = useState(true)

  const current = Object.values(entries).reduce((s, e) => s + e.qty, 0)

  async function onFile(file) {
    setError('')
    setParsed(null)
    if (!file) return
    setFileName(file.name)
    try {
      setParsed(parseManaBox(await file.text()))
    } catch (e) {
      setError(e.message)
    }
  }

  async function run() {
    setBusy(true)
    try {
      await onImport(parsed.entries, mode, subtract)
      setParsed(null)
      setFileName('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="import">
      <h2>ManaBox-Import</h2>
      <p className="muted">
        In ManaBox: Sammlung → Teilen/Exportieren → CSV. Die Datei hier auswählen.
      </p>
      <label className="file">
        <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files[0])} />
        <span className="btn primary">CSV-Datei wählen</span>
        <span className="muted">{fileName}</span>
      </label>

      {error && <p className="error">{error}</p>}

      {parsed && (
        <div className="import-box">
          <p>
            Gefunden: <b>{parsed.cards.toLocaleString('de-DE')}</b> Karten in{' '}
            <b>{Object.keys(parsed.entries).length.toLocaleString('de-DE')}</b> Versionen.
            Aktuell in der App: <b>{current.toLocaleString('de-DE')}</b> Karten.
          </p>
          <label className="radio">
            <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />
            <span><b>Sammlung ersetzen</b> – die App übernimmt genau den Stand aus ManaBox (empfohlen, wenn du in ManaBox scannst).</span>
          </label>
          <label className="radio">
            <input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} />
            <span><b>Hinzufügen</b> – Anzahlen werden zur bestehenden Sammlung addiert (z. B. für einen Export nur neuer Karten).</span>
          </label>
          {mode === 'replace' && hasDecks && (
            <label className="check-line">
              <input type="checkbox" checked={subtract} onChange={(e) => setSubtract(e.target.checked)} />
              <span>Karten, die schon in Decks liegen, abziehen (sonst wären sie doppelt, falls du sie in ManaBox nicht ausgebucht hast)</span>
            </label>
          )}
          <button className="btn primary" disabled={busy} onClick={run}>
            {busy ? 'Importiere …' : 'Import starten'}
          </button>
        </div>
      )}
      <DeckImport decks={decks} onImportDeck={onImportDeck} />
    </div>
  )
}
