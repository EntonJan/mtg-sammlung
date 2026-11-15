// Kartendaten von Scryfall laden und lokal (IndexedDB) cachen.
import { get, set } from 'idb-keyval'

const API = 'https://api.scryfall.com'
const CACHE_KEY = 'scryfall-cards-v1'
const PRICE_MAX_AGE = 24 * 60 * 60 * 1000 // Preise 1x täglich aktualisieren
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    const res = await fetch(`${API}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identifiers: batch.map((id) => ({ id })) }),
    })
    if (res.status === 429) { await sleep(1000); i -= 75; continue }
    if (!res.ok) throw new Error(`Scryfall-Fehler ${res.status}`)
    const json = await res.json()
    for (const c of json.data || []) memCache[c.id] = slimCard(c)
    done += batch.length
    onProgress?.(done, unique.length)
    await sleep(110) // Scryfall bittet um max. ~10 Anfragen/Sekunde
  }
  await persistCache()
  return memCache
}

// Fehlende Karten nachladen, veraltete Preise im Hintergrund aktualisieren
export async function ensureCards(ids, onProgress) {
  const cache = await loadCardCache()
  const missing = ids.filter((id) => !cache[id])
  if (missing.length) await fetchCards(missing, onProgress)
  return memCache
}

export async function refreshStalePrices(ids, onProgress) {
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
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`Scryfall-Fehler ${res.status}`)
  const json = await res.json()
  return (json.data || []).slice(0, 60).map(slimCard)
}

export async function autocomplete(q) {
  if (q.length < 2) return []
  const res = await fetch(`${API}/cards/autocomplete?q=${encodeURIComponent(q)}`)
  if (!res.ok) return []
  return (await res.json()).data || []
}
