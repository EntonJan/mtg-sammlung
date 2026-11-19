import { useEffect, useMemo, useRef, useState } from 'react'
import { loadProfile, watchFriends } from '../friends'
import { loadShare } from '../share'
import { cardStats, tokensForNames } from '../scryfall'
import { OnlineGame, OnlineLobby } from './OnlineTable'
import { ZONES, backImg, botKeep, fromOwnDeck, fromShare, isCreature, isDfc, isLand, isPermanent, newPlayer, nextUid, rockMana, ROCK, shuffle } from '../playtestCore'

// Testspiel: eigenes Deck gegen 1–3 eigene oder Freundes-Decks. Freies Spielfeld ohne Regel-Engine –
// du spielst alle Seiten selbst (ziehen, ausspielen, tappen, Marker, Token, Leben, Commander-Schaden).

// Vorerst zeigt der Reiter nur die Forge-Verlinkung. Der eigene Spieltisch (mit Bot) bleibt im Code
// und lässt sich über SHOW_TABLE wieder einschalten.
const SHOW_TABLE = false
const IMG = (f) => `${import.meta.env.BASE_URL}img/${f}`

export default function DeckPlaytest(props) {
  const [tableId, setTableId] = useState(null)
  if (tableId) return <OnlineGame tableId={tableId} me={props.uid} onClose={() => setTableId(null)} />
  return (
    <>
      {props.uid && <OnlineLobby {...props} onOpen={setTableId} />}
      {SHOW_TABLE ? <PlaytestTable {...props} /> : <ForgeInfo deck={props.deck} cards={props.cards} />}
    </>
  )
}

function ForgeInfo({ deck, cards }) {
  const [copied, setCopied] = useState(false)
  const go = async () => {
    const d = fromOwnDeck(deck, cards)
    const count = (arr) => { const m = new Map(); for (const c of arr) m.set(c.name, (m.get(c.name) || 0) + 1); return [...m].map(([n, q]) => `${q} ${n}`) }
    const text = [...count(d.cmd), ...count(d.main)].join('\n')
    try { await navigator.clipboard.writeText(text); setCopied(true) } catch { window.prompt('Deckliste kopieren (Strg+C):', text) }
    window.open('https://forgeweb.app/', '_blank', 'noopener')
  }
  return (
    <div className="forge">
      <div className="forge-hero">
        <div>
          <h3>Dein Deck mit echten Regeln testen</h3>
          <p><b>Forge</b> ist ein kostenloses Open-Source-Programm, das Magic mit allen Regeln nachspielt: Stack, Trigger, Kampf und Kartentexte werden automatisch ausgeführt – und du spielst gegen eine Computer-KI. <b>Forge Web</b> ist die Browser-Version davon, ganz ohne Installation.</p>
          <p className="muted small">Forge Web ist ein unabhängiges, inoffizielles Projekt und gehört nicht zu dieser App. Standard- und Commander-Decks werden unterstützt.</p>
          <button className="btn primary" onClick={go}>Deckliste kopieren &amp; Forge Web öffnen ↗</button>
          {copied && <p className="ok small">✓ „{deck.name}“ ist kopiert – in Forge Web beim Deck-Import einfügen.</p>}
        </div>
        <figure className="forge-shot"><img src={IMG('forge-start.jpg')} alt="Startseite von Forge Web" /><figcaption>Forge Web – Startseite mit laufender KI-Partie</figcaption></figure>
      </div>

      <h3 className="combo-sec">So geht’s</h3>
      <div className="forge-steps">
        <div className="forge-step">
          <span className="n">1</span>
          <div><b>Liste kopieren &amp; öffnen</b><p>Der Knopf oben kopiert dein Deck (Commander zuerst) und öffnet Forge Web in einem neuen Tab.</p></div>
        </div>
        <div className="forge-step">
          <span className="n">2</span>
          <div><b>Anmelden</b><p>Mit deiner E-Mail-Adresse – du bekommst einen Code zugeschickt, kein Passwort nötig. Deine Decks bleiben dort gespeichert.</p></div>
        </div>
        <div className="forge-step">
          <span className="n">3</span>
          <div><b>Deck importieren</b><p>Beim Deck-Import die kopierte Liste einfügen und deinen Commander auswählen.</p></div>
        </div>
        <div className="forge-step">
          <span className="n">4</span>
          <div><b>Gegen die KI spielen</b><p>Forge übernimmt Regeln und Gegner. Ideal, um zu sehen, wie schnell dein Deck in Fahrt kommt.</p></div>
        </div>
      </div>
      <div className="forge-gallery">
        <figure className="forge-shot small"><img src={IMG('forge-login.jpg')} alt="Anmeldung bei Forge Web per E-Mail-Code" /><figcaption>Schritt 2: Anmeldung per E-Mail-Code</figcaption></figure>
        <figure className="forge-shot"><img src={IMG('forge-board.jpg')} alt="Spielfeld in Forge Web" /><figcaption>Schritt 4: Spielfeld mit Phasen, Leben, Bibliothek und Hand</figcaption></figure>
      </div>
      <p className="muted small">Tipp: Am PC ist Forge Web am angenehmsten, die Handy-Ansicht wird dort noch verbessert. Screenshots: forgeweb.app.</p>
    </div>
  )
}

function PlaytestTable({ deck, decks, cards, uid, onUpdate }) {
  const [game, setGame] = useState(null)
  return game
    ? <Table game={game} setGame={setGame} deck={deck} onUpdate={onUpdate} />
    : <Setup deck={deck} decks={decks} cards={cards} uid={uid} onStart={setGame} />
}

