import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Config aparte de vite.config.js a propósito: los tests de componentes
// (src/**/*.test.jsx) no necesitan el hash de build de AcercaDe.jsx ni
// corren nunca contra un servidor real -- sólo jsdom + React. .test.js
// (sin JSX) se agregó para helpers puros extraídos de un componente (ver
// dedupeLotesPorFarm.js), mismo criterio que guardSecuencia.test.mjs pero
// con vitest en vez de node:test, para no depender de env vars/Firestore.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.jsx', 'src/**/*.test.js'],
  },
})
