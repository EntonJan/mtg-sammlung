// Synergie-Erkennung innerhalb eines Decks – aus dem englischen Regeltext.
// 1) Bedingungen: Karte A „interessiert sich“ für Karten mit bestimmten Eigenschaften
//    („whenever you cast a noncreature spell with mana value 3 or greater“, „whenever an Equipment enters“,
//    „Elves you control get +1/+1“, „for each artifact you control“) → A profitiert von allen passenden Karten B.
// 2) Ereignisse: A löst auf ein Ereignis aus („whenever you draw“), B erzeugt dieses Ereignis („draw a card“).
// Geht es in beide Richtungen, ist die Verbindung „beidseitig“ und zählt doppelt.

const TYPES = ['artifact', 'creature', 'enchantment', 'instant', 'sorcery', 'planeswalker', 'land', 'battle']
const STOP = new Set(['A', 'An', 'Another', 'Each', 'You', 'Your', 'Other', 'One', 'Or', 'And', 'The', 'That', 'This', 'If', 'When', 'Whenever', 'At', 'Spell', 'Spells', 'Target', 'Up', 'More', 'Two', 'Three', 'X', 'Mana', 'Value'])
const COLORS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }
const TYPE_DE = { artifact: 'Artefakt', creature: 'Kreatur', enchantment: 'Verzauberung', instant: 'Spontanzauber', sorcery: 'Hexerei', planeswalker: 'Planeswalker', land: 'Land', battle: 'Kampf' }

const front = (t = '') => t.split(' // ')[0]
const subtypesOf = (t) => { const f = front(t); const i = f.indexOf('—'); return i < 0 ? [] : f.slice(i + 1).trim().split(/\s+/) }

