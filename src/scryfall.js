// Kartendaten von Scryfall laden und lokal (IndexedDB) cachen.
import { get, set } from 'idb-keyval'

const API = 'https://api.scryfall.com'
const CACHE_KEY = 'scryfall-cards-v1'
const PRICE_MAX_AGE = 24 * 60 * 60 * 1000 // Preise 1x täglich aktualisieren
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Alle Scryfall-Anfragen laufen nacheinander durch EINE Warteschlange mit Mindestabstand.
// Zu viele Anfragen beantwortet Scryfall mit 429 – ohne CORS-Header, weshalb der Browser
// nur „Failed to fetch“ meldet. Darum: drosseln und bei Netzwerkfehlern/429 mit Pause erneut versuchen.
// Scryfall-Limits: allgemein ~10/s, aber /cards/collection, /cards/search u. a. nur ~2/s.
const SLOW = /\/cards\/(collection|search|named|random|autocomplete)/
let queue = Promise.resolve()
let lastCall = 0
let onWait = null
export const setWaitHandler = (fn) => { onWait = fn }

export function sfFetch(url, opts = {}) {
  const gap = SLOW.test(url) ? 1000 : 120
  const run = async () => {
    // Nach einem 429 sperrt Scryfall kurz → lange Pausen statt schneller Wiederholungen
    const pauses = [5000, 30000, 60000, 60000]
    for (let attempt = 0; attempt <= pauses.length; attempt++) {
      const delta = Date.now() - lastCall
      if (delta < gap) await sleep(gap - delta)
      lastCall = Date.now()
      try {
        const res = await fetch(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } })
        if (res.status !== 429 && res.status < 500) return res
      } catch {
        // Netzwerk-/CORS-Fehler (meist verstecktes 429) → später erneut versuchen
      }
      if (attempt < pauses.length) {
        onWait?.(pauses[attempt] / 1000)
        await sleep(pauses[attempt])
      }
    }
    throw new Error('Scryfall blockt gerade zu viele Anfragen. Bitte in ein paar Minuten erneut importieren – bereits geladene Karten bleiben gespeichert.')
  }
  const p = queue.then(run, run)
  queue = p.catch(() => {})
  return p
}

// Nur die Felder speichern, die die App braucht (spart Speicher bei ~8.000 Printings)
export function slimCard(c) {
  const face = c.card_faces?.[0] || {}
  const img = c.image_uris || face.image_uris || {}
  const faces = c.card_faces || []
  return {
    id: c.id,
    oracleId: c.oracle_id || face.oracle_id,
    name: c.name,
    set: c.set?.toUpperCase(),
    setName: c.set_name,
    num: c.collector_number,
    rarity: c.rarity,
    type: c.type_line || faces.map((f) => f.type_line).join(' // '),
    cost: c.mana_cost ?? faces.map((f) => f.mana_cost).filter(Boolean).join(' // '),
    cmc: c.cmc ?? 0,
    colors: c.colors || face.colors || [],
    ci: c.color_identity || [],
    text: c.oracle_text ?? faces.map((f) => f.oracle_text).join('\n//\n'),
    img: img.normal || img.large || img.small || '',
    thumb: img.small || img.normal || '',
    eur: c.prices?.eur ? Number(c.prices.eur) : null,
    eurFoil: c.prices?.eur_foil ? Number(c.prices.eur_foil) : null,
    legalCmd: c.legalities?.commander,
    cm: c.purchase_uris?.cardmarket || null, // Link zur Cardmarket-Produktseite
    released: c.released_at,
    fetched: Date.now(),
  }
}

let memCache = null

export async function loadCardCache() {
  if (memCache) return memCache
  memCache = (await get(CACHE_KEY)) || {}
  return memCache
}

async function persistCache() {
  await set(CACHE_KEY, memCache)
}

