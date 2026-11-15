// Decklisten als Text einlesen (Archidekt, Moxfield, MTG Arena, einfache Listen)
//
// Unterstützte Zeilen, z. B.:
//   1 Sol Ring
//   1x Sol Ring (C21) 263
//   1 Atraxa, Praetors' Voice *CMDR*
//   1x Command Tower (cmm) 410 [Land]
//   1 Lightning Greaves (2XM) 258 *F*
// Abschnitte: „Commander“, „// Commander“, „Deck“, „Sideboard“/„Maybeboard“ (werden übersprungen)

const SECTION = /^(?:\/\/\s*)?(commander|commanders|companion|deck|main|mainboard|sideboard|maybeboard|considering|tokens?)\s*:?\s*(?:\(\d+\))?$/i
const SKIP_SECTIONS = /sideboard|maybeboard|considering|tokens?/i

export function parseDecklist(text) {
  const lines = []
  let section = 'deck'
  for (let raw of text.split(/\r?\n/)) {
    raw = raw.trim()
    if (!raw || raw.startsWith('#')) continue
    const sec = raw.match(SECTION)
    if (sec) { section = sec[1].toLowerCase(); continue }
    if (raw.startsWith('//')) continue
    if (SKIP_SECTIONS.test(section)) continue

    let line = raw
    let commander = /^commanders?$/.test(section) || /\*CMDR\*/i.test(line)
    // Archidekt-Kategorien [Commander{top}], [Ramp] und ^Tags^
    const cats = [...line.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1])
    if (cats.some((c) => /commander/i.test(c))) commander = true
    if (cats.some((c) => /maybeboard|sideboard/i.test(c))) continue
    const foil = /\*F\*/i.test(line) ? 'foil' : /\*E\*/i.test(line) ? 'etched' : 'normal'
    line = line.replace(/\[[^\]]*\]/g, '').replace(/\^[^^]*\^/g, '').replace(/\*[A-Z]+\*/gi, '').trim()

    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i)
    const qty = m ? Number(m[1]) : 1
    let rest = m ? m[2] : line

    let set = null, num = null
    const sm = rest.match(/^(.*?)\s+\(([A-Za-z0-9]{2,6})\)\s*([^\s]+)?\s*$/)
    if (sm) { rest = sm[1]; set = sm[2].toLowerCase(); num = sm[3] || null }
    const name = rest.replace(/\s+/g, ' ').trim()
    if (!name || !qty) continue
    lines.push({ qty, name, set, num, finish: foil, commander, raw })
  }
  return lines
}
