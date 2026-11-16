import { CameraIcon } from './Icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { lookup, preloadOcr, printingsOf, recognize } from '../scan'
import { euro, unitPrice } from '../util'

const CARD_RATIO = 63 / 88

// Kartenrahmen (Hilfslinie) relativ zum Videobild: 80 % der Höhe, mittig
function frameFor(vw, vh) {
  let h = 0.8, w = (h * vh * CARD_RATIO) / vw
  if (w > 0.9) { w = 0.9; h = (w * vw) / CARD_RATIO / vh }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
}

export default function ScanView({ decks, onAdd, onUndoAdd }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const busyRef = useRef(false)
  const lastNameRef = useRef('')
  const [camState, setCamState] = useState('off') // off | starting | on | error
  const [camError, setCamError] = useState('')
  const [busy, setBusy] = useState(false)
  const [auto, setAuto] = useState(false)
  const [finish, setFinish] = useState('normal')
  const [target, setTarget] = useState('collection')
  const [hit, setHit] = useState(null) // { card, exact, raw }
  const [msg, setMsg] = useState('')
  const [prints, setPrints] = useState(null)
  const [session, setSession] = useState([])

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCamState('off')
  }, [])

  const start = async () => {
    setCamState('starting'); setCamError('')
    preloadOcr()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
      })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setCamState('on')
    } catch (e) {
      setCamError(e.name === 'NotAllowedError' ? 'Kamera-Zugriff wurde nicht erlaubt.' : `Kamera nicht verfügbar (${e.message}).`)
      setCamState('error')
    }
  }

  useEffect(() => stop, [stop])

  const add = useCallback((card, fin = finish) => {
    onAdd(card, fin, target)
    setSession((s) => [{ card, finish: fin, target, at: Date.now() }, ...s].slice(0, 50))
    setMsg(`✓ ${card.name} hinzugefügt`)
  }, [onAdd, finish, target])

  const process = useCallback(async (src, sw, sh, frame, isAuto) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setMsg(isAuto ? '' : 'Erkenne …')
    try {
      const r = await recognize(src, sw, sh, frame)
      if (!r.name || r.name.length < 3) { if (!isAuto) setMsg('Kein Kartenname erkannt – Karte gerade in den Rahmen halten, gutes Licht.'); return }
      if (isAuto && r.name === lastNameRef.current) return
      const found = await lookup(r)
      if (!found) { if (!isAuto) setMsg(`„${r.name}“ nicht gefunden – nochmal versuchen.`); return }
      lastNameRef.current = r.name
      setPrints(null)
      setHit({ ...found, raw: r.name })
      setMsg('')
      if (isAuto) add(found.card)
    } catch (e) {
      setMsg(`Fehler: ${e.message}`)
    } finally {
      busyRef.current = false; setBusy(false)
    }
  }, [add])

  const scanNow = useCallback((isAuto = false) => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    process(v, v.videoWidth, v.videoHeight, frameFor(v.videoWidth, v.videoHeight), isAuto)
  }, [process])

  // Automatik: alle 1,5 s scannen; gleiche Karte wird nicht doppelt gezählt
  useEffect(() => {
    if (!auto || camState !== 'on') return
    const t = setInterval(() => scanNow(true), 1500)
    return () => clearInterval(t)
  }, [auto, camState, scanNow])

  const fromPhoto = async (file) => {
    if (!file) return
    const img = new Image()
    img.src = URL.createObjectURL(file)
    await img.decode()
    // Foto: Karte füllt meist fast das ganze Bild
    process(img, img.naturalWidth, img.naturalHeight, { x: 0.02, y: 0.02, w: 0.96, h: 0.96 }, false)
  }

  // Testhilfe (Entwicklung): Bild-URL direkt erkennen
  useEffect(() => {
    window.__scanTest = async (url) => {
      const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url; await img.decode()
      const r = await recognize(img, img.naturalWidth, img.naturalHeight, { x: 0, y: 0, w: 1, h: 1 })
      const f = await lookup(r)
      return { ocr: r, card: f?.card?.name, set: f?.card?.set, num: f?.card?.num, exact: f?.exact }
    }
    return () => { delete window.__scanTest }
  }, [])

  const showPrints = async () => setPrints(await printingsOf(hit.card))

  const v = videoRef.current
  const frame = v?.videoWidth ? frameFor(v.videoWidth, v.videoHeight) : frameFor(16, 9)
  const targets = Object.values(decks).sort((a, b) => (a.kind === 'binder') - (b.kind === 'binder') || a.name.localeCompare(b.name))
  const sessionCount = session.length

  return (
    <div className="scan">
      <div className="scan-controls">
        {camState !== 'on'
          ? <button className="btn primary" onClick={start} disabled={camState === 'starting'}>{camState === 'starting' ? 'Starte Kamera …' : <><CameraIcon /> Kamera starten</>}</button>
          : <button className="btn" onClick={stop}>Kamera aus</button>}
        <label className="btn file-btn">🖼 Foto wählen
          <input type="file" accept="image/*" capture="environment" onChange={(e) => fromPhoto(e.target.files[0])} />
        </label>
        <div className="seg seg-small">
          <button className={finish === 'normal' ? 'on' : ''} onClick={() => setFinish('normal')}>Normal</button>
          <button className={finish === 'foil' ? 'on' : ''} onClick={() => setFinish('foil')}>Foil</button>
        </div>
        <select value={target} onChange={(e) => setTarget(e.target.value)} title="Wohin sollen gescannte Karten?">
          <option value="collection">→ Sammlung</option>
          {targets.map((d) => <option key={d.id} value={d.id}>→ {d.kind === 'binder' ? '📁 ' : ''}{d.name}</option>)}
        </select>
        <label className="check-line small"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Automatisch hinzufügen</label>
      </div>
      {camError && <p className="error">{camError}</p>}

      <div className={`scan-stage ${camState === 'on' ? 'on' : ''}`}>
        <video ref={videoRef} playsInline muted />
        {camState === 'on' && (
          <div className="scan-frame" style={{ left: `${frame.x * 100}%`, top: `${frame.y * 100}%`, width: `${frame.w * 100}%`, height: `${frame.h * 100}%` }}>
            <div className="scan-name" />
            <div className="scan-info" />
          </div>
        )}
        {camState === 'on' && !auto && (
          <button className="btn primary big scan-btn" onClick={() => scanNow(false)} disabled={busy}>{busy ? 'Erkenne …' : 'Scannen'}</button>
        )}
        {camState !== 'on' && (
          <div className="scan-help">
            <p><b>So geht&apos;s:</b> Kamera starten, Karte in den Rahmen halten – der <b>Name oben</b> muss im oberen Kästchen sein.
              „Scannen“ tippen oder „Automatisch hinzufügen“ einschalten und Karten nacheinander vor die Kamera halten.</p>
            <p className="muted small">Bei neueren Karten liest die App auch Set + Nummer (unten links) und trifft so die genaue Version. Sonst wählst du sie über „Andere Version“.</p>
          </div>
        )}
      </div>

      {msg && <p className={msg.startsWith('✓') ? 'ok-text' : 'muted'}>{msg}</p>}

      {hit && (
        <div className="scan-hit">
          <img src={hit.card.img} alt={hit.card.name} />
          <div className="scan-hit-info">
            <b>{hit.card.name}</b>
            <span className="muted small">{hit.card.setName} ({hit.card.set} #{hit.card.num}) {hit.exact ? '· genaue Version erkannt ✓' : '· Version bitte prüfen'}</span>
            <span>{euro(unitPrice(hit.card, finish))}</span>
            <div className="hand-actions">
              {!auto && <button className="btn primary" onClick={() => add(hit.card)}>+ Hinzufügen</button>}
              <button className="btn" onClick={showPrints}>Andere Version</button>
            </div>
            {prints && (
              <select className="prints" value={hit.card.id} onChange={(e) => setHit({ ...hit, card: prints.find((p) => p.id === e.target.value), exact: true })}>
                {prints.map((p) => <option key={p.id} value={p.id}>{p.setName} ({p.set} #{p.num}) – {euro(p.eur)}</option>)}
              </select>
            )}
            <span className="muted tiny">Erkannt: „{hit.raw}“</span>
          </div>
        </div>
      )}

      {sessionCount > 0 && (
        <section className="stat-card">
          <h3>Diese Sitzung: {sessionCount} Karten</h3>
          {session.map((s) => (
            <div key={s.at} className="hbar">
              <span className="hbar-label wide">{s.card.name} <span className="muted small">{s.card.set}{s.finish === 'foil' ? ' Foil' : ''}</span></span>
              <span className="hbar-n">{euro(unitPrice(s.card, s.finish))}</span>
              <button className="mini" title="Wieder entfernen" onClick={() => { onUndoAdd(s.card, s.finish, s.target); setSession((x) => x.filter((y) => y !== s)) }}>−</button>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
