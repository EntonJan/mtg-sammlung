import { useEffect, useState } from 'react'
import { getSetIcons } from '../scryfall'

let iconMap = null

// Set-Symbol in Seltenheitsfarbe (wie auf der Karte), damit man die Edition am Symbol erkennt
export default function SetIcon({ set, rarity = 'common', size = 22, title }) {
  const [map, setMap] = useState(iconMap)
  const [failed, setFailed] = useState('')
  useEffect(() => {
    if (iconMap) return
    let alive = true
    getSetIcons().then((m) => { iconMap = m; if (alive) setMap(m) })
    return () => { alive = false }
  }, [])
  if (!set) return null
  if (!map) return <span className="set-icon-ph" style={{ width: size, height: size }} />
  const code = set.toLowerCase()
  const url = map[code] || `https://svgs.scryfall.io/sets/${code}.svg`
  if (failed === url) return <span className="set-icon-ph" style={{ width: size, height: size }} />
  return (
    <img className={`set-icon rar-${rarity}`} src={url} alt="" title={title || set.toUpperCase()}
      width={size} height={size} onError={() => setFailed(url)} />
  )
}
