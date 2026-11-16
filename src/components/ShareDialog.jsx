import { useState } from 'react'
import { shareUrl } from '../share'

// Teilen-Fenster: Link erstellen, kopieren, weitergeben oder deaktivieren
export default function ShareDialog({ title, shareId, onCreate, onDelete, onClose }) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const url = shareId ? shareUrl(shareId) : ''
  const act = async (fn) => { setBusy(true); setError(''); try { await fn() } catch (e) { console.error(e); setError('Das hat nicht geklappt – evtl. fehlen noch die Freigabe-Regeln in Firebase.') } finally { setBusy(false) } }
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* egal */ } }
  const native = async () => { try { await navigator.share({ title, url }) } catch { /* abgebrochen */ } }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Schließen">×</button>
        <h2>„{title}“ teilen</h2>
        {!shareId ? <>
          <p className="muted">Erstellt einen Link, über den jeder – auch ohne Konto – eine <b>Nur-Lesen-Ansicht</b> sieht. Änderungen werden automatisch übernommen. Du kannst den Link jederzeit wieder deaktivieren.</p>
          <button className="btn primary" disabled={busy} onClick={() => act(onCreate)}>{busy ? 'Erstelle …' : 'Link erstellen'}</button>
        </> : <>
          <p className="muted">Jeder mit diesem Link sieht eine Nur-Lesen-Ansicht. Änderungen werden automatisch übernommen.</p>
          <div className="share-link">
            <input readOnly value={url} onFocus={(e) => e.target.select()} />
            <button className="btn primary" onClick={copy}>{copied ? 'Kopiert ✓' : 'Kopieren'}</button>
            {navigator.share && <button className="btn" onClick={native}>Senden …</button>}
          </div>
          <p><a href={url} target="_blank" rel="noreferrer">Ansicht öffnen ↗</a></p>
          <button className="btn small danger" disabled={busy} onClick={() => act(onDelete)}>Link deaktivieren</button>
        </>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}