// Lädt Karten per Scryfall-ID in 75er-Paketen (Limit von /cards/collection)
export async function fetchCards(ids, onProgress) {
  await loadCardCache()
  const unique = [...new Set(ids)]
  let done = 0
  for (let i = 0; i < unique.length; i += 75) {
    const batch = unique.slice(i, i + 75)
    let res
    try {
      res = await sfFetch(`${API}/cards/collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: batch.map((id) => ({ id })) }),
      })
    } catch (e) {
      await persistCache() // Bereits geladene Karten behalten
      throw e
    }
    if (!res.ok) { await persistCache(); throw new Error(`Scryfall-Fehler ${res.status}`) }
    const json = await res.json()
    for (const c of json.data || []) memCache[c.id] = slimCard(c)
    done += batch.length
    onProgress?.(done, unique.length)
    if ((i / 75) % 20 === 19) await persistCache() // Zwischenstand sichern
  }
  await persistCache()
  return memCache
}

// Fehlende Karten nachladen, veraltete Preise im Hintergrund aktualisieren
let running = Promise.resolve()
const exclusive = (fn) => { const p = running.then(fn, fn); running = p.catch(() => {}); return p }

export function ensureCards(ids, onProgress) {
  return exclusive(() => ensureCardsInner(ids, onProgress))
}

async function ensureCardsInner(ids, onProgress) {
  const cache = await loadCardCache()
  const missing = ids.filter((id) => !cache[id])
  if (missing.length) await fetchCards(missing, onProgress)
  return memCache
}

export function refreshStalePrices(ids, onProgress) {
  return exclusive(() => refreshInner(ids, onProgress))
}

async function refreshInner(ids, onProgress) {
  const cache = await loadCardCache()
  const now = Date.now()
  const stale = ids.filter((id) => !cache[id] || now - (cache[id].fetched || 0) > PRICE_MAX_AGE)
  if (stale.length) await fetchCards(stale, onProgress)
  return memCache
}

export function addToCache(card) {
  if (!memCache) memCache = {}
  memCache[card.id] = card
  persistCache()
}

// Suche nach Karten (alle Printings) für das manuelle Hinzufügen
export async function searchCards(query) {
  const url = `${API}/cards/search?unique=prints&order=released&q=${encodeURIComponent(query)}`
  const res = await sfFetch(url)
  if (res.ok) return (await res.json()).data.slice(0, 60).map(slimCard)
  if (res.status !== 404) throw new Error(`Scryfall-Fehler ${res.status}`)
  // Nichts gefunden → evtl. deutscher Name: in allen Sprachen suchen und auf englische Drucke abbilden
  const de = await sfFetch(`${API}/cards/search?unique=cards&include_multilingual=true&q=${encodeURIComponent(query)}`)
  if (!de.ok) return []
  const oracles = [...new Set((await de.json()).data.map((c) => c.oracle_id || c.card_faces?.[0]?.oracle_id).filter(Boolean))].slice(0, 10)
  if (!oracles.length) return []
  const en = await sfFetch(`${API}/cards/search?unique=prints&order=released&q=${encodeURIComponent(oracles.map((o) => `oracleid:${o}`).join(' or '))}`)
  if (!en.ok) return []
  return (await en.json()).data.slice(0, 60).map(slimCard)
}

// Deutsche Kartennamen je oracleId (lokal gecacht, einmalig nachgeladen)
const DE_KEY = 'names-de-v1'
let deNames = null
export async function getGermanNames() {
  if (!deNames) deNames = (await get(DE_KEY)) || {}
  return deNames
}

export async function loadGermanNames(oracleIds, onProgress) {
  const names = await getGermanNames()
  const todo = [...new Set(oracleIds)].filter((o) => o && !(o in names))
  const BATCH = 18 // Scryfall-Suchanfragen dürfen max. ~1000 Zeichen lang sein
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH)
    const q = `lang:de (${batch.map((o) => `oracleid:${o}`).join(' or ')})`
    let url = `${API}/cards/search?unique=cards&include_multilingual=true&q=${encodeURIComponent(q)}`
    while (url) {
      const res = await sfFetch(url)
      if (res.status === 404) break
      if (!res.ok) throw new Error(`Scryfall-Fehler ${res.status}`)
      const json = await res.json()
      for (const c of json.data || []) {
        const oid = c.oracle_id || c.card_faces?.[0]?.oracle_id
        const n = c.printed_name || c.card_faces?.map((f) => f.printed_name).filter(Boolean).join(' // ')
        if (oid && n) names[oid] = n
      }
      url = json.has_more ? json.next_page : null
    }
    // Karten ohne deutschen Druck merken, damit sie nicht erneut angefragt werden
    for (const o of batch) if (!(o in names)) names[o] = null
    onProgress?.(Math.min(i + BATCH, todo.length), todo.length)
    if ((i / BATCH) % 10 === 9) await set(DE_KEY, names)
  }
  await set(DE_KEY, names)
  return names
}

export async function autocomplete(q) {
  if (q.length < 2) return []
  const res = await sfFetch(`${API}/cards/autocomplete?q=${encodeURIComponent(q)}`)
  if (!res.ok) return []
  return (await res.json()).data || []
}

// Deckliste (aus parseDecklist) bei Scryfall auflösen: zuerst exaktes Printing (Set + Nummer),
// sonst über den Namen. Liefert die Zeilen mit .card bzw. die nicht gefundenen Zeilen.
const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").trim()
const nameMatches = (card, name) => {
  const n = norm(name)
  const full = norm(card.name)
  return full === n || full.split(' // ')[0] === n || n.split(' // ')[0] === full.split(' // ')[0]
}

async function lookup(idents, onProgress, offset, total) {
  const found = []
  for (let i = 0; i < idents.length; i += 75) {
    const batch = idents.slice(i, i + 75)
    const res = await sfFetch(`${API}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: batch.map((x) => x.ident) }),
    })
    if (!res.ok) throw new Error(`Scryfall-Fehler ${res.status}`)
    const json = await res.json()
    found.push(...(json.data || []).map(slimCard))
    onProgress?.(offset + Math.min(i + 75, idents.length), total)
  }
  return found
}

