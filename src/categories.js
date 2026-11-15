// Eigene Deck-Kategorien (Ramp, Draw, …) mit Sollwerten und automatischen Vorschlägen

export const DEFAULT_CATS = [
  { name: 'Ramp', target: 10 },
  { name: 'Draw', target: 10 },
  { name: 'Removal', target: 8 },
  { name: 'Board Wipe', target: 3 },
  { name: 'Tutor', target: 2 },
  { name: 'Protection', target: 3 },
  { name: 'Win-Con', target: 3 },
]

export const catsOf = (deck) => deck.cats || DEFAULT_CATS
export const tagKey = (card) => card.oracleId || card.name

// Grobe Erkennung über den Regeltext – nur als Vorschlag gedacht
const RULES = {
  Ramp: [
    /\{T\}: Add \{/i,
    /add (one|two|three) mana/i,
    /search your library for (a|up to \w+) (basic )?lands?/i,
    /put (a|up to \w+) (basic )?land cards? .*onto the battlefield/i,
    /you may play an additional land/i,
  ],
  Draw: [/draws? (a|two|three|four|X|that many) cards?/i, /draw cards equal/i, /investigate/i],
  Removal: [
    /(destroy|exile) target (creature|artifact|enchantment|planeswalker|permanent|nonland)/i,
    /deals? \w+ damage to (any target|target creature)/i,
    /return target (creature|nonland permanent) to its owner's hand/i,
    /target (creature|player) sacrifices/i,
    /counter target spell/i,
  ],
  'Board Wipe': [/(destroy|exile) all (creatures|nonland permanents|artifacts|enchantments)/i, /each creature gets -\d+\/-\d+/i, /deals \w+ damage to each creature/i, /return all nonland permanents/i],
  Tutor: [/search your library for an? (card|creature|artifact|enchantment|instant|sorcery)(?! land)/i],
  Protection: [/(gain|gains|have|has) (hexproof|indestructible|shroud|protection)/i, /phase out/i],
  'Win-Con': [/you win the game/i, /each opponent loses \w+ life/i, /extra combat/i, /double strike/i],
}

export function suggestTags(card) {
  if (/Land/.test(card.type.split(' // ')[0])) return []
  const text = card.text || ''
  return Object.entries(RULES).filter(([, res]) => res.some((re) => re.test(text))).map(([k]) => k)
}
