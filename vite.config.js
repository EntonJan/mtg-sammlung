import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base = Repo-Name, damit GitHub Pages (entonjan.github.io/mtg-sammlung/) die Dateien findet
export default defineConfig({
  plugins: [react()],
  base: '/mtg-sammlung/',
})