export async function resolveDeckLines(lines, onProgress) {
  await loadCardCache()
  const total = lines.length
  const withPrint = lines.filter((l) => l.set && l.num)
  const printCards = await lookup(
    withPrint.map((l) => ({ l, ident: { set: l.set, collector_number: l.num } })), onProgress, 0, total
  )
  for (const l of withPrint) {
    l.card = printCards.find((c) => c.set.toLowerCase() === l.set && c.num === l.num && nameMatches(c, l.name))
      || printCards.find((c) => c.set.toLowerCase() === l.set && c.num === l.num)
  }
  const byName = lines.filter((l) => !l.card)
  const nameCards = await lookup(
    byName.map((l) => { const n = l.name.split(' // ')[0]; return { l, ident: l.set ? { name: n, set: l.set } : { name: n } } }), onProgress, withPrint.length, total
  )
  for (const l of byName) l.card = nameCards.find((c) => nameMatches(c, l.name))
  // Fallback: mit Set nicht gefunden → nur Name
  const retry = lines.filter((l) => !l.card && l.set)
  if (retry.length) {
    const again = await lookup(retry.map((l) => ({ l, ident: { name: l.name.split(' // ')[0] } })), null, 0, 0)
    for (const l of retry) l.card = again.find((c) => nameMatches(c, l.name))
  }
  for (const l of lines) if (l.card) memCache[l.card.id] = l.card
  await persistCache()
  return { ok: lines.filter((l) => l.card), missing: lines.filter((l) => !l.card) }
}

// Lokale Preis-Schnappschüsse (ein Satz pro Tag, max. 35 Tage) für „größte Preissprünge“
const SNAP_KEY = 'price-snaps-v1'
export const today = () => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD

export async function savePriceSnapshot() {
  const cache = await loadCardCache()
  const snaps = (await get(SNAP_KEY)) || {}
  const day = today()
  const snap = {}
  for (const [id, c] of Object.entries(cache)) if (c.eur != null || c.eurFoil != null) snap[id] = [c.eur, c.eurFoil]
  snaps[day] = snap
  const days = Object.keys(snaps).sort()
  while (days.length > 35) delete snaps[days.shift()]
  await set(SNAP_KEY, snaps)
  return snaps
}

