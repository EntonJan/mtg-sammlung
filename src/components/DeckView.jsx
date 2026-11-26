import { useCallback, useEffect, useMemo, useState } from 'react'
import { dragProps, readDrag } from '../drag'
import { entryKey } from '../store'
import { COLOR_NAMES, FINISH_LABEL, GROUPS, groupOf, unitPrice, euro } from '../util'
import Mana from './Mana'
import DeckStats from './DeckStats'
import DeckHand from './DeckHand'
import DeckPlaytest from './DeckPlaytest'
import DeckCompare from './DeckCompare'
import DeckExport from './DeckExport'
import CollectionView from './CollectionView'
import AddCards from './AddCards'
import DeckImport from './DeckImport'
import PrintPicker from './PrintPicker'
import DeckCombos from './DeckCombos'
import DeckSuggest from './DeckSuggest'
import DeckBracket from './DeckBracket'
import DeckHistory from './DeckHistory'
import DeckTokens from './DeckTokens'
import DeckSynergy from './DeckSynergy'
import DeckFetch from './DeckFetch'
import CommanderPool from './CommanderPool'
import DeckCategories, { TagPicker } from './DeckCategories'
import { catsOf, tagKey } from '../categories'
import { activeModuleOf, colorIdentity, combinedDeck, coreOf, creatureTypes, deckLabel, isCore, isModule, mainCount, moduleBonus, modulesOf, playableDecks, topCreatureTypes } from '../konsole'

const isBasic = (c) => /Basic Land/.test(c.type) || /A deck can have any number/.test(c.text || '')

const TAB_GROUPS = [
  ['Bauen', [['list', 'Liste'], ['new', '+ Neue Karten'], ['cats', 'Kategorien']]],
  ['Analyse', [['stats', 'Statistik'], ['synergy', 'Synergie'], ['combos', 'Combos'], ['suggest', 'Vorschläge']]],
  ['Spielen', [['hand', 'Probehand'], ['play', 'Testspiel'], ['tokens', 'Token']]],
  ['Mehr', [['history', 'Verlauf'], ['compare', 'Vergleich'], ['export', 'Export']]],
]

// Analyse-Reiter: bekommen bei Konsolen das kombinierte Deck (Core + Modul)
const ANALYSIS = ['stats', 'synergy', 'combos', 'suggest', 'hand', 'play', 'tokens', 'compare', 'export']

// Ein Deck in Zeilen aufteilen: Hauptdeck, Sideboard, Commander, Pool, Rest, Farbidentität
function splitDeck(d, cards) {
  const allRows = Object.values(d?.entries || {})
    .filter((e) => cards[e.id])
    .map((e) => ({ ...e, key: entryKey(e.id, e.finish), card: cards[e.id], price: unitPrice(cards[e.id], e.finish) }))
    .sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name))
  const sideKeys = new Set(d?.side || [])
  const rows = allRows.filter((r) => !sideKeys.has(r.key))
  const sideRows = allRows.filter((r) => sideKeys.has(r.key))
  const cmdKeys = new Set(d?.commanders || [])
  const poolKeys = new Set(d?.pool || [])
  const commanders = rows.filter((r) => cmdKeys.has(r.key))
  const rest = rows.filter((r) => !cmdKeys.has(r.key) && !poolKeys.has(r.key))
  const poolRest = rows.filter((r) => poolKeys.has(r.key) && !cmdKeys.has(r.key))
  // Farbidentität: aktive Commander + alle Pool-Commander (das Deck muss zu jeder Kombination passen)
  const identity = [...new Set([...commanders, ...poolRest].flatMap((r) => r.card.ci))]
  const count = rows.reduce((t, r) => t + r.qty, 0)
  return { allRows, rows, sideRows, sideKeys, cmdKeys, poolKeys, commanders, rest, poolRest, identity, count }
}

// Commander-Hinweise: Singleton (außer Standardländer / „beliebig viele“) und Farbidentität
function deckWarnings(P) {
  const warnings = []
  const byName = {}
  for (const r of P.rows) byName[r.card.name] = (byName[r.card.name] || 0) + r.qty
  const dupes = Object.entries(byName).filter(([n, q]) => q > 1 && !isBasic(P.rows.find((r) => r.card.name === n).card))
  if (dupes.length) warnings.push(`Mehrfach im Deck: ${dupes.map(([n, q]) => `${n} (${q}×)`).join(', ')}`)
  if (P.commanders.length) {
    const off = P.rest.filter((r) => r.card.ci.some((c) => !P.identity.includes(c)))
    if (off.length) warnings.push(`Außerhalb der Farbidentität: ${off.map((r) => r.card.name).join(', ')}`)
  }
  return warnings
}

// Typgruppen (+ Unterkategorien aus den Deck-Kategorien)
function groupRows(rows, d, subOn) {
  const m = {}
  for (const r of rows) (m[groupOf(r.card.type)] ||= []).push(r)
  const cats = catsOf(d).map((c) => c.name)
  const tags = d.tags || {}
  // Jede Karte landet in genau einer Unterkategorie: der ersten zugeordneten (Reihenfolge wie im Reiter „Kategorien“)
  const subsOf = (list) => {
    const sm = {}
    for (const r of list) {
      const t = tags[tagKey(r.card)] || []
      const first = cats.find((c) => t.includes(c)) || t[0] || '__none'
      ;(sm[first] ||= []).push(r)
    }
    const order = [...cats, ...Object.keys(sm).filter((k) => k !== '__none' && !cats.includes(k)), '__none']
    const out = order.filter((k) => sm[k]).map((k) => ({ k, label: k === '__none' ? 'Ohne Kategorie' : k, rows: sm[k] }))
    return out.length === 1 && out[0].k === '__none' ? null : out
  }
  return GROUPS.filter(([k]) => m[k]).map(([k, label]) => ({ k, label, rows: m[k], subs: subOn ? subsOf(m[k]) : null }))
}

const nameSet = (rows) => new Set(rows.filter((r) => !isBasic(r.card)).map((r) => r.card.name))

