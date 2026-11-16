// EDHREC: beliebte Karten für einen Commander (bzw. ein Partner-Paar)
const memo = new Map()

export const edhrecSlug = (name) => name.split(' // ')[0].toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-')

export function commanderSlug(commanders) {
  return commanders.map((c) => edhrecSlug(c.name)).sort().join('-')
}

export async function loadSuggestions(commanders) {
  const slug = commanderSlug(commanders)
  if (!slug) return null
  if (memo.has(slug)) return memo.get(slug)
  const p = (async () => {
    let res
    try { res = await fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`) } catch { throw new Error('EDHREC ist gerade nicht erreichbar.') }
    if (res.status === 404 || res.status === 403) throw new Error('Für diesen Commander hat EDHREC (noch) keine Seite.')
    if (!res.ok) throw new Error(`EDHREC antwortet mit Fehler ${res.status}.`)
    const j = await res.json()
    const lists = (j.container?.json_dict?.cardlists || []).map((l) => ({
      tag: l.tag, header: l.header,
      cards: (l.cardviews || []).map((c) => ({
        name: c.name, synergy: c.synergy, decks: c.num_decks ?? c.inclusion, potential: c.potential_decks,
        pct: c.potential_decks ? Math.round(((c.num_decks ?? c.inclusion) / c.potential_decks) * 100) : null,
      })),
    })).filter((l) => l.cards.length)
    return { slug, url: `https://edhrec.com/commanders/${slug}`, decks: j.num_decks_avg ?? j.container?.json_dict?.card?.num_decks, lists }
  })()
  memo.set(slug, p)
  p.catch(() => memo.delete(slug))
  return p
}

export const scryfallImg = (name) => `https://api.scryfall.com/cards/named?format=image&version=normal&exact=${encodeURIComponent(name)}`
