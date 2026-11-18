import { useState } from 'react'

// Kleines „i“ mit Erklärung: am PC beim Drüberfahren, am Handy per Antippen
export default function Info({ children }) {
  const [open, setOpen] = useState(false)
  return (
    <span className={`info ${open ? 'open' : ''}`} tabIndex={0} role="button" aria-label="Erklärung"
      onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }} onBlur={() => setOpen(false)}>
      i
      <span className="info-pop" role="tooltip">{children}</span>
    </span>
  )
}
