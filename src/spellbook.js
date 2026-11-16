// Commander Spellbook (commanderspellbook.com): Combos und Bracket-Einschätzung für eine Deckliste
const SB = 'https://backend.commanderspellbook.com'
const memo = new Map()

function deckBody(commanders, rows) {
  const name = (c) => c.name.split(' // ')[0]
  return {
    commanders: commanders.map((c) => ({ card: name(c), quantity: 1 })),
    main: rows.map((r) => ({ card: name(r.card), quantity: r.qty })),
  }
}

async function post(path, body) {
  const key = path + JSON.stringify(body)
  if (memo.has(key)) return memo.get(key)
  const p = (async () => {
    let res
    try {
      res = await fetch(`${SB}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
    } catch {
      throw new Error('Commander Spellbook ist gerade nicht erreichbar.')
    }
    if (res.status === 429) throw new Error('Zu viele Anfragen an Commander Spellbook – bitte kurz warten.')
    if (!res.ok) throw new Error(`Commander Spellbook antwortet mit Fehler ${res.status}.`)
    return res.json()
  })()
  memo.set(key, p)
  p.catch(() => memo.delete(key))
  return p
}

// Combos, die komplett im Deck sind, und solche, denen genau eine Karte fehlt
export async function findCombos(commanders, rows) {
  const data = await post('/find-my-combos?limit=500', deckBody(commanders, rows))
  const r = data.results || data
  return { included: r.included || [], almost: r.almostIncluded || [], identity: r.identity }
}

export const estimateBracket = (commanders, rows) => post('/estimate-bracket', deckBody(commanders, rows))

export const comboUrl = (id) => `https://commanderspellbook.com/combo/${id}/`
