// Tailwind nur für den Spieltisch (src/arena): ohne Preflight, alles unter .arena-root,
// Farbpaletten auf Onyx-Gold umgestellt, damit die übernommene Lounge-Optik zum Rest der App passt.
const onyx = { 50: '#f6f1e4', 100: '#ece4cf', 200: '#dcd1b6', 300: '#c2b79c', 400: '#a0967f', 500: '#7d7563', 600: '#4b463d', 700: '#2f2c26', 800: '#1d1b17', 900: '#151411', 950: '#0d0c0a' }
const gold = { 50: '#fbf6e6', 100: '#f5eacb', 200: '#ecd9a2', 300: '#e4c886', 400: '#dcbd76', 500: '#d4b46a', 600: '#b8974f', 700: '#8a7340', 800: '#5e4f2c', 900: '#3a3120', 950: '#231d13' }
const steel = { 50: '#eef2f6', 100: '#dbe3ec', 200: '#bccad9', 300: '#98aec4', 400: '#7a93ad', 500: '#627b95', 600: '#4e647b', 700: '#3e4f62', 800: '#2c3846', 900: '#1d2530', 950: '#121820' }
const wine = { 50: '#fbeeee', 100: '#f5d6d6', 200: '#e9b0b0', 300: '#dc8a8a', 400: '#cf6c6c', 500: '#b85454', 600: '#9a4242', 700: '#7a3434', 800: '#552525', 900: '#3a1a1a', 950: '#241010' }
const moss = { 50: '#eff6ee', 100: '#d9ead6', 200: '#b8d6b2', 300: '#93bf8b', 400: '#78ab6f', 500: '#5f9156', 600: '#4b7444', 700: '#3b5a36', 800: '#2a4027', 900: '#1c2b1a', 950: '#111a10' }
const plum = { 50: '#f5f0f8', 100: '#e8dcef', 200: '#d2bbe0', 300: '#b796cb', 400: '#9d78b5', 500: '#835f9b', 600: '#6a4c7e', 700: '#523c61', 800: '#3a2b45', 900: '#261c2d', 950: '#17111b' }
export default {
  content: ['./src/arena/**/*.{js,jsx}'],
  important: '.arena-root',
  corePlugins: { preflight: false },
  // Zur Laufzeit zusammengesetzte Klassen (Hellsicht/Überwachen-Fenster)
  safelist: ['blue', 'purple', 'yellow'].flatMap((c) => [`border-${c}-500/60`, `text-${c}-400`, `bg-${c}-600`, `hover:bg-${c}-500`]),
  theme: {
    extend: {
      colors: {
        gray: onyx, slate: onyx, zinc: onyx, neutral: onyx, stone: onyx,
        yellow: gold, amber: gold, orange: gold,
        blue: steel, indigo: steel, sky: steel, cyan: steel,
        red: wine, rose: wine, green: moss, emerald: moss, purple: plum, violet: plum,
        mtg: { w: '#F9F3B7', u: '#3A62B7', b: '#1E1E1E', r: '#D64242', g: '#5B9567' },
      },
      fontFamily: { sans: ['"EB Garamond"', 'Georgia', 'serif'], title: ['Cinzel', 'serif'] },
    },
  },
}
