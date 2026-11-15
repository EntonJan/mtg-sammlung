export const COLORS = ['W', 'U', 'B', 'R', 'G']
export const COLOR_NAMES = { W: 'Weiß', U: 'Blau', B: 'Schwarz', R: 'Rot', G: 'Grün', C: 'Farblos' }

export const TYPES = [
  ['Creature', 'Kreatur'],
  ['Instant', 'Spontanzauber'],
  ['Sorcery', 'Hexerei'],
  ['Enchantment', 'Verzauberung'],
  ['Artifact', 'Artefakt'],
  ['Planeswalker', 'Planeswalker'],
  ['Land', 'Land'],
  ['Battle', 'Kampf'],
  ['Legendary Creature', 'Legendäre Kreatur'],
]

export const RARITIES = [
  ['common', 'Common'],
  ['uncommon', 'Uncommon'],
  ['rare', 'Rare'],
  ['mythic', 'Mythic'],
  ['special', 'Special'],
]

export const FINISH_LABEL = { normal: '', foil: 'Foil', etched: 'Etched' }

export function unitPrice(card, finish) {
  if (!card) return null
  if (finish === 'normal') return card.eur ?? card.eurFoil
  return card.eurFoil ?? card.eur
}

export const euro = (v) =>
  v == null ? '–' : v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })

// Manakosten wie {2}{G}{G} in kleine farbige Symbole umwandeln
export function manaSymbols(cost) {
  if (!cost) return []
  return [...cost.matchAll(/\{([^}]+)\}|( \/\/ )/g)].map((m) => m[1] ?? '//')
}
