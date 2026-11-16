// ManaBox-CSV einlesen
import Papa from 'papaparse'
import { entryKey } from './store'

export function parseManaBox(text) {
  const { data, errors } = Papa.parse(text, { header: true, skipEmptyLines: true })
  if (!data.length || !('Scryfall ID' in data[0])) {
    throw new Error('Das sieht nicht nach einem ManaBox-Export aus (Spalte „Scryfall ID“ fehlt).')
  }
  const entries = {}
  const byBinder = {}
  let cards = 0
  for (const r of data) {
    const id = r['Scryfall ID']?.trim()
    const qty = Number(r['Quantity'] || 0)
    if (!id || !qty) continue
    // Proxys (in ManaBox markiert) bekommen eine eigene „Ausführung“ ohne Marktwert
    const finish = r['Proxy'] === 'true' ? 'proxy' : ['foil', 'etched'].includes(r['Foil']) ? r['Foil'] : 'normal'
    const k = entryKey(id, finish)
    entries[k] = { id, finish, qty: (entries[k]?.qty || 0) + qty }
    const b = (r['Binder Name'] || '').trim() || 'Ohne Ordner'
    const be = (byBinder[b] ||= {})
    be[k] = { id, finish, qty: (be[k]?.qty || 0) + qty }
    cards += qty
  }
  return { entries, byBinder, cards, rows: data.length, errors: errors.length }
}
