import { manaSymbols } from '../util'

const BG = { W: '#f8f3d6', U: '#a9d6f5', B: '#bfb3b0', R: '#f4a68a', G: '#9ed3a8', C: '#d5d0cc' }

export default function Mana({ cost }) {
  const syms = manaSymbols(cost)
  if (!syms.length) return null
  return (
    <span className="mana">
      {syms.map((s, i) =>
        s === '//' ? (
          <span key={i} className="mana-sep">{"//"}</span>
        ) : (
          <span key={i} className="mana-sym" style={{ background: BG[s[0]] || '#cac5c0' }}>
            {s.replace('/', '')}
          </span>
        )
      )}
    </span>
  )
}
