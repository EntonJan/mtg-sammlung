import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base = Repo-Name, damit GitHub Pages (entonjan.github.io/mtg-sammlung/) die Dateien findet
export default defineConfig({
  plugins: [react()],
  // Web (GitHub Pages) unter /mtg-sammlung/, in der Android-App relativ (CAP=1)
  base: process.env.CAP ? './' : '/mtg-sammlung/',
})
