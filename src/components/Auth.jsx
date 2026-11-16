import { useState } from 'react'
import {
  EmailAuthProvider, GoogleAuthProvider, linkWithCredential, reauthenticateWithPopup, sendPasswordResetEmail,
  signInWithCredential, signInWithEmailAndPassword, signInWithPopup, updatePassword,
} from 'firebase/auth'
import { auth, googleProvider } from '../firebase'
import { isNativeApp } from '../util'

// In der Android-App (Capacitor-WebView) blockt Google den Login per Popup →
// dort läuft die Google-Anmeldung nativ über Android und wird an Firebase (Web) übergeben.
async function googleSignIn() {
  if (!isNativeApp()) return signInWithPopup(auth, googleProvider)
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
  const res = await FirebaseAuthentication.signInWithGoogle()
  const token = res.credential?.idToken
  if (!token) throw new Error('Google-Anmeldung abgebrochen.')
  return signInWithCredential(auth, GoogleAuthProvider.credential(token, res.credential?.accessToken))
}

const MSG = {
  'auth/invalid-credential': 'E-Mail oder Passwort falsch.',
  'auth/wrong-password': 'E-Mail oder Passwort falsch.',
  'auth/user-not-found': 'Kein Konto mit dieser E-Mail.',
  'auth/too-many-requests': 'Zu viele Versuche – bitte kurz warten.',
  'auth/weak-password': 'Das Passwort muss mindestens 6 Zeichen haben.',
  'auth/invalid-email': 'Ungültige E-Mail-Adresse.',
}
const msg = (e) => MSG[e.code] || e.message

export function Login() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try { await signInWithEmailAndPassword(auth, email.trim(), pw) } catch (x) { setErr(msg(x)) } finally { setBusy(false) }
  }
  const reset = async () => {
    setErr('')
    if (!email.trim()) { setErr('Bitte zuerst die E-Mail eingeben.'); return }
    try { await sendPasswordResetEmail(auth, email.trim()); setInfo('E-Mail zum Zurücksetzen ist unterwegs.') } catch (x) { setErr(msg(x)) }
  }

  return (
    <div className="center login">
      <h1>MTG Sammlung</h1>
      <p className="muted">Deine Karten. Deine Decks. Ohne Ruckeln.</p>
      <button className="btn primary big" onClick={() => { setErr(''); googleSignIn().catch((x) => setErr(msg(x))) }}>
        Mit Google anmelden
      </button>
      <form className="login-form" onSubmit={submit}>
        <span className="muted small">oder mit E-Mail und App-Passwort</span>
        <input type="email" autoComplete="username" placeholder="E-Mail (dein Google-Konto)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" autoComplete="current-password" placeholder="Passwort" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn" disabled={busy}>{busy ? 'Anmelden …' : 'Anmelden'}</button>
        <button type="button" className="btn ghost small" onClick={reset}>Passwort vergessen?</button>
      </form>
      {err && <p className="error">{err}</p>}
      {info && <p className="ok-text">{info}</p>}
    </div>
  )
}

// Einstellungen: App-Passwort festlegen/ändern (verknüpft E-Mail+Passwort mit dem Google-Konto)
export function Settings({ user, onClose }) {
  const hasPw = user.providerData.some((p) => p.providerId === 'password')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    setErr(''); setOk('')
    if (pw.length < 6) { setErr('Mindestens 6 Zeichen.'); return }
    if (pw !== pw2) { setErr('Die Passwörter stimmen nicht überein.'); return }
    setBusy(true)
    const run = () => (hasPw ? updatePassword(user, pw) : linkWithCredential(user, EmailAuthProvider.credential(user.email, pw)))
    try {
      try { await run() } catch (x) {
        if (x.code !== 'auth/requires-recent-login') throw x
        await reauthenticateWithPopup(user, googleProvider)
        await run()
      }
      setOk('Gespeichert. In der Android-App meldest du dich jetzt mit deiner E-Mail und diesem Passwort an.')
      setPw(''); setPw2('')
    } catch (x) { setErr(msg(x)) } finally { setBusy(false) }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Schließen">×</button>
        <div className="detail-info">
          <h2>Einstellungen</h2>
          <p className="muted small">Angemeldet als {user.email}</p>

          <h3>Android-App</h3>
          <p className="small">
            Die App gibt es als APK zum direkten Installieren:{' '}
            <a href="https://github.com/EntonJan/mtg-sammlung/releases/download/android-latest/mtg-sammlung.apk" target="_blank" rel="noreferrer">APK laden</a>.
            Anmelden geht dort ebenfalls mit Google; ein App-Passwort brauchst du nur, wenn du lieber E-Mail + Passwort nutzt.
            <br /><a href="https://entonjan.github.io/mtg-sammlung/willkommen.html" target="_blank" rel="noreferrer">Willkommensseite – alles, was die App kann ↗</a> (gut zum Weiterschicken)
          </p>
          {!isNativeApp() && (
            <form className="login-form left" onSubmit={save}>
              <b className="small">{hasPw ? 'App-Passwort ändern' : 'App-Passwort festlegen'}</b>
              <input type="password" autoComplete="new-password" placeholder="Neues Passwort" value={pw} onChange={(e) => setPw(e.target.value)} />
              <input type="password" autoComplete="new-password" placeholder="Passwort wiederholen" value={pw2} onChange={(e) => setPw2(e.target.value)} />
              <button className="btn primary" disabled={busy}>{busy ? 'Speichere …' : 'Speichern'}</button>
              {err && <p className="error">{err}</p>}
              {ok && <p className="ok-text">{ok}</p>}
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
