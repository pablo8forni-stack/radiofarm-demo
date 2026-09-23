import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Config aparte de vite.config.js a propósito: los tests de componentes
// (src/**/*.test.jsx) no necesitan el hash de build de AcercaDe.jsx ni
// corren nunca contra un servidor real -- sólo jsdom + React.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.jsx'],
  },
})
