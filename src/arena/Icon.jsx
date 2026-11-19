// Ersatz für die lucide-Icons der Lounge (nur die wenigen, die der Spieltisch nutzt)
const P = {
  x: 'M6 6l12 12M18 6L6 18',
  'trash-2': 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  'plus-circle': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v8M8 12h8',
  play: 'M8 5l11 7-11 7z',
  'log-out': 'M15 4h4v16h-4M10 16l-4-4 4-4M6 12h10',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
}
export default function Icon({ name, className, ...rest }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={P[name] || P.x} />
    </svg>
  )
}