export default function DeckView({ deck, decks, cards, entries, onMove, onMoveMany, deNames, reserved, reconcilePreview, onReconcile, onRename, onDelete, onToggleCommander, onOpen, onUpdate, onAddNew, onImportDeck, onChangePrinting, onRestoreVersion, onShare, uid, myName, onAddResult,
  onUpdateAny, onAddNewAny, onChangePrintingAny, onOpenDeck, onCreateModule, onDuplicateModule, onDeleteDeck, onConvertCore, onAttachModule }) {
  const [printRow, setPrintRow] = useState(null)
  const [newQuery, setNewQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(deck.name)
  const [over, setOver] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [recon, setRecon] = useState(null)
  const [reconAny, setReconAny] = useState(false)
  const [tab, setTab] = useState('list')
  const [actOpen, setActOpen] = useState(false)
  const [compact, setCompact] = useState(false)
  useEffect(() => { if (!actOpen) return; const c = () => setActOpen(false); window.addEventListener('click', c); return () => window.removeEventListener('click', c) }, [actOpen])
  // Hauptgruppen immer nach Kartentyp; Unterkategorien (Removal, Ramp, Draw …) zuschaltbar
  const [subOn, setSubOnState] = useState(() => { try { return localStorage.getItem('deckSubs') !== '0' } catch { return true } })
  const setSubOn = (v) => { setSubOnState(v); try { localStorage.setItem('deckSubs', v ? '1' : '0') } catch { /* egal */ } }
  const [mode, setModeState] = useState(() => { try { return localStorage.getItem('deckMode') || 'list' } catch { return 'list' } })
  const setMode = (m) => { setModeState(m); try { localStorage.setItem('deckMode', m) } catch { /* egal */ } }
  const [picker, setPicker] = useState(null)
  const [builder, setBuilder] = useState(() => { try { return localStorage.getItem('builder') === '1' } catch { return false } })
  const toggleBuilder = () => setBuilder((b) => { try { localStorage.setItem('builder', b ? '0' : '1') } catch { /* egal */ } return !b })
  // Konsole: Ziel für Hinzufügen (Core oder eingelegtes Modul), Export-Quelle, Kreaturentyp-Filter, Modul-Zuordnung
  const [addTo, setAddTo] = useState('core')
  const [exportSrc, setExportSrc] = useState('all')
  const [ctype, setCtype] = useState('')
  const [attach, setAttach] = useState(null) // { coreId, mode }

  // ---- Konsole / Modul ----
  const isCoreDeck = isCore(deck)
  const isMod = isModule(deck)
  const core = coreOf(decks, deck)             // Konsole (bei Modulen: die eigene, falls vorhanden)
  const mods = useMemo(() => (core ? modulesOf(decks, core.id) : []), [decks, core])
  const slotMod = isCoreDeck ? activeModuleOf(decks, deck) : null
  const inserted = isMod && core ? core.activeModule === deck.id : false
  // Analyse-Deck: Konsole + eingelegtes Modul bzw. Modul + seine Konsole (virtuell, wird nie gespeichert)
  const aDeck = useMemo(() => ((isCoreDeck && slotMod) || (isMod && core) ? combinedDeck(deck, decks) : deck), [deck, decks, isCoreDeck, isMod, slotMod, core])
  const combined = aDeck !== deck

  const P = useMemo(() => splitDeck(deck, cards), [deck, cards])
  const A = useMemo(() => (combined ? splitDeck(aDeck, cards) : P), [combined, aDeck, cards, P])
  const M = useMemo(() => (slotMod ? splitDeck(slotMod, cards) : null), [slotMod, cards])
  const C = useMemo(() => (isMod && core ? splitDeck(core, cards) : null), [isMod, core, cards])
  const { allRows, rows, sideRows, sideKeys, commanders, rest, poolRest } = P
  const sideCount = sideRows.reduce((t, r) => t + r.qty, 0)
  const identity = A.identity

  // Ziel beim Hinzufügen (Schnell-+, Ziehen in die Deckfläche, „Karte holen“)
  const targetId = isCoreDeck && slotMod && addTo === 'mod' ? slotMod.id : deck.id
  const targetDeck = decks[targetId] || deck
  const bonus = useMemo(() => (isModule(targetDeck) ? moduleBonus(decks, targetId) : null), [decks, targetDeck, targetId])

  // Besitz je Oracle-ID: freie Exemplare in der Sammlung + Decks/Ordner, in denen die Karte steckt
  const ownedIndex = useMemo(() => {
    const idx = {}
    const byName = {}
    const get = (c) => {
      const o = (idx[c.oracleId] ||= { free: 0, decks: [], pick: null, img: c.img, oracleId: c.oracleId })
      byName[c.name.toLowerCase()] = o
      byName[c.name.split(' // ')[0].toLowerCase()] = o
      return o
    }
    for (const e of Object.values(entries)) { const c = cards[e.id]; if (c) { const o = get(c); o.free += e.qty; o.pick ||= { id: e.id, finish: e.finish } } }
    for (const d of Object.values(decks)) {
      const label = deckLabel(d, decks)
      for (const e of Object.values(d.entries)) { const c = cards[e.id]; if (c) { const o = get(c); if (!o.decks.includes(label)) o.decks.push(label) } }
    }
    return { idx, byName }
  }, [entries, decks, cards])
  const NONE = useMemo(() => ({ free: 0, decks: [] }), [])
  const owned = useCallback((oid) => ownedIndex.idx[oid] || NONE, [ownedIndex, NONE])
  const ownedByName = useCallback((n) => ownedIndex.byName[n.toLowerCase()] || NONE, [ownedIndex, NONE])
  const toggleSide = (key) => onUpdate({ side: sideKeys.has(key) ? [...sideKeys].filter((k) => k !== key) : [...sideKeys, key] })
  // Karte (oder Mehrfachauswahl) ins Sideboard legen – auch direkt aus der Sammlung oder einem anderen Deck
  const dropToSide = (d) => {
    const items = d.multi || [d]
    if (items.some((x) => x.from !== deck.id)) onMove(d, deck.id)
    onUpdate({ side: [...new Set([...sideKeys, ...items.map((x) => entryKey(x.id, x.finish))])] })
  }

  const poolKeys = P.poolKeys
  const togglePool = (key) => onUpdate({ pool: poolKeys.has(key) ? [...poolKeys].filter((k) => k !== key) : [...poolKeys, key] })

  const groups = useMemo(() => groupRows(rest, deck, subOn), [rest, subOn, deck])
  const modGroups = useMemo(() => (M ? groupRows(M.rows, slotMod, subOn) : []), [M, slotMod, subOn])

  const count = P.count
  const value = allRows.reduce((s, r) => s + (r.price ?? 0) * r.qty, 0)

  // Hinweise: bei Konsolen für das kombinierte Deck (Singleton über Core + Modul)
  const warnings = deckWarnings(A)
  // „auch im Core“: Karten, die in Core UND Modul liegen
  const coreNames = useMemo(() => (isCoreDeck && M ? nameSet(rows) : C ? nameSet(C.rows) : null), [isCoreDeck, M, C, rows])
  const modNames = useMemo(() => (M ? nameSet(M.rows) : null), [M])

  // Kreaturentypen der Sammlung für den Filter im Deckbau-Modus
  const typeList = useMemo(() => {
    if (!builder || !(isCoreDeck || isMod)) return []
    const m = {}
    const seen = new Set()
    for (const k of [...Object.keys(entries), ...Object.keys(reserved || {})]) {
      const c = cards[k.split('|')[0]]
      if (!c || seen.has(c.oracleId)) continue
      seen.add(c.oracleId)
      for (const t of creatureTypes(c.type)) m[t] = (m[t] || 0) + 1
    }
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]))
  }, [builder, isCoreDeck, isMod, entries, reserved, cards])

  const save = () => { setEditing(false); if (name.trim() && name.trim() !== deck.name) onRename(name.trim()) }
  const plainDeck = !isCoreDeck && !isMod && deck.kind !== 'binder'
  const cores = Object.values(decks).filter(isCore).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  // Decks für Testspiel/Vergleich: Konsolen kombiniert, Module nicht einzeln
  const playDecks = useMemo(() => ({ ...playableDecks(decks), [aDeck.id]: aDeck }), [decks, aDeck])

  // Export: kombiniert oder nur Core / nur Modul
  const exp = useMemo(() => {
    if (!combined || exportSrc === 'all') return { deck: aDeck, P: A }
    const coreDeck = isCoreDeck ? deck : core
    const modDeck = isCoreDeck ? slotMod : deck
    const d = exportSrc === 'core' ? coreDeck : modDeck
    return { deck: d, P: exportSrc === 'core' ? (isCoreDeck ? P : C) : (isCoreDeck ? M : P) }
  }, [combined, exportSrc, aDeck, A, isCoreDeck, deck, core, slotMod, P, C, M])

  const modCount = slotMod ? M.count : 0
  const total = combined ? A.count : count
  const totalChip = <span className={`k-chip ${total === 100 ? 'ok' : 'amber'}`}>{total === 100 ? '✓ 100 Karten' : `${total}/100`}</span>

  return (
    <div className={`deck-split ${builder ? 'builder' : ''}`}>
    <div
      className={`deck ${over ? 'over' : ''}`}
      onScroll={(e) => { const c = e.currentTarget.scrollTop > 90; if (c !== compact) setCompact(c) }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-mtg-card')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false) }}
      onDrop={(e) => { e.preventDefault(); setOver(false); const d = readDrag(e); if (d && d.from !== targetId) onMove(d, targetId) }}
    >
      <div className={`deck-top ${compact ? 'compact' : ''} ${tab === 'play' ? 'no-stick' : ''}`}>
      {isMod && core && (
        <div className="k-crumb">
          <button className="linklike" onClick={() => onOpenDeck(core.id)}>🎮 {core.name}</button>
          <span className="muted">›</span>
          <span>💾 {deck.name}</span>
        </div>
      )}
      <div className={`deck-head ${isCoreDeck || isMod ? 'k-head' : ''}`}>
        {editing ? (
          <input className="deck-title-input" value={name} autoFocus onChange={(e) => setName(e.target.value)}
            onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} />
        ) : (
          <h2 onClick={() => { setName(deck.name); setEditing(true) }} title="Klicken zum Umbenennen">{isCoreDeck ? '🎮 ' : isMod ? '💾 ' : ''}{deck.name}</h2>
        )}
        <div className="deck-stats">
          {isCoreDeck ? (
            <><span className="k-sum">Core <b>{count}</b> + Modul <b>{modCount}</b> = <b>{count + modCount}</b></span><span className="k-sum">{totalChip}{sideCount > 0 && <span className="muted"> (+{sideCount} Sideboard)</span>}</span></>
          ) : isMod && core ? (
            <><span className="k-sum">Modul <b>{count}</b> · mit Core = <b>{total}</b></span><span className="k-sum">{totalChip}</span></>
          ) : (
            <span className={count === 100 ? 'ok' : ''}><b>{count}</b>/100 Karten{sideCount > 0 && <span className="muted"> (+{sideCount} Sideboard)</span>}</span>
          )}
          <span className="ds-more">Wert <b>{euro(value)}</b></span>
          {identity.length > 0 && <span className="ds-more">Farbidentität <b>{identity.map((c) => COLOR_NAMES[c]).join(', ')}</b></span>}
        </div>
        <div className="deck-actions">
          {isMod && core && (inserted
            ? <button className="btn small active" onClick={() => onUpdateAny(core.id, { activeModule: null })} title="Modul aus der Konsole nehmen">⏏ Auswerfen</button>
            : <button className="btn small primary" onClick={() => onUpdateAny(core.id, { activeModule: deck.id })}>In die Konsole einlegen</button>)}
          <button className={`btn small ${builder ? 'active' : ''} hide-m`} onClick={toggleBuilder} title="Sammlung daneben einblenden">
            {builder ? 'Deckbau-Modus aus' : 'Deckbau-Modus'}
          </button>
          <button className={`btn small ${(isMod ? core?.shareId : deck.shareId) ? 'active' : ''}`} onClick={onShare} title={isMod ? 'Geteilt wird die Konsole mit eingelegtem Modul' : deck.shareId ? 'Wird geteilt – Link anzeigen' : 'Nur-Lesen-Link erstellen'}>{(isMod ? core?.shareId : deck.shareId) ? 'Geteilt ✓' : 'Teilen'}</button>
          <div className="menu-wrap">
            <button className="btn small" onClick={(e) => { e.stopPropagation(); setActOpen((o) => !o) }} aria-expanded={actOpen} title="Weitere Aktionen">⋯</button>
            {actOpen && (
              <div className="drop-menu" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => { setActOpen(false); setEditing(true); setName(deck.name) }}>Umbenennen</button>
                {!isMod && <button onClick={() => { setActOpen(false); setRecon(reconcilePreview(reconAny)) }}>Mit Sammlung abgleichen</button>}
                <button className="show-m" onClick={() => { setActOpen(false); toggleBuilder() }}>{builder ? 'Deckbau-Modus aus' : 'Deckbau-Modus'}</button>
                {plainDeck && <button onClick={() => { setActOpen(false); onConvertCore() }}>🎮 In Konsole umwandeln</button>}
                {plainDeck && <button onClick={() => { setActOpen(false); setAttach({ coreId: cores[0]?.id || '', mode: 'core' }) }}>💾 Als Modul einer Konsole zuordnen …</button>}
                {isMod && core && <button onClick={() => { setActOpen(false); onOpenDeck(core.id) }}>🎮 Zur Konsole (Spieleregal)</button>}
                <button className="danger" onClick={() => { setActOpen(false); setConfirmDel(true) }}>{isCoreDeck ? 'Konsole auflösen …' : isMod ? 'Modul löschen …' : 'Deck auflösen …'}</button>
              </div>
            )}
          </div>
        </div>
      </div>
      {confirmDel && (isCoreDeck && mods.length ? (
        <div className="confirm-bar">
          <span>Konsole „{deck.name}“ auflösen? Die {count} Core-Karten gehen zurück in die Sammlung. Was soll mit den {mods.length} Modulen passieren? Mit ↶ lässt sich das rückgängig machen.</span>
          <button className="btn small danger" onClick={() => onDelete({ modules: 'delete' })}>Module mitlöschen</button>
          <button className="btn small" onClick={() => onDelete({ modules: 'detach' })}>Module zu normalen Decks machen</button>
          <button className="btn small ghost" onClick={() => setConfirmDel(false)}>Abbrechen</button>
        </div>
      ) : (
        <div className="confirm-bar">
          <span>{isMod
            ? <>Modul „{deck.name}“ löschen? Karten, die kein anderes Modul dieser Konsole braucht, gehen zurück in die Sammlung. Mit ↶ lässt sich das rückgängig machen.</>
            : <>{isCoreDeck ? 'Konsole' : 'Deck'} „{deck.name}“ auflösen? Alle {count} Karten gehen zurück in die Sammlung, das Deck wird gelöscht. Mit ↶ lässt sich das rückgängig machen.</>}</span>
          <button className="btn small danger" onClick={() => onDelete()}>{isMod ? 'Ja, löschen' : 'Ja, auflösen'}</button>
          <button className="btn small ghost" onClick={() => setConfirmDel(false)}>Abbrechen</button>
        </div>
      ))}
      {attach && (
        <div className="recon k-attach">
          {cores.length ? <>
            <span>„{deck.name}“ als Modul zuordnen zu
              <select value={attach.coreId} onChange={(e) => setAttach({ ...attach, coreId: e.target.value })} style={{ marginLeft: 8 }}>
                {cores.map((c) => <option key={c.id} value={c.id}>🎮 {c.name}</option>)}
              </select>
            </span>
            {commanders.length > 0 && <>
              <p className="warn">Module haben keinen eigenen Commander – der Commander gehört in den Core. „{commanders.map((r) => r.card.name).join(' & ')}“:</p>
              <label className="check-line small"><input type="radio" checked={attach.mode === 'core'} onChange={() => setAttach({ ...attach, mode: 'core' })} /> in den Core verschieben (wird dort Commander)</label>
              <label className="check-line small"><input type="radio" checked={attach.mode === 'drop'} onChange={() => setAttach({ ...attach, mode: 'drop' })} /> Markierung entfernen (Karte bleibt im Modul)</label>
            </>}
            <span className="hand-actions">
              <button className="btn small primary" disabled={!attach.coreId} onClick={() => { onAttachModule(attach.coreId, commanders.length ? attach.mode : 'drop'); setAttach(null) }}>Zuordnen</button>
              <button className="btn small ghost" onClick={() => setAttach(null)}>Abbrechen</button>
            </span>
          </> : <span>Es gibt noch keine Konsole. Lege links eine an (Auswahl „Konsole“) oder wandle ein Deck um. <button className="btn small ghost" onClick={() => setAttach(null)}>OK</button></span>}
        </div>
      )}
      {recon && (
        <div className="recon">
          {recon.count ? (
            <>
              <span>
                <b>{recon.count} Karten</b> ({euro(recon.value)}) aus diesem Deck liegen <b>zusätzlich frei in der Sammlung</b> –
                vermutlich doppelt gezählt (z. B. Deck importiert, obwohl die Karten schon im ManaBox-Export standen).
              </span>
              <label className="check-line small">
                <input type="checkbox" checked={reconAny} onChange={(e) => { setReconAny(e.target.checked); setRecon(reconcilePreview(e.target.checked)) }} />
                auch andere Druckversionen derselben Karte berücksichtigen
              </label>
              <span className="hand-actions">
                <button className="btn small danger" onClick={() => { onReconcile(reconAny); setRecon(null) }}>Aus der Sammlung entfernen</button>
                <button className="btn small ghost" onClick={() => setRecon(null)}>Abbrechen</button>
              </span>
            </>
          ) : (
            <span>Keine doppelten Karten gefunden ✓ <button className="btn small ghost" onClick={() => setRecon(null)}>OK</button></span>
          )}
        </div>
      )}

      <div className="deck-tabs grouped">
        {TAB_GROUPS.map(([g, list]) => (
          <div key={g} className="tab-group">
            <span className="tg-label">{g}</span>
            <div className="tg-btns">
              {list.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
            </div>
          </div>
        ))}
      </div>
      </div>

      {(isCoreDeck || (isMod && core)) && ANALYSIS.includes(tab) && (
        <p className={`k-view ${combined ? '' : 'none'}`}>
          {isMod ? <>Ansicht: <b>Core + dieses Modul</b> ({C.count} + {count} = {total}){!inserted && ' – zum Bewerten, ohne es einzulegen'}</>
            : combined ? <>Ansicht: <b>Core + Modul „{slotMod.name}“</b> ({count} + {modCount} = {total})</>
            : <>Kein Modul eingelegt – die Analyse zeigt nur den Core ({count} Karten).</>}
        </p>
      )}
      {(isCoreDeck || isMod) && ANALYSIS.includes(tab) && warnings.length > 0 && tab !== 'export' && warnings.map((w) => <p key={w} className="warn">{w}</p>)}

      {tab === 'stats' && <><DeckBracket deck={aDeck} commanders={A.commanders.map((r) => r.card)} rows={A.rest} /><DeckStats rows={A.rows} identity={[...new Set(A.commanders.flatMap((r) => r.card.ci || []))]} /></>}
      {tab === 'synergy' && <DeckSynergy commanders={A.commanders} rows={[...A.rest, ...A.poolRest]} onOpen={onOpen} />}
      {tab === 'tokens' && <DeckTokens rows={[...A.commanders, ...A.rest, ...A.poolRest]} />}
      {tab === 'history' && <DeckHistory deck={deck} cards={cards} onUpdate={onUpdate} onRestore={onRestoreVersion} />}
      {tab === 'suggest' && <DeckSuggest commanders={A.commanders.map((r) => r.card)} rows={[...A.rest, ...A.poolRest]} ownedByName={ownedByName} deNames={deNames}
        onTake={(pick) => onMove({ ...pick, from: 'collection' }, targetId)} />}
      {tab === 'combos' && <DeckCombos deck={aDeck} commanders={A.commanders.map((r) => r.card)} rows={A.rest} owned={owned} deNames={deNames}
        onTake={(pick) => onMove({ ...pick, from: 'collection' }, targetId)} />}
      {tab === 'hand' && <DeckHand key={`${aDeck.id}|${A.count}`} deck={aDeck} rows={A.rows} commanderKeys={A.cmdKeys} onOpen={onOpen} onPlay={() => setTab('play')} />}
      {tab === 'compare' && <DeckCompare deck={aDeck} decks={playDecks} cards={cards} onOpen={onOpen} />}
      {tab === 'play' && <DeckPlaytest deck={aDeck} decks={playDecks} cards={cards} uid={uid} myName={myName} onUpdate={onUpdate} onAddResult={onAddResult} />}
      {tab === 'export' && <>
        {combined && (
          <div className="seg seg-small k-export-src">
            <button className={exportSrc === 'all' ? 'on' : ''} onClick={() => setExportSrc('all')}>Core + Modul ({total})</button>
            <button className={exportSrc === 'core' ? 'on' : ''} onClick={() => setExportSrc('core')}>Nur Core ({isCoreDeck ? count : C.count})</button>
            <button className={exportSrc === 'mod' ? 'on' : ''} onClick={() => setExportSrc('mod')}>Nur Modul ({isCoreDeck ? modCount : count})</button>
          </div>
        )}
        <DeckExport key={exportSrc} deck={exp.deck} rows={exp.P.rows} sideRows={exp.P.sideRows} commanderKeys={exp.P.cmdKeys} />
      </>}
      {tab === 'new' && (
        <div className="deck-new">
          <p className="muted small">
            Für Karten, die in deinem echten Deck stecken, aber noch nicht in der App sind: Alles hier wird als <b>neues Exemplar</b> in „{deck.name}“ gelegt
            und zählt damit automatisch zu deiner Sammlung (dort als „in Deck“). „−“ nimmt ein hier hinzugefügtes Exemplar wieder ganz heraus.
          </p>
          <h3>Karte suchen</h3>
          <AddCards key={newQuery} initialQuery={newQuery} entries={deck.entries} onChange={(c, f, d) => onAddNew(c, f, d)}
            placeholder="Neue Karte für Deck + Sammlung suchen …" />
          <DeckImport decks={decks} fixedDeck={deck} onImportDeck={onImportDeck} />
        </div>
      )}
      {tab === 'cats' && <DeckCategories deck={deck} rows={rows} onUpdate={onUpdate} />}

      {tab === 'list' && <>
      {isCoreDeck && (
        <Slot mod={slotMod} M={M} core={deck} coreCount={count} cards={cards}
          onInsert={(id) => onUpdate({ activeModule: id })} onEject={() => onUpdate({ activeModule: null })} onOpenDeck={onOpenDeck} />
      )}
      <CommanderPool deck={deck} rows={rows} onUpdate={onUpdate} onOpen={onOpen} />
      <DeckFetch deck={targetDeck} entries={entries} decks={decks} cards={cards} onMove={onMove} deNames={deNames} onNew={(q) => { setNewQuery(q); setTab('new') }} />
      {rows.length + modCount > 0 && (
        <div className="seg seg-small">
          <button className={!subOn ? 'on' : ''} onClick={() => setSubOn(false)}>Nur Typen</button>
          <button className={subOn ? 'on' : ''} onClick={() => setSubOn(true)} title="Innerhalb der Typen nach Removal, Ramp, Draw … unterteilen">Typen + Unterkategorien</button>
        </div>
      )}
      {rows.length + modCount > 0 && (
        <div className="seg seg-small" style={{ marginLeft: 8 }}>
          <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>Liste</button>
          <button className={mode === 'grid' ? 'on' : ''} onClick={() => setMode('grid')}>Stapel</button>
          <button className={mode === 'raster' ? 'on' : ''} onClick={() => setMode('raster')}>Raster</button>
        </div>
      )}
      {warnings.map((w) => <p key={w} className="warn">{w}</p>)}

      {!rows.length && (
        <div className="deck-empty">
          {isCoreDeck ? 'Ziehe Karten aus der Sammlung in den Core – hier hinein oder links auf den Namen der Konsole.'
            : isMod ? 'Ziehe Karten aus der Sammlung in dieses Modul – hier hinein oder links auf den Modulnamen.'
            : 'Ziehe Karten aus der Sammlung auf dieses Deck – hier hinein oder links auf den Decknamen.'}
        </div>
      )}

      {(() => {
        // Gemeinsame Props für Kartengruppen; Module haben keinen eigenen Commander
        const base = { onPrint: (r) => setPrintRow({ ...r, deckId: deck.id }), onAddNew, deck, togglePool, onMove, onToggleCommander, onOpen, picker, setPicker, onUpdate, grid: mode === 'grid', raster: mode === 'raster', toggleSide, sideKeys, noCmd: isMod,
          dupNames: isCoreDeck ? modNames : coreNames, dupLabel: isCoreDeck ? 'auch im Modul' : 'auch im Core' }
        return (
          <div className={mode === 'grid' ? 'deck-stacks' : mode === 'raster' ? 'deck-raster' : 'deck-cols'}>
            {poolRest.length > 0 && <Group {...base} gk="pool" label="Commander-Pool (inaktiv)" rows={poolRest} />}
            {commanders.length > 0 && <Group {...base} label="Commander" rows={commanders} cmd />}
            {groups.map((g) => <Group {...base} key={g.k} gk={g.k} label={g.label} rows={g.rows} subs={g.subs} />)}
            {rows.length + sideRows.length > 0 && <Group {...base} gk="side" label="Sideboard" rows={sideRows} onDropHere={dropToSide} />}
          </div>
        )
      })()}

      {isCoreDeck && slotMod && (
        <ModBlock mod={slotMod} count={modCount} onMove={onMove} onOpenDeck={onOpenDeck}>
          {(() => {
            const sk = new Set(slotMod.side || [])
            const base = {
              deck: slotMod, noCmd: true, onMove, onOpen, picker, setPicker,
              onPrint: (r) => setPrintRow({ ...r, deckId: slotMod.id }),
              onAddNew: (c, f, d) => onAddNewAny(slotMod.id, c, f, d),
              onUpdate: (patch) => onUpdateAny(slotMod.id, patch),
              togglePool: () => {}, onToggleCommander: () => {},
              toggleSide: (key) => onUpdateAny(slotMod.id, { side: sk.has(key) ? [...sk].filter((k) => k !== key) : [...sk, key] }),
              sideKeys: sk, grid: mode === 'grid', raster: mode === 'raster', dupNames: coreNames, dupLabel: 'auch im Core',
            }
            return (
              <div className={mode === 'grid' ? 'deck-stacks' : mode === 'raster' ? 'deck-raster' : 'deck-cols'}>
                {modGroups.map((g) => <Group {...base} key={'m' + g.k} gk={'m' + g.k} label={g.label} rows={g.rows} subs={g.subs} />)}
                {M.sideRows.length > 0 && <Group {...base} gk="mside" label="Sideboard (Modul)" rows={M.sideRows} />}
                {!M.rows.length && !M.sideRows.length && <p className="muted small">Das Modul ist leer – zieh Karten hierher.</p>}
              </div>
            )
          })()}
        </ModBlock>
      )}

      {isCoreDeck && (
        <Shelf core={deck} mods={mods} decks={decks} cards={cards} coreCount={count} active={slotMod?.id}
          onInsert={(id) => onUpdate({ activeModule: id })} onOpenDeck={onOpenDeck}
          onRename={(id, n) => onUpdateAny(id, { name: n })} onDuplicate={onDuplicateModule}
          onDelete={(id) => onDeleteDeck(id, { stay: true })} onCreate={onCreateModule} />
      )}
      </>}
    </div>
    {printRow && (
      <PrintPicker row={printRow} entries={entries} onClose={() => setPrintRow(null)}
        onApply={(card, finish, qty, mode) => {
          if (printRow.deckId && printRow.deckId !== deck.id) onChangePrintingAny(printRow.deckId, { id: printRow.id, finish: printRow.finish }, card, finish, qty, mode)
          else onChangePrinting({ id: printRow.id, finish: printRow.finish }, card, finish, qty, mode)
          setPrintRow(null)
        }} />
    )}
    {builder && (
      <aside className="builder-pane">
        <div className="builder-head">
          <b>Sammlung</b>
          {isCoreDeck && slotMod && (
            <span className="seg seg-small k-target" title="Wohin + und Ziehen die Karte legen">
              <span className="muted small">Ziel:</span>
              <button className={addTo === 'core' ? 'on' : ''} onClick={() => setAddTo('core')}>🎮 Core</button>
              <button className={addTo === 'mod' ? 'on' : ''} onClick={() => setAddTo('mod')}>💾 Modul</button>
            </span>
          )}
          {typeList.length > 0 && (
            <label className="k-ctype small">Kreaturentyp:
              <select value={ctype} onChange={(e) => setCtype(e.target.value)}>
                <option value="">alle</option>
                {typeList.map(([t, n]) => <option key={t} value={t}>{t} ({n})</option>)}
              </select>
            </label>
          )}
          <span className="muted small">
            {identity.length ? `nur Farbidentität ${identity.join('')} · ` : 'kein Commander gesetzt – alle Farben · '}
            + oder Ziehen legt 1 Exemplar {targetId === deck.id ? (isCoreDeck ? 'in den Core' : isMod ? 'ins Modul' : 'ins Deck') : `ins Modul „${targetDeck.name}“`}
          </span>
        </div>
        <CollectionView
          entries={entries} cards={cards} onOpen={onOpen}
          identity={identity.length ? identity : null}
          onQuickAdd={(r) => onMove({ id: r.id, finish: r.finish, from: 'collection' }, targetId)}
          decks={{ [targetId]: targetDeck }} onMoveMany={onMoveMany} deNames={deNames} reserved={reserved}
          bonus={bonus} ctype={ctype || undefined}
        />
      </aside>
    )}
    </div>
  )
}

