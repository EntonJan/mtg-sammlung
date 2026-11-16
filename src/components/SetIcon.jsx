import { useEffect, useState } from 'react'
import { getSetIcons } from '../scryfall'

// Set-Symbol in Seltenheitsfarbe (wie auf der Karte), damit man die Edition am Symbol erkennt
export default function SetIcon({ set, rarity = 'common', size = 22, title }) {
  const [map, setMap] = useState(null)
  useEffect(() => { let alive = true; getSetIcons().then((m) => alive && setMap(m)); return () => { alive = false } }, [])
  const url = map?.[set] || `https://svgs.scryfall.io/sets/${set}.svg`
  return (
    <span className={`set-icon rar-${rarity}`} title={title || set?.toUpperCase()}
      style={{ width: size, height: size, WebkitMaskImage: `url(${url})`, maskImage: `url(${url})` }} />
  )
}
