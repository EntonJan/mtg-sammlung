// Feine Linien-Symbole im Stil der Willkommensseite (Farbe = Textfarbe)
export function CameraIcon({ size = 17 }) {
  return (
    <svg className="ico-line" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h3l1.6-2.4h6.8L17 8h3v11H4z" />
      <circle cx="12" cy="13.2" r="3.4" />
      <path d="M17.6 10.4h.01" strokeWidth="2" />
    </svg>
  )
}

export function SearchIcon({ size = 16 }) {
  return (
    <svg className="ico-line" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" />
    </svg>
  )
}