export async function loadPriceSnapshots() {
  return (await get(SNAP_KEY)) || {}
}

// Set-Symbole (Code → SVG-URL), einmal pro Woche von Scryfall geladen und lokal gecacht
const SETS_KEY = 'set-icons-v1'
let setIconsP = null
export function getSetIcons() {
  if (!setIconsP) {
    setIconsP = (async () => {
      const cached = await get(SETS_KEY)
      if (cached && Date.now() - cached.at < 7 * 864e5) return cached.map
      try {
        const res = await sfFetch(`${API}/sets`)
        if (!res.ok) return cached?.map || {}
        const map = {}
        for (const s of (await res.json()).data) map[s.code] = s.icon_svg_uri
        await set(SETS_KEY, { at: Date.now(), map })
        return map
      } catch { return cached?.map || {} }
    })()
  }
  return setIconsP
}

// Token/Embleme, die Karten erzeugen (Scryfall all_parts) – je Karten-ID dauerhaft gecacht
const TOK_KEY = 'tokens-v1'
let tokCache = null
async function collectionRaw(ids) {
  const out = []
  for (let i = 0; i < ids.length; i += 75) {
    const res = await sfFetch(`${API}/cards/collection`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: ids.slice(i, i + 75).map((id) => ({ id })) }),
    })
    if (!res.ok) throw new Error(`Scryfall-Fehler ${res.status}`)
    out.push(...(await res.json()).data)
  }
  return out
}
export async function getTokens(cardIds) {
  if (!tokCache) tokCache = (await get(TOK_KEY)) || { parts: {}, tokens: {} }
  const todo = [...new Set(cardIds)].filter((id) => !tokCache.parts[id])
  if (todo.length) {
    for (const c of await collectionRaw(todo)) {
      tokCache.parts[c.id] = (c.all_parts || [])
        .filter((p) => p.component === 'token' || /emblem/i.test(p.type_line || ''))
        .filter((p) => p.id !== c.id)
        .map((p) => p.id)
    }
    for (const id of todo) tokCache.parts[id] ||= []
    const tokIds = [...new Set(todo.flatMap((id) => tokCache.parts[id]))].filter((id) => !tokCache.tokens[id])
    for (const t of await collectionRaw(tokIds)) {
      const face = t.card_faces?.[0] || {}
      tokCache.tokens[t.id] = {
        id: t.id, name: t.name, type: t.type_line, oracleId: t.oracle_id,
        pt: t.power != null ? `${t.power}/${t.toughness}` : face.power != null ? `${face.power}/${face.toughness}` : '',
        text: t.oracle_text || face.oracle_text || '', colors: t.colors || face.colors || [],
        img: (t.image_uris || face.image_uris || {}).normal || '',
      }
    }
    await set(TOK_KEY, tokCache)
  }
  return { parts: tokCache.parts, tokens: tokCache.tokens }
}

// Bilder für Karten, die man nicht besitzt (z. B. EDHREC-Vorschläge): per Name in 75er-Paketen,
// dauerhaft gecacht – statt hunderter Einzelanfragen, die Scryfall bremsen würden
const IMG_KEY = 'img-by-name-v1'
let imgCache = null
export async function getImagesByName(names) {
  if (!imgCache) imgCache = (await get(IMG_KEY)) || {}
  const todo = [...new Set(names)].filter((n) => !(n in imgCache))
  for (let i = 0; i < todo.length; i += 75) {
    const batch = todo.slice(i, i + 75)
    const res = await sfFetch(`${API}/cards/collection`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: batch.map((name) => ({ name: name.split(' // ')[0] })) }),
    })
    if (!res.ok) break
    const j = await res.json()
    for (const c of j.data || []) {
      const face = c.card_faces?.[0] || {}
      const url = (c.image_uris || face.image_uris || {}).normal || ''
      imgCache[c.name] = url
      imgCache[c.name.split(' // ')[0]] = url
    }
    for (const n of batch) if (!(n in imgCache)) imgCache[n] = ''
  }
  if (todo.length) await set(IMG_KEY, imgCache)
  return imgCache
}

