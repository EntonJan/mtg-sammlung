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

const isBasic = (c) => /Basic Land/.test(c.type) || /A deck can have any number/.test(c.text || '')

const TAB_GROUPS = [
  ['Bauen', [['list', 'Liste'], ['new', '+ Neue Karten'], ['cats', 'Kategorien']]],
  ['Analyse', [['stats', 'Statistik'], ['synergy', 'Synergie'], ['combos', 'Combos'], ['suggest', 'Vorschläge']]],
  ['Spielen', [['hand', 'Probehand'], ['play', 'Testspiel'], ['tokens', 'Token']]],
  ['Mehr', [['history', 'Verlauf'], ['compare', 'Vergleich'], ['export', 'Export']]],
]

export default function DeckView({ deck, decks, cards, entries, onMove, onMoveMany, deNames, reserved, reconcilePreview, onReconcile, onRename, onDelete, onToggleCommander, onOpen, onUpdate, onAddNew, onImportDeck, onChangePrinting, onRestoreVersion, onShare, uid, myName, onAddResult }) {
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

  const allRows = useMemo(() => Object.values(deck.entries)
    .filter((e) => cards[e.id])
    .map((e) => ({ ...e, key: entryKey(e.id, e.finish), card: cards[e.id], price: unitPrice(cards[e.id], e.finish) }))
    .sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name)), [deck.entries, cards])

  // Sideboard: gehört zum Deck (reserviert), zählt aber nicht zu den 100 Karten
  const sideKeys = useMemo(() => new Set(deck.side || []), [deck.side])
  const rows = useMemo(() => allRows.filter((r) => !sideKeys.has(r.key)), [allRows, sideKeys])
  const sideRows = useMemo(() => allRows.filter((r) => sideKeys.has(r.key)), [allRows, sideKeys])
  const sideCount = sideRows.reduce((t, r) => t + r.qty, 0)
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
      for (const e of Object.values(d.entries)) { const c = cards[e.id]; if (c) { const o = get(c); if (!o.decks.includes(d.name)) o.decks.push(d.name) } }
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

  const cmdKeys = new Set(deck.commanders)
  const poolKeys = new Set(deck.pool || [])
  const commanders = rows.filter((r) => cmdKeys.has(r.key))
  const rest = rows.filter((r) => !cmdKeys.has(r.key) && !poolKeys.has(r.key))
  const poolRest = rows.filter((r) => poolKeys.has(r.key) && !cmdKeys.has(r.key))
  const togglePool = (key) => onUpdate({ pool: poolKeys.has(key) ? [...poolKeys].filter((k) => k !== key) : [...poolKeys, key] })

  const groups = useMemo(() => {
    const m = {}
    for (const r of rest) (m[groupOf(r.card.type)] ||= []).push(r)
    const cats = catsOf(deck).map((c) => c.name)
    const tags = deck.tags || {}
    // Jede Karte landet in genau einer Unterkategorie: der ersten zugeordneten (Reihenfolge wie im Reiter „Kategorien“)
    const subsOf = (rows) => {
      const sm = {}
      for (const r of rows) {
        const t = tags[tagKey(r.card)] || []
        const first = cats.find((c) => t.includes(c)) || t[0] || '__none'
        ;(sm[first] ||= []).push(r)
      }
      const order = [...cats, ...Object.keys(sm).filter((k) => k !== '__none' && !cats.includes(k)), '__none']
      const list = order.filter((k) => sm[k]).map((k) => ({ k, label: k === '__none' ? 'Ohne Kategorie' : k, rows: sm[k] }))
      return list.length === 1 && list[0].k === '__none' ? null : list
    }
    return GROUPS.filter(([k]) => m[k]).map(([k, label]) => ({ k, label, rows: m[k], subs: subOn ? subsOf(m[k]) : null }))
  }, [rest, subOn, deck])

  const count = rows.reduce((s, r) => s + r.qty, 0)
  const value = allRows.reduce((s, r) => s + (r.price ?? 0) * r.qty, 0)
  // Farbidentität: aktive Commander + alle Pool-Commander (das Deck muss zu jeder Kombination passen)
  const identity = [...new Set([...commanders, ...poolRest].flatMap((r) => r.card.ci))]

  // Commander-Hinweise: Singleton und Farbidentität
  const warnings = []
  const byName = {}
  for (const r of rows) byName[r.card.name] = (byName[r.card.name] || 0) + r.qty
  const dupes = Object.entries(byName).filter(([n, q]) => q > 1 && !isBasic(rows.find((r) => r.card.name === n).card))
  if (dupes.length) warnings.push(`Mehrfach im Deck: ${dupes.map(([n, q]) => `${n} (${q}×)`).join(', ')}`)
  if (commanders.length) {
    const off = rest.filter((r) => r.card.ci.some((c) => !identity.includes(c)))
    if (off.length) warnings.push(`Außerhalb der Farbidentität: ${off.map((r) => r.card.name).join(', ')}`)
  }

  const save = () => { setEditing(false); if (name.trim() && name.trim() !== deck.name) onRename(name.trim()) }

  return (
    <div className={`deck-split ${builder ? 'builder' : ''}`}>
    <div
      className={`deck ${over ? 'over' : ''}`}
      onScroll={(e) => { const c = e.currentTarget.scrollTop > 90; if (c !== compact) setCompact(c) }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-mtg-card')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false) }}
      onDrop={(e) => { e.preventDefault(); setOver(false); const d = readDrag(e); if (d && d.from !== deck.id) onMove(d, deck.id) }}
    >
      <div className={`deck-top ${compact ? 'compact' : ''} ${tab === 'play' ? 'no-stick' : ''}`}>
      <div className="deck-head">
        {editing ? (
          <input className="deck-title-input" value={name} autoFocus onChange={(e) => setName(e.target.value)}
            onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} />
        ) : (
          <h2 onClick={() => { setName(deck.name); setEditing(true) }} title="Klicken zum Umbenennen">{deck.name}</h2>
        )}
        <div className="deck-stats">
          <span className={count === 100 ? 'ok' : ''}><b>{count}</b>/100 Karten{sideCount > 0 && <span className="muted"> (+{sideCount} Sideboard)</span>}</span>
          <span className="ds-more">Wert <b>{euro(value)}</b></span>
          {identity.length > 0 && <span className="ds-more">Farbidentität <b>{identity.map((c) => COLOR_NAMES[c]).join(', ')}</b></span>}
        </div>
        <div className="deck-actions">
          <button className={`btn small ${builder ? 'active' : ''} hide-m`} onClick={toggleBuilder} title="Sammlung daneben einblenden">
            {builder ? 'Deckbau-Modus aus' : 'Deckbau-Modus'}
          </button>
          <button className={`btn small ${deck.shareId ? 'active' : ''}`} onClick={onShare} title={deck.shareId ? 'Wird geteilt – Link anzeigen' : 'Nur-Lesen-Link erstellen'}>{deck.shareId ? 'Geteilt ✓' : 'Teilen'}</button>
          <div className="menu-wrap">
            <button className="btn small" onClick={(e) => { e.stopPropagation(); setActOpen((o) => !o) }} aria-expanded={actOpen} title="Weitere Aktionen">⋯</button>
            {actOpen && (
              <div className="drop-menu" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => { setActOpen(false); setEditing(true); setName(deck.name) }}>Umbenennen</button>
                <button onClick={() => { setActOpen(false); setRecon(reconcilePreview(reconAny)) }}>Mit Sammlung abgleichen</button>
                <button className="show-m" onClick={() => { setActOpen(false); toggleBuilder() }}>{builder ? 'Deckbau-Modus aus' : 'Deckbau-Modus'}</button>
                <button className="danger" onClick={() => { setActOpen(false); setConfirmDel(true) }}>Deck auflösen …</button>
              </div>
            )}
          </div>
        </div>
      </div>
      {confirmDel && (
        <div className="confirm-bar">
          <span>Deck „{deck.name}“ auflösen? Alle {count} Karten gehen zurück in die Sammlung, das Deck wird gelöscht. Mit ↶ lässt sich das rückgängig machen.</span>
          <button className="btn small danger" onClick={onDelete}>Ja, auflösen</button>
          <button className="btn small ghost" onClick={() => setConfirmDel(false)}>Abbrechen</button>
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

      {tab === 'stats' && <><DeckBracket deck={deck} commanders={commanders.map((r) => r.card)} rows={rest} /><DeckStats rows={rows} identity={[...new Set(commanders.flatMap((r) => r.card.ci || []))]} /></>}
      {tab === 'synergy' && <DeckSynergy commanders={commanders} rows={[...rest, ...poolRest]} onOpen={onOpen} />}
      {tab === 'tokens' && <DeckTokens rows={[...commanders, ...rest, ...poolRest]} />}
      {tab === 'history' && <DeckHistory deck={deck} cards={cards} onUpdate={onUpdate} onRestore={onRestoreVersion} />}
      {tab === 'suggest' && <DeckSuggest commanders={commanders.map((r) => r.card)} rows={[...rest, ...poolRest]} ownedByName={ownedByName} deNames={deNames}
        onTake={(pick) => onMove({ ...pick, from: 'collection' }, deck.id)} />}
      {tab === 'combos' && <DeckCombos deck={deck} commanders={commanders.map((r) => r.card)} rows={rest} owned={owned} deNames={deNames}
        onTake={(pick) => onMove({ ...pick, from: 'collection' }, deck.id)} />}
      {tab === 'hand' && <DeckHand key={count} deck={deck} rows={rows} commanderKeys={cmdKeys} onOpen={onOpen} onPlay={() => setTab('play')} />}
      {tab === 'compare' && <DeckCompare deck={deck} decks={decks} cards={cards} onOpen={onOpen} />}
      {tab === 'play' && <DeckPlaytest deck={deck} decks={decks} cards={cards} uid={uid} myName={myName} onUpdate={onUpdate} onAddResult={onAddResult} />}
      {tab === 'export' && <DeckExport deck={deck} rows={rows} sideRows={sideRows} commanderKeys={cmdKeys} />}
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
      <CommanderPool deck={deck} rows={rows} onUpdate={onUpdate} onOpen={onOpen} />
      <DeckFetch deck={deck} entries={entries} decks={decks} cards={cards} onMove={onMove} deNames={deNames} onNew={(q) => { setNewQuery(q); setTab('new') }} />
      {rows.length > 0 && (
        <div className="seg seg-small">
          <button className={!subOn ? 'on' : ''} onClick={() => setSubOn(false)}>Nur Typen</button>
          <button className={subOn ? 'on' : ''} onClick={() => setSubOn(true)} title="Innerhalb der Typen nach Removal, Ramp, Draw … unterteilen">Typen + Unterkategorien</button>
        </div>
      )}
      {rows.length > 0 && (
        <div className="seg seg-small" style={{ marginLeft: 8 }}>
          <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>Liste</button>
          <button className={mode === 'grid' ? 'on' : ''} onClick={() => setMode('grid')}>Stapel</button>
          <button className={mode === 'raster' ? 'on' : ''} onClick={() => setMode('raster')}>Raster</button>
        </div>
      )}
      {warnings.map((w) => <p key={w} className="warn">{w}</p>)}

      {!rows.length && (
        <div className="deck-empty">
          Ziehe Karten aus der Sammlung auf dieses Deck – hier hinein oder links auf den Decknamen.
        </div>
      )}

      <div className={mode === 'grid' ? 'deck-stacks' : mode === 'raster' ? 'deck-raster' : 'deck-cols'}>
        {poolRest.length > 0 && (
          <Group onAddNew={onAddNew} onPrint={setPrintRow} gk="pool" label="Commander-Pool (inaktiv)" rows={poolRest} deck={deck} onMove={onMove} onToggleCommander={onToggleCommander} onOpen={onOpen} picker={picker} setPicker={setPicker} onUpdate={onUpdate} togglePool={togglePool} grid={mode === 'grid'} raster={mode === 'raster'} toggleSide={toggleSide} sideKeys={sideKeys} />
        )}
        {commanders.length > 0 && (
          <Group onAddNew={onAddNew} onPrint={setPrintRow} label="Commander" rows={commanders} deck={deck} cmd togglePool={togglePool} onMove={onMove} onToggleCommander={onToggleCommander} onOpen={onOpen} picker={picker} setPicker={setPicker} onUpdate={onUpdate} grid={mode === 'grid'} raster={mode === 'raster'} toggleSide={toggleSide} sideKeys={sideKeys} />
        )}
        {groups.map((g) => (
          <Group onAddNew={onAddNew} onPrint={setPrintRow} key={g.k} gk={g.k} label={g.label} rows={g.rows} subs={g.subs} deck={deck} togglePool={togglePool} onMove={onMove} onToggleCommander={onToggleCommander} onOpen={onOpen} picker={picker} setPicker={setPicker} onUpdate={onUpdate} grid={mode === 'grid'} raster={mode === 'raster'} toggleSide={toggleSide} sideKeys={sideKeys} />
        ))}
        {rows.length + sideRows.length > 0 && (
          <Group onAddNew={onAddNew} onPrint={setPrintRow} gk="side" label="Sideboard" rows={sideRows} deck={deck} togglePool={togglePool} onMove={onMove} onToggleCommander={onToggleCommander} onOpen={onOpen} picker={picker} setPicker={setPicker} onUpdate={onUpdate} grid={mode === 'grid'} raster={mode === 'raster'} toggleSide={toggleSide} sideKeys={sideKeys} onDropHere={dropToSide} />
        )}
      </div>
      </>}
    </div>
    {printRow && (
      <PrintPicker row={printRow} entries={entries} onClose={() => setPrintRow(null)}
        onApply={(card, finish, qty, mode) => { onChangePrinting({ id: printRow.id, finish: printRow.finish }, card, finish, qty, mode); setPrintRow(null) }} />
    )}
    {builder && (
      <aside className="builder-pane">
        <div className="builder-head">
          <b>Sammlung</b>
          <span className="muted small">
            {identity.length ? `nur Farbidentität ${identity.join('')} · ` : 'kein Commander gesetzt – alle Farben · '}
            + oder Ziehen legt 1 Exemplar ins Deck
          </span>
        </div>
        <CollectionView
          entries={entries} cards={cards} onOpen={onOpen}
          identity={identity.length ? identity : null}
          onQuickAdd={(r) => onMove({ id: r.id, finish: r.finish, from: 'collection' }, deck.id)}
          decks={{ [deck.id]: deck }} onMoveMany={onMoveMany} deNames={deNames} reserved={reserved}
        />
      </aside>
    )}
    </div>
  )
}

function Group({ gk = 'cmd', label, rows, subs, deck, onAddNew, onPrint, cmd, onMove, onToggleCommander, onOpen, picker, setPicker, onUpdate, togglePool, grid, raster, toggleSide, sideKeys, onDropHere }) {
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
  const legendary = (r) => cmd || /Legendary/.test(r.card.type) || /can be your commander/.test(r.card.text || '')

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
      <button className={`mini ${sideKeys?.has(r.key) ? 'on' : ''}`} title={sideKeys?.has(r.key) ? 'Zurück ins Hauptdeck' : 'Ins Sideboard'} onClick={() => toggleSide(r.key)}>SB</button>
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
            <span className="row-name">{r.card.name}{r.finish !== 'normal' && <em className="foil">{FINISH_LABEL[r.finish]}</em>}</span>
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
