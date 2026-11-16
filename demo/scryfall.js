// Demo: echte Scryfall-Daten, aber Karten über Namen statt eigener IDs
export * from '../src/scryfall.js'
import { sfFetch, slimCard } from '../src/scryfall.js'
import { ALL_NAMES, slug } from './data'

let cache = null
export async function loadCardCache() {
  if (cache) return cache
  cache = {}
  for (let i = 0; i < ALL_NAMES.length; i += 75) {
    const res = await sfFetch('https://api.scryfall.com/cards/collection', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: ALL_NAMES.slice(i, i + 75).map((name) => ({ name })) }),
    })
    const j = await res.json()
    for (const c of j.data || []) {
      const s = slimCard(c)
      const key = slug(ALL_NAMES.find((n) => n.toLowerCase() === c.name.toLowerCase() || c.name.toLowerCase().startsWith(n.toLowerCase() + ' //')) || c.name)
      cache[key] = { ...s, id: key }
    }
  }
  return cache
}
export const ensureCards = async () => loadCardCache()
export const refreshStalePrices = async () => loadCardCache()
export const savePriceSnapshot = async () => {}
export async function loadPriceSnapshots() {
  const c = await loadCardCache()
  const old = {}
  let i = 0
  for (const [id, card] of Object.entries(c)) {
    const f = [1.35, 0.7, 1.12, 0.92, 1.0, 1.25, 0.85][i++ % 7]
    old[id] = [card.eur != null ? Math.round(card.eur / f * 100) / 100 : null, card.eurFoil != null ? Math.round(card.eurFoil / f * 100) / 100 : null]
  }
  const d = new Date(Date.now() - 8 * 864e5).toLocaleDateString('sv-SE')
  return { [d]: old, [new Date().toLocaleDateString('sv-SE')]: {} }
}