// Slot der Konsole: eingelegtes Modul oder leerer Steckplatz (Module per Ziehen aus dem Regal einlegen)
function Slot({ mod, M, coreCount, cards, onInsert, onEject, onOpenDeck }) {
  const [over, setOver] = useState(false)
  const n = mod ? M.count : 0
  const ok = coreCount + n === 100
  return (
    <div className={`k-slot ${mod ? 'filled' : 'empty'} ${over ? 'over' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(MOD_DRAG)) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { const id = e.dataTransfer.getData(MOD_DRAG); setOver(false); if (id) { e.preventDefault(); e.stopPropagation(); onInsert(id) } }}>
      <span className="k-slot-label">Slot</span>
      {mod ? <>
        <span className="k-cart on">
          <span className="k-cart-name">💾 {mod.name}</span>
          <span className="muted small">{n} Karten</span>
          <Pips ci={colorIdentity(mod.entries, cards)} />
        </span>
        <span className={`k-chip ${ok ? 'ok' : 'amber'}`}>{ok ? '✓ 100 Karten' : `${coreCount + n}/100`}</span>
        <span className="hand-actions">
          <button className="btn small" onClick={onEject}>⏏ Auswerfen</button>
          <button className="btn small ghost" onClick={() => onOpenDeck(mod.id)}>Öffnen</button>
        </span>
      </> : <span className="muted">Kein Modul eingelegt – zieh eins aus dem Regal</span>}
    </div>
  )
}

const MOD_DRAG = 'application/x-mtg-module'
function Pips({ ci }) {
  if (!ci.length) return <span className="k-pips"><i className="pip pip-C">C</i></span>
  return <span className="k-pips">{ci.map((c) => <i key={c} className={`pip pip-${c}`}>{c}</i>)}</span>
}

// Eingelegtes Modul in der Kartenliste: eigener, klar markierter Block; Ziehen hierher legt Karten ins Modul
function ModBlock({ mod, count, onMove, onOpenDeck, children }) {
  const [over, setOver] = useState(false)
  return (
    <section className={`k-modblock ${over ? 'over' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-mtg-card')) { e.preventDefault(); e.stopPropagation(); setOver(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false) }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); const d = readDrag(e); if (d && d.from !== mod.id) onMove(d, mod.id) }}>
      <h3 className="k-modhead">
        <span>💾 Modul: {mod.name} <span className="muted">({count})</span></span>
        <button className="btn small ghost" onClick={() => onOpenDeck(mod.id)}>Öffnen</button>
      </h3>
      {children}
    </section>
  )
}

// „Spieleregal“: alle Module der Konsole als Kassetten
function Shelf({ core, mods, cards, coreCount, active, onInsert, onOpenDeck, onRename, onDuplicate, onDelete, onCreate }) {
  const [renaming, setRenaming] = useState(null)
  const [rname, setRname] = useState('')
  const [del, setDel] = useState(null)
  const [newName, setNewName] = useState('')
  const create = () => { const n = newName.trim(); if (!n) return; onCreate(n); setNewName('') }
  return (
    <section className="k-shelf">
      <h3 className="k-shelf-head">🗄 Spieleregal <span className="muted">({mods.length} {mods.length === 1 ? 'Modul' : 'Module'})</span></h3>
      <div className="k-carts">
        {mods.map((m) => {
          const n = mainCount(m)
          const ok = coreCount + n === 100
          const types = topCreatureTypes(m.entries, cards)
          return (
            <div key={m.id} className={`k-cart ${active === m.id ? 'on' : ''} ${ok ? '' : 'bad'}`} draggable
              onDragStart={(e) => { e.dataTransfer.setData(MOD_DRAG, m.id); e.dataTransfer.effectAllowed = 'move' }}
              title={`Core ${coreCount} + Modul ${n} = ${coreCount + n}${ok ? '' : ' – nicht 100'}`}>
              {renaming === m.id ? (
                <input className="k-cart-input" value={rname} autoFocus onChange={(e) => setRname(e.target.value)}
                  onBlur={() => { if (rname.trim()) onRename(m.id, rname.trim()); setRenaming(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null) }} />
              ) : <span className="k-cart-name">💾 {m.name}</span>}
              <span className="k-cart-meta">
                <span className={ok ? 'k-ok' : 'k-bad'}>{n} Karten · {coreCount + n}/100</span>
                <Pips ci={colorIdentity(m.entries, cards)} />
              </span>
              {types.length > 0 && <span className="k-types">{types.map(([t, q]) => <span key={t} className="chip">{t} {q}</span>)}</span>}
              {active === m.id && <span className="k-in">eingelegt</span>}
              {del === m.id ? (
                <span className="k-cart-actions">
                  <span className="small">Löschen?</span>
                  <button className="btn small danger" onClick={() => { setDel(null); onDelete(m.id) }}>Ja</button>
                  <button className="btn small ghost" onClick={() => setDel(null)}>Nein</button>
                </span>
              ) : (
                <span className="k-cart-actions">
                  {active !== m.id && <button className="btn small primary" onClick={() => onInsert(m.id)}>Einlegen</button>}
                  <button className="btn small" onClick={() => onOpenDeck(m.id)}>Öffnen</button>
                  <button className="btn small ghost" onClick={() => { setRenaming(m.id); setRname(m.name) }}>Umbenennen</button>
                  <button className="btn small ghost" onClick={() => onDuplicate(m.id)}>Duplizieren</button>
                  <button className="btn small ghost danger" onClick={() => setDel(m.id)}>Löschen</button>
                </span>
              )}
            </div>
          )
        })}
        {!mods.length && <p className="muted small">Noch keine Module. Lege eins an – z. B. ein Kreaturentyp-Paket für „{core.name}“.</p>}
      </div>
      <form className="k-new" onSubmit={(e) => { e.preventDefault(); create() }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name des neuen Moduls" />
        <button type="submit" className="btn small primary" disabled={!newName.trim()}>+ Neues Modul</button>
      </form>
    </section>
  )
}

function Group({ gk = 'cmd', label, rows, subs, deck, onAddNew, onPrint, cmd, onMove, onToggleCommander, onOpen, picker, setPicker, onUpdate, togglePool, grid, raster, toggleSide, sideKeys, onDropHere, noCmd, dupNames, dupLabel }) {
  const [dropOver, setDropOver] = useState(false)
  // Eigenes Ablageziel (Sideboard): Ziehen hierher legt die Karte ins Sideboard
  const dropZone = onDropHere ? {
    onDragOver: (e) => { if (e.dataTransfer.types.includes('application/x-mtg-card')) { e.preventDefault(); e.stopPropagation(); setDropOver(true) } },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropOver(false) },
    onDrop: (e) => { e.preventDefault(); e.stopPropagation(); setDropOver(false); const d = readDrag(e); if (d) onDropHere(d) },
  } : {}
  const zoneCls = onDropHere ? ` side-zone ${dropOver ? 'over' : ''}` : ''
  const emptyHint = onDropHere && !rows.length && <div className="side-empty-hint">Karten hierher ziehen oder bei einer Karte „SB“ klicken</div>
  const pool = new Set(deck.pool || [])
  const deckId = deck.id
  const tags = deck.tags || {}
  const n = rows.reduce((s, r) => s + r.qty, 0)
  // Module haben keinen eigenen Commander (der liegt im Core)
  const legendary = (r) => !noCmd && (cmd || /Legendary/.test(r.card.type) || /can be your commander/.test(r.card.text || ''))
  const dup = (r) => dupNames?.has(r.card.name) && <span className="chip k-dup" title="Karte liegt in Core und Modul – Commander erlaubt sie nur einmal">⚠ {dupLabel}</span>

  const actions = (r) => (
    <span className="row-actions" onClick={(e) => e.stopPropagation()}>
      {legendary(r) && (
        <button className={`mini ${cmd ? 'on' : ''}`} title={cmd ? 'Kein Commander mehr' : 'Als Commander festlegen'}
          onClick={() => onToggleCommander(r.key)}>★</button>
      )}
      {legendary(r) && (
        <button className={`mini ${pool.has(r.key) ? 'on' : ''}`} title={pool.has(r.key) ? 'Aus Commander-Pool entfernen' : 'In den Commander-Pool (Würfeln)'}
          onClick={() => togglePool(r.key)}>🎲</button>
      )}
      {toggleSide && <button className={`mini ${sideKeys?.has(r.key) ? 'on' : ''}`} title={sideKeys?.has(r.key) ? 'Zurück ins Hauptdeck' : 'Ins Sideboard'} onClick={() => toggleSide(r.key)}>SB</button>}
      <button className="mini" title="Kategorien" onClick={() => setPicker(picker === `${gk}|${r.key}` ? null : `${gk}|${r.key}`)}>🏷</button>
      <button className="mini" title="Printing (Edition/Foil) ändern" onClick={() => onPrint(r)}>⇄</button>
      {onAddNew && <button className="mini" title="Weiteres Exemplar neu hinzufügen (Deck + Sammlung)" onClick={() => onAddNew(r.card, r.finish)}>+</button>}
      {onAddNew && <button className="mini danger" title="1 Exemplar ganz entfernen – aus Deck UND Sammlung (Strg+Z macht es rückgängig)" onClick={() => onAddNew(r.card, r.finish, -1)}>🗑</button>}
      <button className="mini" title="1 Exemplar zurück in die Sammlung"
        onClick={() => onMove({ id: r.id, finish: r.finish, from: deckId }, 'collection')}>↩</button>
    </span>
  )
  // Unterkategorien (Removal, Ramp …) innerhalb einer Typgruppe
  const parts = (render) => subs ? subs.map((sub) => (
    <div key={sub.k} className="deck-sub">
      <h4>{sub.label} <span className="muted">({sub.rows.reduce((t, r) => t + r.qty, 0)})</span></h4>
      {render(sub.rows)}
    </div>
  )) : render(rows)
  const picker_ = (r) => picker === `${gk}|${r.key}` && <TagPicker deck={deck} card={r.card} onUpdate={onUpdate} onClose={() => setPicker(null)} />

  // Raster: alle Karten vollständig nebeneinander
  if (raster) {
    return (
      <section className={`deck-raster-group${zoneCls}`} {...dropZone}>
        <h3>{label} <span className="muted">({n})</span></h3>
        {emptyHint}
        {parts((rs) => <div className="raster">
          {rs.map((r) => (
            <div key={r.key} className={`raster-card ${r.finish !== 'normal' ? 'foiled' : ''} ${picker === `${gk}|${r.key}` ? 'open' : ''}`}
              {...dragProps({ id: r.id, finish: r.finish, from: deckId })} onClick={() => onOpen(r.card)}>
              <img src={r.card.img} alt={r.card.name} loading="lazy" draggable={false} />
              {r.qty > 1 && <span className="raster-qty">{r.qty}×</span>}
              {dupNames?.has(r.card.name) && <span className="k-dup-badge" title={dupLabel}>⚠</span>}
              {actions(r)}
              {picker_(r)}
            </div>
          ))}
        </div>)}
      </section>
    )
  }

  // Bilderansicht wie bei Archidekt: Karten als Stapel, nur die Namenszeile sichtbar, beim Überfahren ganz
  if (grid) {
    return (
      <section className={`deck-stack${zoneCls}`} {...dropZone}>
        <h3>{label} <span className="muted">({n})</span></h3>
        {emptyHint}
        {parts((rs) => <div className="stack">
          {rs.map((r) => (
            <div key={r.key} className={`stack-card ${r.finish !== 'normal' ? 'foiled' : ''} ${picker === `${gk}|${r.key}` ? 'open' : ''}`}
              title={`${r.qty > 1 ? `${r.qty}× ` : ''}${r.card.name}${r.finish !== 'normal' ? ` (${FINISH_LABEL[r.finish]})` : ''}`}
              {...dragProps({ id: r.id, finish: r.finish, from: deckId })} onClick={() => onOpen(r.card)}>
              <img src={r.card.img} alt={r.card.name} loading="lazy" draggable={false} />
              {r.qty > 1 && <span className="stack-qty">{r.qty}×</span>}
              {dupNames?.has(r.card.name) && <span className="k-dup-badge" title={dupLabel}>⚠</span>}
              {actions(r)}
              {picker_(r)}
            </div>
          ))}
        </div>)}
      </section>
    )
  }

  return (
    <section className={`deck-group${zoneCls}`} {...dropZone}>
      <h3>{label} <span className="muted">({n})</span></h3>
      {emptyHint}
      {parts((rs) => rs.map((r) => (
        <div key={r.key} className="deck-row" {...dragProps({ id: r.id, finish: r.finish, from: deckId })} onClick={() => onOpen(r.card)}>
          <span className="qty">{r.qty}</span>
          <img className="thumb" src={r.card.thumb} alt="" loading="lazy" draggable={false} />
          <span className="row-main">
            <span className="row-name">{r.card.name}{r.finish !== 'normal' && <em className="foil">{FINISH_LABEL[r.finish]}</em>}{dup(r)}</span>
            {(tags[tagKey(r.card)] || []).length > 0 && (
              <span className="chips">{tags[tagKey(r.card)].map((t) => <span key={t} className="chip">{t}</span>)}</span>
            )}
          </span>
          <Mana cost={r.card.cost} />
          {actions(r)}
          {picker_(r)}
        </div>
      )))}
    </section>
  )
}
