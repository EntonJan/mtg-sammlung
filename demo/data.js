// Beispieldaten für die Demo-Version (nur Kartennamen – Bilder und Preise kommen live von Scryfall)
export const slug = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const ATRAXA_SPELLS = [
  'Sol Ring', 'Arcane Signet', 'Fellwar Stone', 'Cultivate', "Kodama's Reach", 'Farseek', "Nature's Lore", 'Three Visits', 'Birds of Paradise', 'Llanowar Elves', 'Smothering Tithe',
  'Rhystic Study', 'Phyrexian Arena', 'Inspiring Call', 'Mulldrifter', "Night's Whisper", 'Sign in Blood', 'Guardian Project',
  'Swords to Plowshares', 'Path to Exile', 'Beast Within', 'Anguished Unmaking', "Assassin's Trophy", 'Generous Gift', 'Counterspell', 'Arcane Denial', 'Cyclonic Rift',
  'Wrath of God', 'Toxic Deluge', 'Farewell',
  'Doubling Season', 'Hardened Scales', 'Corpsejack Menace', 'Winding Constrictor', 'Rishkar, Peema Renegade', 'Evolution Sage', 'Flux Channeler', 'Inexorable Tide',
  'Vorinclex, Monstrous Raider', 'The Ozolith', 'Deepglow Skate', "Tezzeret's Gambit", 'Contagion Engine', 'Grateful Apparition', 'Thrummingbird',
  'Sword of Truth and Justice', "Atraxa's Skitterfang", 'Teferi, Temporal Archmage', 'Nissa, Who Shakes the World', 'Tamiyo, Field Researcher', 'Kaya the Inexorable',
  'Heroic Intervention', 'Lightning Greaves', 'Swiftfoot Boots', 'Kodama of the West Tree', 'Pir, Imaginative Rascal', 'Bloom Tender', 'Sakura-Tribe Elder',
  'Fertilid', 'Ajani, Mentor of Heroes', 'Bloated Contaminator', 'Ezuri, Stalker of Spheres', 'Vraska, Betrayal\'s Sting',
]
const ATRAXA_LANDS = [
  'Command Tower', 'Exotic Orchard', 'Path of Ancestry', "Karn's Bastion", 'Temple Garden', 'Breeding Pool', 'Overgrown Tomb', 'Watery Grave', 'Hallowed Fountain',
  'Godless Shrine', 'Opulent Palace', 'Sandsteppe Citadel', 'Arcane Sanctum', 'Evolving Wilds', 'Terramorphic Expanse', 'Fabled Passage',
]
const basics = 100 - 1 - ATRAXA_SPELLS.length - ATRAXA_LANDS.length
const BASICS = { Forest: Math.ceil(basics * 0.35), Plains: Math.floor(basics * 0.22), Island: Math.floor(basics * 0.22) }
BASICS.Swamp = basics - BASICS.Forest - BASICS.Plains - BASICS.Island

const PROSPER = ['Prosper, Tome-Bound', 'Ragavan, Nimble Pilferer', 'Jeska\'s Will', 'Light Up the Stage', 'Reckless Impulse', 'Professional Face-Breaker', 'Valakut Exploration',
  'Laelia, the Blade Reforged', 'Bedlam Reveler', 'Chaos Warp', 'Blasphemous Act', 'Talisman of Indulgence', 'Rakdos Signet', 'Mind Stone', 'Gonti, Lord of Luxury', 'Dragonskull Summit', 'Sulfurous Springs', 'Blood Crypt']

const TRADE = ['Jeweled Lotus', 'Mana Vault', 'Dockside Extortionist', 'Fierce Guardianship', 'Force of Will', "Gaea's Cradle", 'The One Ring', 'Esper Sentinel', 'Deflecting Swat']

const FREE = ['Lightning Bolt', 'Llanowar Elves', 'Counterspell', 'Sol Ring', 'Swords to Plowshares', 'Demonic Tutor', 'Thoughtseize', 'Ponder', 'Brainstorm', 'Preordain', 'Opt',
  'Eternal Witness', 'Reclamation Sage', 'Elvish Mystic', 'Craterhoof Behemoth', 'Avenger of Zendikar', 'Beast Whisperer', 'Guardian Project', 'Lotus Cobra', 'Tireless Tracker',
  'Thalia, Guardian of Thraben', 'Esper Sentinel', 'Wrath of God', 'Austere Command', 'Teferi\'s Protection', 'Dark Confidant', 'Bloodline Keeper', 'Phyrexian Rager', 'Gray Merchant of Asphodel',
  'Krenko, Mob Boss', 'Goblin Matron', 'Purphoros, God of the Forge', 'Etali, Primal Storm', 'Dragon Tempest', 'Sarkhan, Fireblood', 'Snapcaster Mage', 'Cryptic Command', 'Thassa\'s Oracle',
  'Arcane Signet', 'Talisman of Dominance', 'Fellwar Stone', 'Chromatic Lantern', 'Command Tower', 'Exotic Orchard', 'Reliquary Tower', 'Bojuka Bog', 'Rogue\'s Passage', 'Strip Mine',
  'Lightning Greaves', 'Skullclamp', 'Mind Stone', 'Smothering Tithe', 'Mystic Remora', 'Cultivate', 'Rampant Growth', 'Harmonize', 'Beast Within', 'Chaos Warp']

export const DECKS = [
  { id: 'atraxa', name: 'Atraxa – Marker', commander: "Atraxa, Praetors' Voice", list: [["Atraxa, Praetors' Voice", 1], ...ATRAXA_SPELLS.map((n) => [n, 1]), ...ATRAXA_LANDS.map((n) => [n, 1]), ...Object.entries(BASICS)], side: ['Ezuri, Stalker of Spheres'] },
  { id: 'prosper', name: 'Prosper (im Aufbau)', commander: 'Prosper, Tome-Bound', list: PROSPER.map((n) => [n, 1]) },
  { id: 'tausch', name: 'Tauschordner', kind: 'binder', list: TRADE.map((n) => [n, 1]) },
]
export const FREE_CARDS = FREE.map((n, i) => [n, i % 7 === 0 ? 3 : i % 3 === 0 ? 2 : 1])
export const FOILS = new Set(['Doubling Season', 'Lightning Bolt', 'The One Ring', 'Rhystic Study'])
export const WISHLIST = ['Ancient Tomb', 'Bloom Tender', 'Chromatic Lantern', 'Cyclonic Rift', 'Doubling Season']
export const ALL_NAMES = [...new Set([...DECKS.flatMap((d) => d.list.map(([n]) => n)), ...FREE_CARDS.map(([n]) => n), ...WISHLIST, ...DECKS.flatMap((d) => d.side || [])])]
