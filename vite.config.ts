import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// Wersja aplikacji = wersja z package.json. Najnowszy wpis w src/releases.json musi mieć tę samą wersję:
// każda aktualizacja dla zespołu ma opis i ikonę w oknie „Co nowego”.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
const releases = JSON.parse(readFileSync(new URL('./src/releases.json', import.meta.url), 'utf8')) as { version: string; icon: string }[]
if (releases[0]?.version !== pkg.version) {
  throw new Error(`package.json ma wersję ${pkg.version}, a najnowszy wpis w src/releases.json — ${releases[0]?.version}. Dopisz opis zmian.`)
}
if (!releases.every((r) => r.icon)) throw new Error('Każda wersja w src/releases.json potrzebuje ikony (pole "icon").')

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173, strictPort: true },
  optimizeDeps: { exclude: ['@jsquash/webp'] },
})