// Token für eine Liste von Kartennamen (z. B. Deck eines Freundes, von dem nur Namen bekannt sind)
const tokByName = {}
export async function tokensForNames(names) {
  const todo = [...new Set(names.map((n) => n.split(' // ')[0]))].filter((n) => !(n in tokByName))
  for (let i = 0; i < todo.length; i += 75) {
    const batch = todo.slice(i, i + 75)
    const res = await sfFetch(`${API}/cards/collection`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
    })
    if (!res.ok) break
    for (const c of (await res.json()).data) {
      tokByName[c.name.split(' // ')[0]] = (c.all_parts || []).filter((p) => p.component === 'token' || /emblem/i.test(p.type_line || '')).filter((p) => p.id !== c.id).map((p) => p.id)
    }
    for (const n of batch) tokByName[n] ||= []
  }
  const ids = [...new Set(names.flatMap((n) => tokByName[n.split(' // ')[0]] || []))]
  if (!ids.length) return []
  const out = []
  for (const t of await collectionRaw(ids)) {
    const face = t.card_faces?.[0] || {}
    out.push({
      id: t.id, name: t.name, type: t.type_line,
      pt: t.power != null ? `${t.power}/${t.toughness}` : face.power != null ? `${face.power}/${face.toughness}` : '',
      img: (t.image_uris || face.image_uris || {}).normal || '',
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// Stärke/Widerstand + Schlüsselwörter für Testspiel-Bots (per Name, im Speicher gecacht)
const statsByName = {}
export async function cardStats(names) {
  const todo = [...new Set(names.map((n) => n.split(' // ')[0]))].filter((n) => !(n in statsByName))
  for (let i = 0; i < todo.length; i += 75) {
    const batch = todo.slice(i, i + 75)
    const res = await sfFetch(`${API}/cards/collection`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
    })
    if (!res.ok) break
    for (const c of (await res.json()).data) {
      const f = c.card_faces?.[0] || c
      const num = (v) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : 0)
      statsByName[c.name.split(' // ')[0]] = {
        pow: num(c.power ?? f.power), tou: num(c.toughness ?? f.toughness),
        kw: (c.keywords || []).map((k) => k.toLowerCase()),
        text: c.oracle_text ?? f.oracle_text ?? '',
      }
    }
    for (const n of batch) statsByName[n] ||= null
  }
  return Object.fromEntries(names.map((n) => [n, statsByName[n.split(' // ')[0]] || null]))
}

// Volle Kartendaten für den Spieltisch (Regeltext, Stärke/Widerstand, Loyalität, Rückseiten), per Scryfall-ID
export async function fullCards(ids) {
  const out = {}
  for (const c of await collectionRaw([...new Set(ids)])) {
    const face = (f) => ({ name: f.name, type_line: f.type_line || '', oracle_text: f.oracle_text || '', power: f.power, toughness: f.toughness, loyalty: f.loyalty, mana_cost: f.mana_cost || '', image_uris: f.image_uris ? { normal: f.image_uris.normal } : undefined })
    out[c.id] = {
      name: c.name, type_line: c.type_line || c.card_faces?.[0]?.type_line || '', oracle_text: c.oracle_text ?? '', mana_cost: c.mana_cost ?? c.card_faces?.[0]?.mana_cost ?? '',
      cmc: c.cmc || 0, power: c.power, toughness: c.toughness, loyalty: c.loyalty, colors: c.colors || c.card_faces?.[0]?.colors || [], color_identity: c.color_identity || [],
      keywords: c.keywords || [], produced_mana: c.produced_mana || [],
      image_url: c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || '',
      card_faces: c.card_faces ? c.card_faces.map(face) : undefined,
      layout: c.layout || undefined,
    }
  }
  return out
}
