import { useEffect, useMemo, useState } from 'react'
import { NAME_RE, acceptRequest, claimName, findUser, loadProfile, removeFriend, saveProfileShares, sendRequest, watchFriends } from '../friends'
import { loadShare } from '../share'
import { euro } from '../util'
import SharedView from './SharedView'

// Freunde: Benutzername, Freigaben, Anfragen, Tausch-Abgleich
export default function FriendsView({ uid, decks, entries, cards, wishlist, shareMeta, friendsCfg, setFriendsCfg, ensureShare, onCount }) {
  const [profile, setProfile] = useState(undefined)
  const [list, setList] = useState({})
  const [name, setName] = useState('')
  const [add, setAdd] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState(null)

  useEffect(() => { loadProfile(uid).then(setProfile).catch(() => setProfile(null)) }, [uid])
  useEffect(() => watchFriends(uid, setList), [uid])
  useEffect(() => { onCount?.(Object.values(list).filter((f) => f.status === 'in').length) }, [list, onCount])

  // Freigaben im Profil aktuell halten (welche Teilen-Links Freunde sehen dürfen)
  const binders = useMemo(() => Object.values(decks).filter((d) => d.kind === 'binder'), [decks])
  const wanted = useMemo(() => ({
    wishlist: friendsCfg.wishlist ? shareMeta.wishlist || null : null,
    collection: friendsCfg.collection ? shareMeta.collection || null : null,
    binders: friendsCfg.binders ? binders.filter((b) => b.shareId).map((b) => ({ id: b.shareId, name: b.name })) : [],
  }), [friendsCfg, shareMeta, binders])
  useEffect(() => {
    if (!profile?.name) return
    if (JSON.stringify(profile.shares || {}) === JSON.stringify(wanted)) return
    saveProfileShares(uid, wanted).then(() => setProfile((p) => ({ ...p, shares: wanted }))).catch(console.error)
  }, [wanted, profile, uid])

  const run = async (fn) => { setBusy(true); setErr(''); setMsg(''); try { await fn() } catch (e) { if (e.code) console.error(e); setErr(e.message?.includes('permission') ? 'Keine Berechtigung – die Firebase-Regeln für Freunde fehlen noch.' : e.message) } finally { setBusy(false) } }

  const toggle = (k) => run(async () => {
    const on = !friendsCfg[k]
    if (on) {
      if (k === 'binders') {
        for (const b of binders) if (!b.shareId) await ensureShare('binder', b.id)
      } else if (!shareMeta[k]) await ensureShare(k)
    }
    setFriendsCfg({ ...friendsCfg, [k]: on })
  })

  if (profile === undefined) return <div className="import"><p className="muted">Lade …</p></div>

  if (!profile?.name) {
    return (
      <div className="import friends">
        <h2>Freunde</h2>
        <p className="muted">Wähle einen Benutzernamen, über den dich Freunde finden können (3–20 Zeichen, Buchstaben, Zahlen, _ . -).</p>
        <div className="hist-save">
          <input placeholder="z. B. Enton" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" disabled={busy || !NAME_RE.test(name)} onClick={() => run(async () => { await claimName(uid, name.trim()); setProfile(await loadProfile(uid)) })}>Namen festlegen</button>
        </div>
        {err && <p className="error">{err}</p>}
      </div>
    )
  }

  const me = { uid, name: profile.name }
  const entriesList = Object.entries(list).map(([k, v]) => ({ uid: k, ...v }))
  const incoming = entriesList.filter((f) => f.status === 'in')
  const outgoing = entriesList.filter((f) => f.status === 'out')
  const friends = entriesList.filter((f) => f.status === 'friend')

  const request = () => run(async () => {
    const u = await findUser(add)
    if (!u) throw new Error(`Niemand heißt „${add}“.`)
    if (u.uid === uid) throw new Error('Das bist du selbst 🙂')
    if (list[u.uid]) throw new Error('Ihr seid schon verbunden oder es gibt bereits eine Anfrage.')
    await sendRequest(me, u)
    setAdd(''); setMsg(`Anfrage an ${u.name} geschickt.`)
  })

  if (sel) return <FriendDetail friend={sel} onBack={() => setSel(null)} decks={decks} entries={entries} cards={cards} wishlist={wishlist} />

  return (
    <div className="import friends">
      <h2>Freunde <span className="muted small">· du bist <b>{profile.name}</b></span></h2>

      <section className="stat-card">
        <h3>Was deine Freunde sehen dürfen</h3>
        <label className="chk"><input type="checkbox" checked={!!friendsCfg.wishlist} onChange={() => toggle('wishlist')} disabled={busy} /> Wunschliste</label>
        <label className="chk"><input type="checkbox" checked={!!friendsCfg.binders} onChange={() => toggle('binders')} disabled={busy} /> Ordner (z. B. Tauschordner){binders.length ? ` – ${binders.map((b) => b.name).join(', ')}` : ' – noch keine Ordner'}</label>
        <label className="chk"><input type="checkbox" checked={!!friendsCfg.collection} onChange={() => toggle('collection')} disabled={busy} /> Gesamte Sammlung</label>
        <p className="muted small">Freigaben laufen über Nur-Lesen-Links. Für den Tausch-Abgleich braucht ihr beide mindestens die Wunschliste und Ordner oder Sammlung.</p>
      </section>

      <section className="stat-card">
        <h3>Freund hinzufügen</h3>
        <div className="hist-save">
          <input placeholder="Benutzername" value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add.trim() && request()} />
          <button className="btn primary" disabled={busy || !add.trim()} onClick={request}>Anfrage senden</button>
        </div>
        {msg && <p className="ok-text small">{msg}</p>}
        {err && <p className="error">{err}</p>}
      </section>

      {incoming.length > 0 && (
        <section className="stat-card">
          <h3>Anfragen an dich</h3>
          {incoming.map((f) => (
            <div key={f.uid} className="friend-row">
              <b>{f.name}</b>
              <span className="hist-actions">
                <button className="btn small primary" onClick={() => run(() => acceptRequest(me, f.uid, f.name))}>Annehmen</button>
                <button className="btn small ghost" onClick={() => run(() => removeFriend(uid, f.uid))}>Ablehnen</button>
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="stat-card">
        <h3>Deine Freunde <span className="muted">({friends.length})</span></h3>
        {!friends.length && <p className="muted small">Noch keine Freunde. Schick eine Anfrage über den Benutzernamen.</p>}
        {friends.map((f) => (
          <div key={f.uid} className="friend-row">
            <b className="friend-name" onClick={() => setSel(f)}>{f.name}</b>
            <span className="hist-actions">
              <button className="btn small primary" onClick={() => setSel(f)}>Ansehen & Tausch-Abgleich</button>
              <button className="mini danger" title="Freund entfernen" onClick={() => run(() => removeFriend(uid, f.uid))}>🗑</button>
            </span>
          </div>
        ))}
        {outgoing.length > 0 && <>
          <h4 className="muted small">Offene Anfragen von dir</h4>
          {outgoing.map((f) => (
            <div key={f.uid} className="friend-row">
              <span>{f.name} <span className="muted small">– wartet auf Antwort</span></span>
              <button className="btn small ghost" onClick={() => run(() => removeFriend(uid, f.uid))}>Zurückziehen</button>
            </div>
          ))}
        </>}
      </section>
    </div>
  )
}

function FriendDetail({ friend, onBack, decks, entries, cards, wishlist }) {
  const [prof, setProf] = useState(undefined)
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('match')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const p = await loadProfile(friend.uid).catch(() => null)
      if (!alive) return
      setProf(p)
      const sh = p?.shares || {}
      const [wish, coll, ...bins] = await Promise.all([
        sh.wishlist ? loadShare(sh.wishlist).catch(() => null) : null,
        sh.collection ? loadShare(sh.collection).catch(() => null) : null,
        ...(sh.binders || []).map((b) => loadShare(b.id).catch(() => null)),
      ])
      if (alive) setData({ wish, coll, bins: bins.filter(Boolean) })
    })()
    return () => { alive = false }
  }, [friend.uid])

  // Was ich habe: frei + in Ordnern (je Oracle-ID)
  const mine = useMemo(() => {
    const m = {}
    const add = (e, where) => { const c = cards[e.id]; if (!c) return; const o = (m[c.oracleId] ||= { free: 0, binders: [], price: c.eur }); if (where) { if (!o.binders.includes(where)) o.binders.push(where) } else o.free += e.qty }
    Object.values(entries).forEach((e) => add(e))
    Object.values(decks).filter((d) => d.kind === 'binder').forEach((d) => Object.values(d.entries).forEach((e) => add(e, d.name)))
    return m
  }, [entries, decks, cards])

  const match = useMemo(() => {
    if (!data) return null
    const give = (data.wish?.rows || []).map((r) => ({ r, have: mine[r.o] })).filter((x) => x.have && (x.have.free || x.have.binders.length))
    const theirs = {}
    for (const b of data.bins) for (const r of b.rows) (theirs[r.o] ||= { rows: [], where: new Set() }).where.add(`Ordner „${b.name}“`) && theirs[r.o].rows.push(r)
    for (const r of data.coll?.rows || []) { (theirs[r.o] ||= { rows: [], where: new Set() }).where.add('Sammlung'); theirs[r.o].rows.push(r) }
    const get = wishlist.map((w) => cards[w.id]).filter(Boolean).map((c) => ({ c, t: theirs[c.oracleId] })).filter((x) => x.t)
    return { give, get }
  }, [data, mine, wishlist, cards])

  const sh = prof?.shares || {}
  const tabs = [['match', 'Tausch-Abgleich'], ...(sh.wishlist ? [['wish', 'Wunschliste']] : []), ...(sh.binders || []).map((b) => [`b:${b.id}`, `📁 ${b.name}`]), ...(sh.collection ? [['coll', 'Sammlung']] : [])]

  return (
    <div className="import friends">
      <h2><button className="btn small" onClick={onBack}>‹ Zurück</button> {friend.name}</h2>
      <div className="deck-tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {prof === undefined || (!data && prof) ? <p className="muted">Lade …</p> : !prof ? <p className="muted">Profil nicht gefunden.</p> : null}
      {tab === 'match' && match && <>
        {!sh.wishlist && !sh.collection && !(sh.binders || []).length && <p className="muted">{friend.name} hat noch nichts freigegeben.</p>}
        <section className="stat-card">
          <h3>Das kannst du {friend.name} geben <span className="muted">({match.give.length})</span></h3>
          <p className="muted small">Karten von {friend.name}s Wunschliste, die du frei oder in einem Ordner hast.</p>
          {!match.give.length && <p className="muted small">{sh.wishlist ? 'Keine Treffer.' : `${friend.name} hat die Wunschliste nicht freigegeben.`}</p>}
          {match.give.map(({ r, have }) => (
            <div key={r.o + r.s + r.c} className="mover">
              <img src={r.i} alt="" loading="lazy" />
              <span className="mover-name">{r.n}<span className="muted small">{have.free ? `${have.free}× frei in deiner Sammlung` : ''}{have.free && have.binders.length ? ' · ' : ''}{have.binders.length ? `in ${have.binders.join(', ')}` : ''}</span></span>
              <span className="mover-diff">{euro(have.price)}</span>
            </div>
          ))}
        </section>
        <section className="stat-card">
          <h3>Das hat {friend.name} für dich <span className="muted">({match.get.length})</span></h3>
          <p className="muted small">Karten von deiner Wunschliste, die {friend.name} in freigegebenen Ordnern oder der Sammlung hat.</p>
          {!match.get.length && <p className="muted small">Keine Treffer.</p>}
          {match.get.map(({ c, t }) => (
            <div key={c.id} className="mover">
              <img src={t.rows[0].i || c.thumb} alt="" loading="lazy" />
              <span className="mover-name">{c.name}<span className="muted small">{[...t.where].join(' · ')} · {t.rows.reduce((s, r) => s + r.q, 0)}×</span></span>
              <span className="mover-diff">{euro(t.rows[0].p)}</span>
            </div>
          ))}
        </section>
      </>}
      {tab === 'wish' && sh.wishlist && <SharedView id={sh.wishlist} embedded />}
      {tab === 'coll' && sh.collection && <SharedView id={sh.collection} embedded />}
      {tab.startsWith('b:') && <SharedView id={tab.slice(2)} embedded />}
    </div>
  )
}
