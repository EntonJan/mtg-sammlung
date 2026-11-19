// Demo-Build: gleiche App, aber mit Beispieldaten statt Firebase (für Screenshots und zum Ausprobieren)
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const src = path.resolve('src')
const demo = path.resolve('demo')
const MAP = { firebase: 'firebase.js', store: 'store.js', share: 'share.js', friends: 'friends.js', scryfall: 'scryfall.js', tables: 'tables.js' }

export default defineConfig({
  base: '/mtg-sammlung/demo/',
  build: { outDir: 'dist/demo', emptyOutDir: true },
  plugins: [react(), {
    name: 'demo-daten', enforce: 'pre',
    resolveId(id, importer) {
      if (!importer || !importer.startsWith(src)) return null
      if (id === 'firebase/auth') return path.join(demo, 'auth.js')
      const m = id.match(/^\.\.?\/(firebase|store|share|friends|scryfall|tables)$/)
      return m ? path.join(demo, MAP[m[1]]) : null
    },
  }],
})