// ---------- Auswahl der Gegner ----------
function Setup({ deck, decks, cards, uid, onStart }) {
  const [friends, setFriends] = useState(null) // [{uid, name, decks:[{id,name,cmd}]}]
  const [picks, setPicks] = useState([null]) // je Gegner: 'own:<id>' | 'share:<id>'
  const [bots, setBots] = useState([true])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const own = useMemo(() => Object.values(decks).filter((d) => d.kind !== 'binder').sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [decks])

  useEffect(() => {
    if (!uid) { setFriends([]); return }
    let alive = true
    const stop = watchFriends(uid, async (list) => {
      const fr = Object.entries(list || {}).filter(([, v]) => v.status === 'friend')
      const out = []
      for (const [fuid, v] of fr) {
        const p = await loadProfile(fuid).catch(() => null)
        const ds = p?.shares?.decks || []
        if (ds.length) out.push({ uid: fuid, name: p?.name || v.name, decks: ds })
      }
      if (alive) setFriends(out)
    })
    return () => { alive = false; stop?.() }
  }, [uid])

  const start = async () => {
    setBusy(true); setErr('')
    try {
      const me = fromOwnDeck(deck, cards)
      const srcs = []
      for (const [pi, p] of picks.entries()) {
        if (!p) continue
        const bot = bots[pi] !== false
        const [kind, id] = p.split(':')
        if (kind === 'own') srcs.push({ src: fromOwnDeck(decks[id], cards), label: 'Gegner ' + (srcs.length + 1), bot })
        else {
          const s = await loadShare(id)
          if (!s) throw new Error('Ein Freundes-Deck konnte nicht geladen werden (Freigabe aufgehoben?).')
          const fr = friends.find((f) => f.decks.some((d) => d.id === id))
          srcs.push({ src: fromShare(s), label: fr?.name || 'Freund', bot })
        }
      }
      if (!srcs.length) throw new Error('Wähle mindestens einen Gegner.')
      if (me.main.length < 7) throw new Error('Dein Deck braucht mindestens 7 Karten ohne Commander.')
      const players = [newPlayer(0, 'Du', me), ...srcs.map((s, i) => ({ ...newPlayer(i + 1, s.label, s.src), bot: s.bot }))]
      // Für Bots Stärke/Widerstand + Schlüsselwörter nachladen
      const botNames = [...new Set(players.filter((p) => p.bot).flatMap((p) => p.names))]
      if (botNames.length) {
        const st = await cardStats(botNames).catch(() => ({}))
        for (const p of players.filter((x) => x.bot)) for (const z of Object.values(p.z)) for (const c of z) { const v = st[c.name]; if (v) { c.pow = v.pow; c.tou = v.tou; c.kw = v.kw } }
      }
      onStart({ players, active: 0, turn: 1, phase: 'mull', log: [{ t: 1, msg: `Testspiel: ${deck.name} gegen ${srcs.map((s) => s.src.name).join(', ')}` }], startedAt: Date.now() })
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const tests = (deck.tests || []).slice().reverse()

  return (
    <div className="pt-setup">
      <p className="muted">Spiele dein Deck gegen bis zu drei andere Decks – deine eigenen oder die deiner Freunde. Es gibt keine Regel-Automatik: du ziehst, spielst aus und rechnest für alle Seiten selbst, die App übernimmt Bibliothek, Zonen, Leben, Marker und Züge.</p>
      {picks.map((p, i) => (
        <div key={i} className="pt-pick">
          <b>Gegner {i + 1}</b>
          <select value={p || ''} onChange={(e) => setPicks(picks.map((x, j) => (j === i ? e.target.value || null : x)))}>
            <option value="">– Deck wählen –</option>
            <optgroup label="Meine Decks">
              {own.map((d) => <option key={d.id} value={`own:${d.id}`}>{d.name}{d.id === deck.id ? ' (dieses Deck)' : ''}</option>)}
            </optgroup>
            {(friends || []).map((f) => (
              <optgroup key={f.uid} label={`Decks von ${f.name}`}>
                {f.decks.map((d) => <option key={d.id} value={`share:${d.id}`}>{d.name}{d.cmd ? ` – ${d.cmd}` : ''}</option>)}
              </optgroup>
            ))}
          </select>
          <label className="chk small" title="Der Bot legt Länder, wirkt Karten nach Manakurve und greift an – du spielst nur noch dein Deck"><input type="checkbox" checked={bots[i] !== false} onChange={() => setBots(bots.map((b, j) => (j === i ? b === false : b)).concat(bots.length <= i ? [false] : []))} /> 🤖 Bot spielt</label>
          {picks.length > 1 && <button className="btn small" onClick={() => { setPicks(picks.filter((_, j) => j !== i)); setBots(bots.filter((_, j) => j !== i)) }}>Entfernen</button>}
        </div>
      ))}
      <div className="pt-setup-actions">
        {picks.length < 3 && <button className="btn" onClick={() => { setPicks([...picks, null]); setBots([...bots, true]) }}>+ Weiterer Gegner</button>}
        <button className="btn primary" disabled={busy || !picks.some(Boolean)} onClick={start}>{busy ? 'Lade Decks …' : 'Testspiel starten'}</button>
      </div>
      {friends === null && <p className="muted small">Lade Decks deiner Freunde …</p>}
      {friends && !friends.length && <p className="muted small">Von Freunden sind keine Decks freigegeben. Freunde können ihre Decks unter „Freunde“ → „Was ich teile“ freigeben.</p>}
      {err && <p className="error">{err}</p>}

      {tests.length > 0 && (
        <section>
          <h3 className="combo-sec">Bisherige Testspiele <span className="muted">({tests.length})</span></h3>
          <table className="pt-tests">
            <thead><tr><th>Datum</th><th>Gegner</th><th>Ergebnis</th><th>Züge</th><th>Leben am Ende</th><th>Notiz</th></tr></thead>
            <tbody>
              {tests.map((t, i) => (
                <tr key={i}>
                  <td>{new Date(t.at).toLocaleDateString('de-DE')}</td>
                  <td>{t.opponents.join(', ')}</td>
                  <td className={`pt-res ${t.result}`}>{{ win: 'Gewonnen', loss: 'Verloren', draw: 'Abgebrochen' }[t.result]}</td>
                  <td>{t.turns}</td>
                  <td>{t.lives.join(' / ')}</td>
                  <td className="muted">{t.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Bilanz: {tests.filter((t) => t.result === 'win').length} gewonnen · {tests.filter((t) => t.result === 'loss').length} verloren · {tests.filter((t) => t.result === 'draw').length} abgebrochen</p>
        </section>
      )}
    </div>
  )
}

// ---------- Spieltisch ----------
export function Table({ game, setGame, deck, onUpdate, online }) {
  const meId = game.me ?? 0
  const ro = (p) => !!online && p.id !== meId // fremde Seite online: nur ansehen + Leben/Gift/Commander-Schaden
  const hist = useRef([])
  const [menu, setMenu] = useState(null) // { pid, zone, uid, x, y }
  const [viewer, setViewer] = useState(null) // { pid, zone, top? }
  const [tokenFor, setTokenFor] = useState(null)
  const [big, setBig] = useState(null)
  const [hover, setHover] = useState(null)
  const [ending, setEnding] = useState(false)
  const [showLog, setShowLog] = useState(false)

  // Jede Änderung über change(): legt einen Rückgängig-Punkt an
  const change = (fn) => setGame((g) => {
    hist.current.push(g); if (hist.current.length > 80) hist.current.shift()
    const n = structuredClone(g)
    fn(n)
    return n
  })
  const undo = () => { if (online) return; const prev = hist.current.pop(); if (prev) setGame(prev) }
  const log = (g, msg) => g.log.push({ t: g.turn, msg })
  const P = (g, pid) => g.players.find((x) => x.id === pid)
  const pname = (p) => (online ? p.label : p.id === meId ? 'Du' : p.label) // für Protokoll (online: echte Namen)
  const who = (p) => (p.id === meId ? 'Du' : p.label) // für Überschriften

  const take = (p, zone, uid) => { const i = p.z[zone].findIndex((c) => c.uid === uid); return i < 0 ? null : p.z[zone].splice(i, 1)[0] }
  const move = (pid, zone, uid, to, where = 'top') => change((g) => {
    const p = P(g, pid); const c = take(p, zone, uid); if (!c) return
    c.tapped = false
    if (to !== 'bf') { c.ctr = {}; c.flip = false }
    if (c.token && to !== 'bf') { log(g, `${pname(p)}: Token ${c.name} verschwindet`); return }
    if (zone === 'cmd' && to === 'bf') {
      const n = p.tax[c.uid] || 0; p.tax[c.uid] = n + 1
      log(g, `${pname(p)} wirkt ${c.name} aus der Commander-Zone${n ? ` (Steuer +${n * 2})` : ''}`)
    } else if (to === 'bf' && zone === 'hand') log(g, `${pname(p)} spielt ${c.name}`)
    else if (zone === 'lib' && to === 'hand') log(g, `${pname(p)} nimmt ${c.name} aus der Bibliothek auf die Hand`)
    else log(g, `${pname(p)}: ${c.name} ${ZONES[zone]} → ${ZONES[to]}${to === 'lib' ? (where === 'top' ? ' (oben)' : ' (unten)') : ''}`)
    if (to === 'bf') c.since = g.turn
    if (to === 'lib' && where === 'top') p.z.lib.unshift(c)
    else p.z[to].push(c)
  })
  const draw = (pid, n = 1) => change((g) => {
    const p = P(g, pid); const got = p.z.lib.splice(0, n); p.z.hand.push(...got)
    log(g, got.length ? `${pname(p)} zieht ${got.length} Karte${got.length > 1 ? 'n' : ''}` : `${pname(p)} kann nicht ziehen – Bibliothek leer!`)
  })
  const mill = (pid, n = 1) => change((g) => { const p = P(g, pid); const got = p.z.lib.splice(0, n); p.z.gy.push(...got); log(g, `${pname(p)} legt ${got.map((c) => c.name).join(', ')} von der Bibliothek in den Friedhof`) })
  const shuffleLib = (pid) => change((g) => { const p = P(g, pid); p.z.lib = shuffle(p.z.lib); log(g, `${pname(p)} mischt die Bibliothek`) })
  const life = (pid, d) => change((g) => { const p = P(g, pid); p.life += d; log(g, `${pname(p)}: Leben ${d > 0 ? '+' : ''}${d} → ${p.life}`) })
  const poison = (pid, d) => change((g) => { const p = P(g, pid); p.poison = Math.max(0, p.poison + d); log(g, `${pname(p)}: Gift ${p.poison}`) })
  const cmdDmg = (pid, from, d) => change((g) => {
    const p = P(g, pid); const old = p.cmdDmg[from] || 0; const v = Math.max(0, old + d); p.cmdDmg[from] = v
    p.life -= v - old // Commander-Schaden ist auch normaler Schaden
    log(g, `${pname(p)}: Commander-Schaden von ${pname(P(g, from))} ${v} (Leben ${p.life})`)
  })
  const card = (g, pid, uid) => P(g, pid).z.bf.find((c) => c.uid === uid)
  const tap = (pid, uid) => change((g) => { const c = card(g, pid, uid); if (c) c.tapped = !c.tapped })
  const counter = (pid, uid, kind, d) => change((g) => { const c = card(g, pid, uid); if (!c) return; const v = (c.ctr[kind] || 0) + d; if (v <= 0) delete c.ctr[kind]; else c.ctr[kind] = v })
  const flip = (pid, zone, uid) => change((g) => { const c = P(g, pid).z[zone].find((x) => x.uid === uid); if (c) c.flip = !c.flip })
  const copy = (pid, uid) => change((g) => { const c = card(g, pid, uid); if (!c) return; P(g, pid).z.bf.push({ ...c, uid: nextUid(), token: true, tapped: false, ctr: {} }); log(g, `${pname(P(g, pid))} erstellt eine Kopie von ${c.name}`) })
  const makeToken = (pid, t, n = 1) => change((g) => {
    const p = P(g, pid)
    for (let i = 0; i < n; i++) p.z.bf.push({ uid: nextUid(), name: t.name, img: t.img || '', type: t.type || 'Token', pt: t.pt || '', cmc: 0, tapped: false, ctr: {}, token: true })
    log(g, `${pname(p)} erstellt ${n}× ${t.name}${t.pt ? ` ${t.pt}` : ''}`)
  })
  const untapAll = (pid) => change((g) => { P(g, pid).z.bf.forEach((c) => { c.tapped = false }); log(g, `${pname(P(g, pid))} enttappt alles`) })

  const botTurn = (g, p) => {
    const say = (m) => log(g, `🤖 ${pname(p)}: ${m}`)
    // 1. Land
    const land = p.z.hand.find((c) => isLand(c))
    if (land) { p.z.hand.splice(p.z.hand.indexOf(land), 1); land.since = g.turn; p.z.bf.push(land); say(`spielt ${land.name}`) }
    // 2. Mana: Länder + bekannte Manasteine
    let mana = p.z.bf.filter((c) => isLand(c)).length + p.z.bf.filter((c) => ROCK.test(c.name)).reduce((t, c) => t + rockMana(c), 0)
    const cast = []
    // Commander zuerst, wenn bezahlbar
    for (const c of [...p.z.cmd]) {
      const cost = (c.cmc || 0) + 2 * (p.tax[c.uid] || 0)
      if (cost <= mana) { mana -= cost; p.tax[c.uid] = (p.tax[c.uid] || 0) + 1; p.z.cmd.splice(p.z.cmd.indexOf(c), 1); c.since = g.turn; p.z.bf.push(c); cast.push(`${c.name} (Commander${cost > (c.cmc || 0) ? `, Steuer +${cost - (c.cmc || 0)}` : ''})`) }
    }
    // Dann Handkarten: Manasteine vorziehen, sonst teuerste zuerst
    for (;;) {
      const options = p.z.hand.filter((c) => !isLand(c) && (c.cmc || 0) <= mana)
      if (!options.length) break
      options.sort((a, b) => (ROCK.test(b.name) - ROCK.test(a.name)) || (b.cmc || 0) - (a.cmc || 0))
      const c = options[0]
      p.z.hand.splice(p.z.hand.indexOf(c), 1); mana -= c.cmc || 0
      if (ROCK.test(c.name)) mana += rockMana(c)
      if (isPermanent(c)) { c.since = g.turn; p.z.bf.push(c) } else p.z.gy.push(c)
      cast.push(c.name)
    }
    if (cast.length) say(`wirkt ${cast.join(', ')}${cast.some((n) => p.z.gy.some((c) => c.name === n)) ? ' – Ziele/Effekte bitte selbst ausführen' : ''}`)
    // Länder als genutzt markieren (rein optisch)
    let used = p.z.bf.filter((c) => isLand(c)).length + p.z.bf.filter((c) => ROCK.test(c.name)).reduce((t, c) => t + rockMana(c), 0) - mana
    for (const c of p.z.bf) { if (used <= 0) break; if (isLand(c) || ROCK.test(c.name)) { c.tapped = true; used -= ROCK.test(c.name) ? rockMana(c) : 1 } }
    // 3. Angriff mit allen Kreaturen, die seit einer Runde liegen (Eile: sofort)
    const attackers = p.z.bf.filter((c) => (isCreature(c) || c.pt) && !c.tapped && ((c.since ?? 0) < g.turn || c.kw?.includes('haste')) && (c.pow ?? 0) > 0)
    const targets = g.players.filter((x) => x.id !== p.id && x.life > 0)
    if (attackers.length && targets.length) {
      const target = targets.find((x) => x.id === (g.me ?? 0)) || targets.sort((a, b) => a.life - b.life)[0]
      attackers.forEach((c) => { if (!c.kw?.includes('vigilance')) c.tapped = true })
      const dmg = attackers.reduce((t, c) => t + (c.pow || 0) + (c.ctr['+1/+1'] || 0) - (c.ctr['-1/-1'] || 0), 0)
      g.attack = { from: p.id, target: target.id, list: attackers.map((c) => ({ uid: c.uid, name: c.name, pow: (c.pow || 0) + (c.ctr['+1/+1'] || 0) - (c.ctr['-1/-1'] || 0), tou: c.tou, isCmd: !!c.isCmd, blocked: false, kw: c.kw || [] })) }
      say(`greift ${pname(target)} an mit ${attackers.map((c) => `${c.name}${c.pow != null ? ` (${c.pow}/${c.tou})` : ''}`).join(', ')} – zusammen ${dmg} Schaden`)
    } else if (!cast.length && !land) say('passt')
  }

  const resolveAttack = () => change((g) => {
    const a = g.attack; if (!a) return
    const t = P(g, a.target)
    let total = 0, cmdHit = 0, poison = 0
    for (const x of a.list) {
      if (x.blocked) continue
      if (x.kw.includes('infect')) { poison += x.pow; continue }
      total += x.pow; if (x.isCmd) cmdHit += x.pow
    }
    t.life -= total; t.poison += poison
    if (cmdHit) t.cmdDmg[a.from] = (t.cmdDmg[a.from] || 0) + cmdHit
    const blocked = a.list.filter((x) => x.blocked).map((x) => x.name)
    log(g, `${pname(t)} nimmt ${total} Schaden${poison ? ` und ${poison} Gift` : ''}${cmdHit ? ` (davon ${cmdHit} Commander-Schaden)` : ''}${blocked.length ? ` – geblockt: ${blocked.join(', ')}` : ''} → ${t.life} Leben`)
    g.attack = null
  })
  const toggleBlock = (uid) => change((g) => { const x = g.attack?.list.find((y) => y.uid === uid); if (x) x.blocked = !x.blocked })

  // Zugwechsel: nächster Spieler enttappt und zieht
  const nextTurn = () => change((g) => {
    const order = g.order || g.players.map((x) => x.id)
    const idx = order.indexOf(g.active)
    const nextId = order[(idx + 1) % order.length]
    if ((idx + 1) % order.length === 0) g.turn++
    g.active = nextId
    if (online) { log(g, `— Zug ${g.turn}: ${P(g, nextId)?.label} ist dran`); return } // enttappen + ziehen macht der Client des Spielers selbst
    const p = P(g, nextId)
    p.z.bf.forEach((c) => { c.tapped = false })
    const got = p.z.lib.splice(0, 1); p.z.hand.push(...got)
    log(g, `— Zug ${g.turn}: ${pname(p)} ist dran (enttappt${got.length ? ', zieht 1' : ', Bibliothek leer!'})`)
    g.attack = null
    if (p.bot && p.life > 0) botTurn(g, p)
  })

  // Mulligan-Phase
  const mulligan = (pid) => change((g) => {
    const p = P(g, pid)
    p.z.lib = shuffle([...p.z.lib, ...p.z.hand]); p.z.hand = p.z.lib.splice(0, 7); p.mulls++
    log(g, `${pname(p)} nimmt einen Mulligan (${p.mulls})`)
  })
  const keep = (pid) => change((g) => {
    const p = P(g, pid); p.kept = true
    log(g, `${pname(p)} behält ${p.z.hand.length} Karten${p.mulls > 1 ? ` – ${p.mulls - 1} davon unter die Bibliothek legen` : ''}`)
    g.players.filter((x) => x.bot && !x.kept).forEach((x) => { botKeep(x); log(g, `🤖 ${pname(x)} behält ${x.z.hand.length} Karten${x.mulls ? ` (${x.mulls} Mulligan)` : ''}`) })
    if (g.players.every((x) => x.kept)) { g.phase = 'play'; g.active = (g.order || [g.players[0].id])[0]; log(g, `— Zug 1: ${pname(P(g, g.active))} beginnt`) }
  })

  const toggleHand = (pid) => change((g) => { P(g, pid).showHand = !P(g, pid).showHand })

  // Ziehen & Ablegen (PC)
  const onDragStart = (e, pid, zone, uid) => { e.dataTransfer.setData('text/plain', JSON.stringify({ pid, zone, uid })); e.dataTransfer.effectAllowed = 'move' }
  const dropTo = (pid, to) => (online && pid !== meId ? {} : {
    onDragOver: (e) => { e.preventDefault(); e.currentTarget.classList.add('drop') },
    onDragLeave: (e) => e.currentTarget.classList.remove('drop'),
    onDrop: (e) => {
      e.preventDefault(); e.currentTarget.classList.remove('drop')
      try { const d = JSON.parse(e.dataTransfer.getData('text/plain')); if (d.pid === pid && d.zone !== to) move(pid, d.zone, d.uid, to) } catch { /* kein Kartenzug */ }
    },
  })

  const openMenu = (e, pid, zone, uid) => {
    e.preventDefault(); e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({ pid, zone, uid, x: Math.min(r.left, window.innerWidth - 230), y: Math.min(r.bottom + 4, window.innerHeight - 340) })
  }
  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener('click', close); window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true) }
  }, [])
  useEffect(() => {
    const k = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !/input|textarea/i.test(e.target.tagName)) { e.preventDefault(); undo() } }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })

  const finish = (result, note) => {
    const t = {
      at: Date.now(), result, note: note.trim(), turns: game.turn,
      opponents: game.players.slice(1).map((p) => `${p.deck}${p.label.startsWith('Gegner') ? '' : ` (${p.label})`}`),
      lives: game.players.map((p) => p.life),
    }
    onUpdate({ tests: [...(deck.tests || []), t].slice(-100) })
    setGame(null)
  }

  const me = P(game, meId)
  const opps = game.players.filter((p) => p.id !== meId)
  const m = menu && P(game, menu.pid)?.z[menu.zone].find((c) => c.uid === menu.uid)

  const renderCard = (c, pid, zone, size) => {
    const shown = c.flip && isDfc(c) ? backImg(c.img) : c.img
    const lock = !!online && pid !== meId
    const pt = c.pt && <span className="pt-pt">{c.pt}</span>
    return (
      <div key={c.uid} className={`pt-card ${size || ''} ${c.tapped ? 'tapped' : ''} ${c.token ? 'token' : ''}`}
        draggable={!lock} onDragStart={(e) => !lock && onDragStart(e, pid, zone, c.uid)}
        onClick={(e) => { if (lock) { e.stopPropagation(); if (shown) setBig(shown) } else openMenu(e, pid, zone, c.uid) }}
        onDoubleClick={(e) => { e.stopPropagation(); setMenu(null); if (lock) return; if (zone === 'bf') tap(pid, c.uid); else if (zone === 'hand' || zone === 'cmd') move(pid, zone, c.uid, 'bf') }}
        onMouseEnter={() => shown && setHover(shown)} onMouseLeave={() => setHover(null)}
        title={c.name}>
        {shown ? <img src={shown} alt={c.name} loading="lazy" /> : <div className="pt-noimg"><b>{c.name}</b><small>{c.type}</small></div>}
        {pt}
        {Object.keys(c.ctr).length > 0 && (
          <div className="pt-ctrs">{Object.entries(c.ctr).map(([k, v]) => <span key={k} className={k === '+1/+1' ? 'plus' : k === '-1/-1' ? 'minus' : ''}>{k === '+1/+1' ? `+${v}/+${v}` : k === '-1/-1' ? `−${v}/−${v}` : `${v} ${k}`}</span>)}</div>
        )}
        {c.isCmd && zone === 'cmd' && (P(game, pid).tax[c.uid] || 0) > 0 && <span className="pt-tax">+{(P(game, pid).tax[c.uid]) * 2}</span>}
      </div>
    )
  }

  const renderBoard = (p, compact) => {
    const size = compact ? 'sm' : ''
    const bf = p.z.bf
    const rows = [
      ['Kreaturen', bf.filter((c) => isCreature(c) || (c.token && /Creature|Kreatur/i.test(c.type) ) || (c.token && c.pt))],
      ['Weitere bleibende Karten', bf.filter((c) => !isCreature(c) && !isLand(c) && !(c.token && (/Creature|Kreatur/i.test(c.type) || c.pt)))],
      ['Länder', bf.filter((c) => isLand(c) && !isCreature(c))],
    ]
    const others = game.players.filter((x) => x.id !== p.id)
    return (
      <div key={p.id} className={`pt-board ${game.active === p.id && game.phase === 'play' ? 'active' : ''} ${compact ? 'compact' : ''}`}>
        <div className="pt-head">
          <div className="pt-who"><b>{who(p)}</b><span className="muted small">{p.deck}</span>{p.bot && <span className="chip bot-chip">🤖 Bot</span>}{game.active === p.id && game.phase === 'play' && <span className="chip">am Zug</span>}</div>
          <div className="pt-life">
            <button onClick={() => life(p.id, -5)}>−5</button><button onClick={() => life(p.id, -1)}>−1</button>
            <b className={p.life <= 0 ? 'dead' : ''}>{p.life}</b>
            <button onClick={() => life(p.id, 1)}>+1</button><button onClick={() => life(p.id, 5)}>+5</button>
          </div>
          <div className="pt-mini">
            <span title="Giftmarker">☠ <button onClick={() => poison(p.id, -1)}>−</button>{p.poison}<button onClick={() => poison(p.id, 1)}>+</button></span>
            {others.filter((o) => o.z.cmd.length || o.z.bf.some((c) => c.isCmd) || Object.keys(o.tax).length).map((o) => (
              <span key={o.id} title={`Commander-Schaden von ${pname(o)}`}>⚔ {pname(o)} <button onClick={() => cmdDmg(p.id, o.id, -1)}>−</button>{p.cmdDmg[o.id] || 0}<button onClick={() => cmdDmg(p.id, o.id, 1)}>+</button></span>
            ))}
          </div>
          <div className="pt-piles">
            <button className="pt-pile" {...dropTo(p.id, 'lib')} disabled={ro(p)} onClick={() => draw(p.id)} title="Klick: Karte ziehen · Karten hierher ziehen = oben auf die Bibliothek">Bibliothek <b>{p.z.lib.length}</b></button>
            <button className="pt-pile" {...dropTo(p.id, 'gy')} onClick={() => setViewer({ pid: p.id, zone: 'gy' })}>Friedhof <b>{p.z.gy.length}</b></button>
            <button className="pt-pile" {...dropTo(p.id, 'ex')} onClick={() => setViewer({ pid: p.id, zone: 'ex' })}>Exil <b>{p.z.ex.length}</b></button>
            {!ro(p) && <details className="pt-more" onClick={(e) => e.stopPropagation()}>
              <summary className="btn small">Aktionen ▾</summary>
              <div className="pt-more-pop" onClick={(e) => { const d = e.currentTarget.closest('details'); if (d && e.target.tagName === 'BUTTON') d.open = false }}>
                <button onClick={() => draw(p.id)}>1 Karte ziehen</button>
                <button onClick={() => { const n = Number(prompt('Wie viele Karten ziehen?', '2')); if (n > 0) draw(p.id, n) }}>X Karten ziehen …</button>
                <button onClick={() => setViewer({ pid: p.id, zone: 'lib', top: Number(prompt('Wie viele oberste Karten ansehen?', '3')) || 3 })}>Oberste X ansehen …</button>
                <button onClick={() => setViewer({ pid: p.id, zone: 'lib' })}>Bibliothek durchsuchen</button>
                <button onClick={() => mill(p.id, 1)}>Oberste Karte in den Friedhof</button>
                <button onClick={() => shuffleLib(p.id)}>Bibliothek mischen</button>
                <button onClick={() => setTokenFor(p.id)}>Token erstellen …</button>
                <button onClick={() => untapAll(p.id)}>Alles enttappen</button>
              </div>
            </details>}
          </div>
        </div>

        {p.z.cmd.length > 0 && (
          <div className="pt-zone pt-cmdzone" {...dropTo(p.id, 'cmd')}>
            <span className="pt-zlabel">Commander-Zone</span>
            <div className="pt-cards">{p.z.cmd.map((c) => renderCard(c, p.id, 'cmd', size))}</div>
          </div>
        )}
        <div className="pt-zone pt-bf" {...dropTo(p.id, 'bf')}>
          {bf.length === 0 && <span className="pt-empty muted">Spielfeld – Karten hierher ziehen oder antippen → „Ausspielen“</span>}
          {rows.map(([label, list]) => list.length > 0 && (
            <div key={label} className="pt-row"><span className="pt-zlabel">{label} ({list.length})</span><div className="pt-cards">{list.map((c) => renderCard(c, p.id, 'bf', size))}</div></div>
          ))}
        </div>

        <div className="pt-zone pt-hand" {...dropTo(p.id, 'hand')}>
          <span className="pt-zlabel">
            Hand ({p.z.hand.length})
            {p.id !== meId && !online && <button className="linklike small" onClick={() => toggleHand(p.id)}>{p.showHand ? 'verdecken' : 'aufdecken'}</button>}
          </span>
          <div className="pt-cards">
            {p.showHand
              ? p.z.hand.map((c) => renderCard(c, p.id, 'hand', size))
              : p.z.hand.map((c) => <div key={c.uid} className={`pt-card back ${size}`} />)}
          </div>
          {game.phase === 'mull' && !p.kept && !p.bot && !ro(p) && (
            <div className="pt-mull">
              <button className="btn small" onClick={() => mulligan(p.id)}>Mulligan</button>
              <button className="btn small primary" onClick={() => keep(p.id)}>Behalten</button>
              {p.mulls > 0 && <span className="muted small">Mulligan {p.mulls}: {p.mulls === 1 ? 'der erste ist frei' : `danach ${p.mulls - 1} Karte${p.mulls > 2 ? 'n' : ''} unter die Bibliothek legen`}</span>}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="pt-table" onClick={() => setMenu(null)}>
      <div className="pt-bar">
        <b>Zug {game.turn}</b>
        <span className="muted">{game.phase === 'mull' ? 'Starthände: Mulligan oder behalten' : `${who(P(game, game.active) || me)} ${game.active === meId ? 'bist' : 'ist'} am Zug`}</span>
        <span className="spacer" />
        {game.phase === 'play' && (!online || game.active === meId) && <button className="btn primary" onClick={nextTurn}>Zug beenden →</button>}
        {!online && <button className="btn" disabled={!hist.current.length} onClick={undo} title="Strg+Z">↶ Rückgängig</button>}
        <button className={`btn ${showLog ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); setShowLog((s) => !s) }}>Protokoll</button>
        {online
          ? <button className="btn" onClick={online.leave}>{online.isHost ? 'Tisch beenden' : 'Tisch verlassen'}</button>
          : <button className="btn" onClick={() => setEnding(true)}>Test beenden</button>}
      </div>
      <p className="muted small pt-help">Karte antippen = Aktionen · Doppelklick = tappen bzw. ausspielen · am PC Karten zwischen Zonen ziehen · Strg+Z = rückgängig</p>

      {game.attack && (() => {
        const a = game.attack; const from = P(game, a.from); const to = P(game, a.target)
        const dmg = a.list.filter((x) => !x.blocked).reduce((t, x) => t + x.pow, 0)
        return (
          <div className="pt-attack" onClick={(e) => e.stopPropagation()}>
            <b>⚔ {pname(from)} greift {pname(to)} an</b>
            <span className="muted small">Tippe geblockte Angreifer an – Kampfschaden zwischen Kreaturen regelst du selbst.</span>
            <div className="pt-att-list">
              {a.list.map((x) => (
                <button key={x.uid} className={`pt-att ${x.blocked ? 'blocked' : ''}`} onClick={() => toggleBlock(x.uid)}>
                  {x.name} <b>{x.pow}{x.tou != null ? `/${x.tou}` : ''}</b>{x.isCmd && <small> Commander</small>}{x.kw.filter((k) => ['flying', 'trample', 'menace', 'infect', 'lifelink', 'deathtouch'].includes(k)).map((k) => <small key={k}> · {k}</small>)}{x.blocked && <small> · geblockt</small>}
                </button>
              ))}
            </div>
            <div className="pt-att-actions">
              <button className="btn primary" onClick={resolveAttack}>{dmg} Schaden übernehmen</button>
              <button className="btn ghost" onClick={() => change((g) => { g.attack = null; log(g, 'Angriff ohne Schaden verworfen') })}>Verwerfen</button>
            </div>
          </div>
        )
      })()}

      <div className={`pt-opps n${opps.length}`}>{opps.map((p) => renderBoard(p, true))}</div>
      {renderBoard(me, false)}

      {showLog && (
        <div className="pt-log" onClick={(e) => e.stopPropagation()}>
          {game.log.slice().reverse().map((l, i) => <div key={i}><span className="muted">Z{l.t}</span> {l.msg}</div>)}
        </div>
      )}

      {hover && <img className="pt-hover" src={hover} alt="" />}

      {menu && m && (
        <div className="pt-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="pt-menu-title">{m.name}</div>
          {menu.zone === 'bf' && <>
            <button onClick={() => { tap(menu.pid, m.uid); setMenu(null) }}>{m.tapped ? 'Enttappen' : 'Tappen'}</button>
            <div className="pt-menu-row">+1/+1 <button onClick={() => counter(menu.pid, m.uid, '+1/+1', -1)}>−</button><button onClick={() => counter(menu.pid, m.uid, '+1/+1', 1)}>+</button></div>
            <div className="pt-menu-row">−1/−1 <button onClick={() => counter(menu.pid, m.uid, '-1/-1', -1)}>−</button><button onClick={() => counter(menu.pid, m.uid, '-1/-1', 1)}>+</button></div>
            <button onClick={() => { const k = (prompt('Welcher Marker? (z. B. Loyalität, Ladung, Schild)', 'Loyalität') || '').trim(); if (k) { const n = Number(prompt(`Wie viele ${k}-Marker hinzufügen? (negativ = entfernen)`, '1')); if (n) counter(menu.pid, m.uid, k, n) } setMenu(null) }}>Anderer Marker …</button>
            <button onClick={() => { copy(menu.pid, m.uid); setMenu(null) }}>Kopie als Token</button>
          </>}
          {(menu.zone === 'hand' || menu.zone === 'cmd' || menu.zone === 'gy' || menu.zone === 'ex') && <button className="strong" onClick={() => { move(menu.pid, menu.zone, m.uid, 'bf'); setMenu(null) }}>{menu.zone === 'cmd' ? 'Wirken (aufs Spielfeld)' : 'Ausspielen (aufs Spielfeld)'}</button>}
          {isDfc(m) && (menu.zone === 'bf' || menu.zone === 'hand') && <button onClick={() => { flip(menu.pid, menu.zone, m.uid); setMenu(null) }}>Umdrehen (andere Seite)</button>}
          {m.isCmd && menu.zone !== 'cmd' && <button onClick={() => { move(menu.pid, menu.zone, m.uid, 'cmd'); setMenu(null) }}>→ Commander-Zone</button>}
          {['hand', 'gy', 'ex'].filter((z) => z !== menu.zone).map((z) => <button key={z} onClick={() => { move(menu.pid, menu.zone, m.uid, z); setMenu(null) }}>→ {ZONES[z]}</button>)}
          {menu.zone !== 'lib' && <>
            <button onClick={() => { move(menu.pid, menu.zone, m.uid, 'lib', 'top'); setMenu(null) }}>→ Bibliothek oben</button>
            <button onClick={() => { move(menu.pid, menu.zone, m.uid, 'lib', 'bottom'); setMenu(null) }}>→ Bibliothek unten</button>
          </>}
          {m.img && <button onClick={() => { setBig(m.flip && isDfc(m) ? backImg(m.img) : m.img); setMenu(null) }}>Groß ansehen</button>}
        </div>
      )}

      {viewer && <ZoneViewer game={game} viewer={viewer} onClose={() => setViewer(null)} move={move} shuffleLib={shuffleLib} setBig={setBig} pname={pname} readOnly={ro(P(game, viewer.pid))} />}
      {tokenFor != null && <TokenDialog player={P(game, tokenFor)} isMe={tokenFor === meId} onClose={() => setTokenFor(null)} onMake={(t, n) => { makeToken(tokenFor, t, n); setTokenFor(null) }} />}
      {big && <div className="pt-big" onClick={() => setBig(null)}><img src={big.replace('/normal/', '/large/')} alt="" /></div>}
      {ending && <EndDialog game={game} pname={pname} onClose={() => setEnding(false)} onSave={finish} onDiscard={() => setGame(null)} />}
    </div>
  )
}

function ZoneViewer({ game, viewer, onClose, move, shuffleLib, setBig, pname, readOnly }) {
  const p = game.players.find((x) => x.id === viewer.pid)
  const all = p.z[viewer.zone]
  const list = viewer.zone === 'lib' && viewer.top ? all.slice(0, viewer.top) : viewer.zone === 'lib' ? [...all].sort((a, b) => a.name.localeCompare(b.name)) : all
  const targets = ['hand', 'bf', 'gy', 'ex'].filter((z) => z !== viewer.zone)
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal pt-viewer" onClick={(e) => e.stopPropagation()}>
        <h3>{pname(p)} – {viewer.zone === 'lib' ? (viewer.top ? `Oberste ${viewer.top} Karten` : 'Bibliothek durchsuchen') : ZONES[viewer.zone]} <span className="muted">({list.length})</span></h3>
        {!list.length && <p className="muted">Leer.</p>}
        <div className="pt-vgrid">
          {list.map((c) => (
            <div key={c.uid} className="pt-vcard">
              {c.img ? <img src={c.img} alt={c.name} onClick={() => setBig(c.img)} /> : <div className="pt-noimg"><b>{c.name}</b></div>}
              {!readOnly && <div className="pt-vbtns">
                {targets.map((z) => <button key={z} onClick={() => move(p.id, viewer.zone, c.uid, z)}>{ZONES[z]}</button>)}
                {viewer.zone !== 'lib' && <button onClick={() => move(p.id, viewer.zone, c.uid, 'lib', 'top')}>Bibl. oben</button>}
                <button onClick={() => move(p.id, viewer.zone, c.uid, 'lib', 'bottom')}>Bibl. unten</button>
              </div>}
            </div>
          ))}
        </div>
        <div className="modal-actions">
          {viewer.zone === 'lib' && <button className="btn" onClick={() => { shuffleLib(p.id); onClose() }}>Mischen & schließen</button>}
          <button className="btn primary" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </div>
  )
}

function TokenDialog({ player, isMe, onClose, onMake }) {
  const [list, setList] = useState(null)
  const [name, setName] = useState('')
  const [pt, setPt] = useState('1/1')
  const [n, setN] = useState(1)
  useEffect(() => { tokensForNames(player.names).then(setList).catch(() => setList([])) }, [player.names])
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal pt-viewer" onClick={(e) => e.stopPropagation()}>
        <h3>Token erstellen – {isMe ? 'Du' : player.label}</h3>
        <div className="pt-tokform">
          Anzahl <input type="number" min="1" max="50" value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))} />
        </div>
        {list === null && <p className="muted">Lade Token des Decks …</p>}
        {list && list.length > 0 && (
          <div className="pt-vgrid">
            {list.map((t) => (
              <div key={t.id} className="pt-vcard" onClick={() => onMake(t, n)} title={`${t.name} ${t.pt}`}>
                {t.img ? <img src={t.img} alt={t.name} /> : <div className="pt-noimg"><b>{t.name}</b><small>{t.pt}</small></div>}
              </div>
            ))}
          </div>
        )}
        {list && !list.length && <p className="muted">Für dieses Deck sind keine Token bekannt.</p>}
        <h4>Eigener Token</h4>
        <form className="pt-tokform" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onMake({ name: name.trim(), pt: pt.trim(), type: pt.trim() ? 'Token Creature' : 'Token' }, n) }}>
          <input placeholder="Name, z. B. Schatz oder Soldat" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Stärke/Widerstand (leer = keine Kreatur)" value={pt} onChange={(e) => setPt(e.target.value)} style={{ width: 120 }} />
          <button className="btn primary" disabled={!name.trim()}>Erstellen</button>
        </form>
        <div className="modal-actions"><button className="btn" onClick={onClose}>Abbrechen</button></div>
      </div>
    </div>
  )
}

function EndDialog({ game, pname, onClose, onSave, onDiscard }) {
  const me = game.players.find((p) => p.id === (game.me ?? 0))
  const [result, setResult] = useState(me.life <= 0 ? 'loss' : game.players.filter((p) => p !== me).every((p) => p.life <= 0) ? 'win' : null)
  const [note, setNote] = useState('')
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal pt-viewer pt-end" onClick={(e) => e.stopPropagation()}>
        <h3>Testspiel beenden</h3>
        <p className="muted">Zug {game.turn} · {game.players.map((p) => `${pname(p)} ${p.life}`).join(' · ')}</p>
        <div className="pt-results">
          {[['win', 'Gewonnen'], ['loss', 'Verloren'], ['draw', 'Abgebrochen / offen']].map(([k, l]) => (
            <button key={k} className={`btn ${result === k ? 'primary' : ''}`} onClick={() => setResult(k)}>{l}</button>
          ))}
        </div>
        <textarea rows={3} placeholder="Notiz (optional), z. B. „zu wenig Removal gezogen“" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%', marginTop: 10 }} />
        <div className="modal-actions">
          <button className="btn" onClick={onDiscard}>Ohne Speichern beenden</button>
          <button className="btn" onClick={onClose}>Weiterspielen</button>
          <button className="btn primary" disabled={!result} onClick={() => onSave(result, note)}>Ergebnis speichern</button>
        </div>
      </div>
    </div>
  )
}
