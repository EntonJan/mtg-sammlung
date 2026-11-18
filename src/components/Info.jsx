import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Kleines „i“ mit Erklärung: am PC beim Drüberfahren, am Handy per Antippen.
// Das Fenster hängt am Seitenende (Portal) und wird im sichtbaren Bereich gehalten – nichts wird abgeschnitten oder überlappt den Rand.
export default function Info({ children }) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const pop = useRef(null)
  const show = open || hover

  useLayoutEffect(() => {
    if (!show || !ref.current) return
    const place = () => {
      const r = ref.current.getBoundingClientRect()
      const max = Math.min(300, window.innerWidth - 16)
      const w = Math.min(pop.current?.offsetWidth || max, max)
      const h = pop.current?.offsetHeight || 0
      let left = r.left + r.width / 2 - w / 2
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
      let top = r.top - h - 8
      if (top < 8) top = r.bottom + 8
      setPos({ left, top, max })
    }
    place()
    const raf = requestAnimationFrame(place)
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [show])

  return (
    <span ref={ref} className={`info ${show ? 'open' : ''}`} tabIndex={0} role="button" aria-label="Erklärung"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }} onBlur={() => setOpen(false)}>
      i
      {show && createPortal(
        <span ref={pop} className="info-pop" role="tooltip"
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, maxWidth: pos?.max ?? 300, width: 'max-content', visibility: pos ? 'visible' : 'hidden' }}>
          {children}
        </span>, document.body)}
    </span>
  )
}
