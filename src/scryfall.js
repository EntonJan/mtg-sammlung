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
  const gap = SLOW.test(url) ? 600 : 120
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
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`Scryfall-Fehler ${res.status}`)
  const json = await res.json()
  return (json.data || []).slice(0, 60).map(slimCard)
}

export async function autocomplete(q) {
  if (q.length < 2) return []
  const res = await sfFetch(`${API}/cards/autocomplete?q=${encodeURIComponent(q)}`)
  if (!res.ok) return []
  return (await res.json()).data || []
}
