import { useEffect, useState } from 'react'
import { getSetIcons } from '../scryfall'

// Set-Symbol in Seltenheitsfarbe (wie auf der Karte), damit man die Edition am Symbol erkennt
export default function SetIcon({ set, rarity = 'common', size = 22, title }) {
  const [map, setMap] = useState(null)
  const [broken, setBroken] = useState(false)
  useEffect(() => { let alive = true; getSetIcons().then((m) => alive && setMap(m)); return () => { alive = false } }, [])
  if (broken || !set) return null
  const url = map?.[set] || `https://svgs.scryfall.io/sets/${set}.svg`
  return (
    <img className={`set-icon rar-${rarity}`} src={url} alt={set.toUpperCase()} title={title || set.toUpperCase()}
      width={size} height={size} loading="lazy" onError={() => setBroken(true)} />
  )
}