// „noncreature spell with mana value 3 or greater“ → { spell, exclude:[creature], cmcMin:3 }
function parseFilter(phrase) {
  const raw = phrase.replace(/\(.*?\)/g, ' ')
  const low = raw.toLowerCase()
  // Karten der Gegner sind keine Synergie mit dem eigenen Deck
  if (/opponent|you don't control|target\b/.test(low)) return null
  const f = { include: [], exclude: [], subtypes: [], spell: /\bspells?\b/.test(low) }
  for (const t of TYPES) {
    if (new RegExp(`\\bnon-?${t}`).test(low)) f.exclude.push(t)
    else if (new RegExp(`\\b${t}s?\\b`).test(low)) f.include.push(t)
  }
  if (/\bhistoric\b/.test(low)) f.historic = true
  if (/\blegendary\b/.test(low) && !/nonlegendary/.test(low)) f.legendary = true
  if (/\bmulticolou?red\b/.test(low)) f.multi = true
  if (/\bcolorless\b/.test(low)) f.colorless = true
  for (const [w, c] of Object.entries(COLORS)) if (new RegExp(`\\b${w}\\b`).test(low)) (f.colors ||= []).push(c)
  let m = low.match(/mana value (\d+) or (greater|more)/); if (m) f.cmcMin = Number(m[1])
  m = low.match(/mana value (\d+) or (less|fewer)/); if (m) f.cmcMax = Number(m[1])
  for (const w of raw.match(/\b[A-Z][a-z]+(?:-[A-Z][a-z]+)?\b/g) || []) {
    const s = w.replace(/s$/, '')
    if (!STOP.has(w) && !TYPES.includes(w.toLowerCase()) && !TYPES.includes(s.toLowerCase())) f.subtypes.push(w, s)
  }
  f.subtypes = [...new Set(f.subtypes)]
  // „Kreaturen, die du kontrollierst“ oder „Länder“ allein wären zu allgemein (fast jede Karte)
  // Suche nach Grundlandtypen (Forest, Island …) ist keine echte Synergie
  if (f.subtypes.length && f.subtypes.every((x) => /^(Forests?|Islands?|Swamps?|Mountains?|Plains?)$/.test(x)) && !f.include.filter((t) => t !== 'land').length) return null
  // „Kreaturen“, „Länder“, „Kreaturen oder Planeswalker“ allein treffen fast das halbe Deck – keine echte Synergie
  const onlyBroad = f.include.length >= 1 && f.include.every((t) => ['creature', 'land', 'planeswalker'].includes(t)) && !f.subtypes.length && f.cmcMin == null && f.cmcMax == null && !f.colors && !f.legendary && !f.historic && !f.multi && !f.colorless && !f.exclude.length
  if (onlyBroad) return null
  const specific = f.include.length || f.exclude.length || f.subtypes.length || f.cmcMin != null || f.cmcMax != null || f.historic || f.legendary || f.multi || f.colorless || f.colors
  return specific ? f : null
}

function matches(f, c) {
  const t = front(c.type).toLowerCase()
  if (f.spell && /\bland\b/.test(t)) return false
  // Länder passen nur, wenn die Bedingung wirklich Länder meint („lands“, „Gates“, „Desert“, Artefakt-Länder bei „artifact“) –
  // nicht über farblos/legendär/Manawert, die fast jedes Land erfüllen würde
  if (/\bland\b/.test(t) && !f.include.some((x) => t.includes(x)) && !(f.subtypes.length && f.subtypes.some((s) => subtypesOf(c.type).includes(s)))) return false
  if (f.exclude.some((x) => t.includes(x))) return false
  if (f.include.length && !f.include.some((x) => t.includes(x))) return false
  if (f.subtypes.length && !f.subtypes.some((s) => subtypesOf(c.type).includes(s) || front(c.type).includes(s))) return false
  if (f.cmcMin != null && (c.cmc ?? 0) < f.cmcMin) return false
  if (f.cmcMax != null && (c.cmc ?? 0) > f.cmcMax) return false
  if (f.historic && !/artifact|legendary|saga/.test(t)) return false
  if (f.legendary && !t.includes('legendary')) return false
  if (f.multi && (c.colors || []).length < 2) return false
  if (f.colorless && (c.colors || []).length) return false
  if (f.colors && !f.colors.some((x) => (c.colors || []).includes(x))) return false
  return true
}

function describe(f) {
  const parts = []
  if (f.exclude.length) parts.push(f.exclude.map((t) => `Nicht-${TYPE_DE[t]}`).join('/'))
  if (f.include.length) parts.push(f.include.map((t) => TYPE_DE[t]).join(' oder '))
  if (f.subtypes.length) parts.push([...new Set(f.subtypes.map((s) => s.replace(/s$/, '')))].join('/'))
  if (f.historic) parts.push('Historisch')
  if (f.legendary) parts.push('Legendär')
  if (f.multi) parts.push('mehrfarbig')
  if (f.colorless) parts.push('farblos')
  let s = parts.join(' ') + (f.spell ? (parts.length ? '-Zauber' : 'Zauber') : '')
  if (f.cmcMin != null) s += ` mit Manawert ≥ ${f.cmcMin}`
  if (f.cmcMax != null) s += ` mit Manawert ≤ ${f.cmcMax}`
  return s.trim()
}

// Stellen im Text, an denen eine Karte sich für andere Karten interessiert
const FILTER_PATTERNS = [
  /whenever you cast (?:an? |your (?:first|second) |another )?([^.;:]*? spells?(?: with mana value \d+ or (?:greater|more|less|fewer))?)(?=[,.;:]|$| from| that| during)/gi,
  /\b(?:an?|another|each|one or more) ([^.,;:]+?) (?:you control )?(?:enters|enter|dies|die|attacks|attack|becomes tapped|is put into)/gi,
  /for each (?:other )?([^.,;:]+?) you control/gi,
  /\b((?:[Oo]ther )?[A-Z][a-z]+s?(?: and [A-Z][a-z]+s?)?) (?:creatures |permanents |cards )?you control\b/g,
  /([^.,;:]{3,40}?) spells you cast (?:cost|have|with)/gi,
  /\bsearch your library for (?:an?|up to \w+) ([A-Za-z ]+?) cards?\b/gi,
]

// Ereignisse: pay = profitiert davon, prod = erzeugt es
const EVENTS = [
  { key: 'draw', label: 'Karten ziehen', pay: /whenever you draw|draw your second card|whenever a player draws/i, prod: /(?<!opponent )\bdraws? (?:a|an|one|two|three|four|x|\d+|that many) (?:additional )?cards?\b|draw cards? equal/i },
  { key: 'life', label: 'Lebenspunkte gewinnen', pay: /whenever you gain life|if you gained (?:\d+ or more )?life|whenever you gain \d+/i, prod: /\byou gain (?:\d+|x|that much) life|gains? life equal|\blifelink\b/i },
  { key: 'opploss', label: 'Gegner verlieren Leben', pay: /whenever an opponent loses life|(?:player|opponent)s? lost (?:\d+ or more )?life this turn|if an opponent lost/i, prod: /each opponent loses (?:\d+|x)|deals? (?:\d+|x) damage to each opponent|target (?:opponent|player) loses (?:\d+|x) life|loses (?:\d+|x) life/i },
  { key: 'token', label: 'Token', pay: /whenever (?:one or more )?(?:creature )?tokens?|for each (?:creature )?token|tokens you control (?:get|have)|would create one or more tokens/i, prod: /\bcreates? (?:a|an|one|two|three|four|x|\d+|that many)[^.]*?tokens?/i },
  // Proliferate profitiert von Markern, legt aber selbst keine neuen Arten – daher nur „profitiert“
  { key: 'counter', label: 'Marker', pay: /whenever (?:one or more )?(?:\+1\/\+1 )?counters? (?:are|is) put|with (?:a|one or more) \+1\/\+1 counters? on (?:it|them)|for each \+1\/\+1 counter|\bproliferate\b|counters? would be put|double the number of (?:each kind of )?counters|for each counter on/i, prod: /\bput (?:a|an|one|two|three|x|\d+|that many|its) (?:\+1\/\+1|loyalty|poison|oil|charge|shield) counters?|enters with (?:a|an|one|two|three|x|\d+) (?:\+1\/\+1|oil|charge|shield) counters?|\bmodified\b|\bpoison counters?\b|\btoxic \d|\binfect\b/i },
  { key: 'sac', label: 'Opfern & Sterben', pay: /whenever you sacrifice|whenever (?:a|another) (?:nontoken )?creature (?:you control )?dies|whenever a permanent you control is put into a graveyard/i, prod: /\bsacrifice (?:a|an|another) (?:creature|artifact|permanent)|\bsacrifice x\b/i },
  { key: 'gy', label: 'Friedhof', pay: /(?:card|cards|spells?) from your graveyard|cards? in your graveyard/i, prod: /\bmills? (?:a|one|two|three|x|\d+|that many) cards?|\bsurveil\b|discard (?:a|one|two|three|x|\d+|that many) cards?/i },
  { key: 'discard', label: 'Abwerfen', pay: /whenever you discard|\bmadness\b/i, prod: /\bdiscard (?:a|one|two|three|x|\d+|that many) cards?|(?<!land)cycling\b|\bconnive/i },
  { key: 'landfall', label: 'Landfall', pay: /\blandfall\b|whenever a land (?:you control )?enters/i, prod: /search your library for (?:a|an|up to \w+)[^.]*lands?[^.]*onto the battlefield|you may play (?:an|two) additional lands?|put a land card from your hand onto the battlefield/i },
  { key: 'etb', label: 'Eintritts-Effekte & Blinken', pay: /exile (?:another )?(?:target |up to \w+ (?:other )?target )?(?:creatures?|permanents?|nonland permanents?)[^.]*you control[^.]*return (?:it|that card|them|those cards) to the battlefield/i, prod: /\bwhen [^.]* enters(?: the battlefield)?,/i },
  { key: 'cast2', label: 'Viele Zauber pro Zug', pay: /whenever you cast your second spell|\bstorm\b|\bmagecraft\b|\bprowess\b/i, prod: /\bcopy target (?:instant|sorcery)|\b(?:instant|sorcery)\b/i, prodType: true },
]

// Stufen nach Deck-Punkten: unter 10 schwach, 10–19 gut, ab 20 stark vernetzt
export const TIER_LIMITS = { gut: 10, stark: 20 }
export const tierOf = (pts) => (pts >= TIER_LIMITS.stark ? 'stark' : pts >= TIER_LIMITS.gut ? 'gut' : 'schwach')

export function analyzeSynergy(cards) {
  // cards: [{ key, card, qty, isCommander }]
  const items = cards.filter((x) => !/Basic Land/.test(x.card.type))
  const info = items.map((x) => {
    const text = (x.card.text || '').replace(/\([^)]*\)/g, '').replace(new RegExp(x.card.name.split(' // ')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'CARDNAME')
    const filters = []
    for (const re of FILTER_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const f = parseFilter(m[1])
        if (f && !filters.some((g) => describe(g) === describe(f))) filters.push(f)
      }
    }
    const pays = EVENTS.filter((e) => e.pay.test(text)).map((e) => e.key)
    const prods = EVENTS.filter((e) => (e.prodType ? /instant|sorcery/i.test(front(x.card.type)) : e.prod.test(text))).map((e) => e.key)
    return { ...x, text, filters, pays, prods }
  })

  // gerichtete Kanten: von (Nutznießer) ← zu (Lieferant), mit Begründung
  const edges = new Map() // `${a}>${b}` → [reasons]
  const add = (a, b, reason) => {
    if (a === b) return
    const k = `${a}>${b}`
    if (!edges.has(k)) edges.set(k, [])
    if (!edges.get(k).includes(reason)) edges.get(k).push(reason)
  }
  for (const a of info) {
    for (const f of a.filters) {
      const label = describe(f)
      for (const b of info) if (b !== a && matches(f, b.card)) add(a.key, b.key, label)
    }
    for (const ev of a.pays) {
      const e = EVENTS.find((x) => x.key === ev)
      for (const b of info) if (b !== a && b.prods.includes(ev)) add(a.key, b.key, e.label)
    }
  }

  // „Viele Zauber pro Zug“ und eine Spontanzauber/Hexerei-Bedingung beschreiben bei einem Paar denselben Effekt – nur einmal zählen
  for (const [k, reasons] of edges) {
    if (reasons.includes('Viele Zauber pro Zug') && reasons.some((r) => /Spontanzauber|Hexerei/.test(r))) edges.set(k, reasons.filter((r) => r !== 'Viele Zauber pro Zug'))
  }

  // pro Karte: Partner mit Richtung und Stärke
  const per = {}
  for (const x of info) per[x.key] = { ...x, partners: new Map() }
  for (const [k, reasons] of edges) {
    const [a, b] = k.split('>')
    const both = edges.has(`${b}>${a}`)
    const pa = per[a].partners.get(b) || { key: b, gets: [], gives: [], both: false }
    pa.gets.push(...reasons); pa.both = both
    per[a].partners.set(b, pa)
    const pb = per[b].partners.get(a) || { key: a, gets: [], gives: [], both: false }
    pb.gives.push(...reasons); pb.both = both
    per[b].partners.set(a, pb)
  }
  // Gewicht = Anzahl verschiedener Teileffekte, die das Paar verbinden (in beide Richtungen).
  // Ab 2 Teileffekten gilt das Paar als „hohe Synergie“.
  const list = Object.values(per).map((x) => {
    const partners = [...x.partners.values()].map((p) => {
      const gets = [...new Set(p.gets)], gives = [...new Set(p.gives)]
      const weight = gets.length + gives.length
      // Punkte: normale Synergie 1, hohe Synergie (2+ Teileffekte) 2
      return { ...p, gets, gives, weight, high: weight >= 2, points: weight >= 2 ? 2 : 1, cmd: !!per[p.key].isCommander }
    }).sort((p, q) => q.weight - p.weight || (q.both - p.both) || per[p.key].card.name.localeCompare(per[q.key].card.name))
    // Teileffekte der Karte: worauf sie reagiert (gets) und was sie liefert (gives), mit Anzahl Partner
    const fm = new Map()
    for (const p of partners) {
      for (const r of p.gets) { const k = 'g|' + r; fm.set(k, { label: r, dir: 'gets', count: (fm.get(k)?.count || 0) + 1 }) }
      for (const r of p.gives) { const k = 'v|' + r; fm.set(k, { label: r, dir: 'gives', count: (fm.get(k)?.count || 0) + 1 }) }
    }
    const facets = [...fm.values()].sort((a, b) => (a.dir === b.dir ? b.count - a.count : a.dir === 'gets' ? -1 : 1))
    // Deck-Punkte: nur Verbindungen zu anderen Deckkarten (ohne Commander), Commander-Punkte getrennt
    const deckPoints = partners.filter((p) => !p.cmd).reduce((t, p) => t + p.points, 0)
    const cmdPoints = partners.filter((p) => p.cmd).reduce((t, p) => t + p.points, 0)
    const tier = x.isCommander ? null : tierOf(deckPoints)
    return { ...x, partners, facets, high: partners.filter((p) => p.high).length, deckPoints, cmdPoints, tier, score: partners.reduce((t, p) => t + p.points, 0) }
  }).sort((a, b) => (b.isCommander - a.isCommander) || b.deckPoints - a.deckPoints || b.score - a.score)

  // Themen: Begründung → beteiligte Karten
  const themes = new Map()
  for (const [k, reasons] of edges) {
    const [a, b] = k.split('>')
    for (const r of reasons) {
      if (!themes.has(r)) themes.set(r, { label: r, payoffs: new Set(), sources: new Set() })
      themes.get(r).payoffs.add(a); themes.get(r).sources.add(b)
    }
  }
  const nonland = list.filter((x) => !/\bLand\b/.test(front(x.card.type)))
  const connected = nonland.filter((x) => x.partners.length > 0)
  // Deck-Synergie: wie gut die Karten (ohne Commander) untereinander harmonieren – stark zählt voll, gut halb
  const pool = nonland.filter((x) => !x.isCommander)
  const tiers = { stark: 0, gut: 0, schwach: 0 }
  for (const x of pool) tiers[x.tier]++
  const deckScore = pool.length ? (tiers.stark + tiers.gut * 0.5) / pool.length : 0
  // Commander-Synergie: wie viele Deckkarten mit dem Commander verbunden sind (hohe Synergie voll, normale halb)
  const commanders = list.filter((x) => x.isCommander).map((c) => {
    const ps = c.partners.filter((p) => !p.cmd && pool.some((y) => y.key === p.key))
    return { key: c.key, name: c.card.name, linked: ps.length, high: ps.filter((p) => p.high).length, points: ps.reduce((t, p) => t + p.points, 0) }
  })
  let cmdLinked = 0, cmdHigh = 0
  for (const x of pool) { const ps = x.partners.filter((p) => p.cmd); if (ps.length) { cmdLinked++; if (ps.some((p) => p.high)) cmdHigh++ } }
  const cmdScore = pool.length ? (cmdHigh + (cmdLinked - cmdHigh) * 0.5) / pool.length : 0
  return {
    cards: list,
    themes: [...themes.values()].map((t) => ({ ...t, payoffs: [...t.payoffs], sources: [...t.sources] })).sort((a, b) => b.sources.length + b.payoffs.length - a.sources.length - a.payoffs.length),
    loners: nonland.filter((x) => !x.partners.length && !x.isCommander),
    share: nonland.length ? connected.length / nonland.length : 0,
    tiers, deckScore, pool: pool.length,
    commanders, cmdScore, cmdLinked, cmdHigh,
    high: list.reduce((t, c) => t + c.high, 0) / 2,
    mutual: [...edges.keys()].filter((k) => { const [a, b] = k.split('>'); return a < b && edges.has(`${b}>${a}`) }).length,
  }
}
