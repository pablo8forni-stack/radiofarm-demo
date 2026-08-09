import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Hash corto de git como "versión" de build -- ver AcercaDe.jsx. Sin esto
// no hay número de versión confiable (package.json#version nunca se
// actualiza) sin agregar un paso manual de release. El try/catch es sólo
// por si algún día se buildea fuera de un repo git (no pasa hoy, pero es
// gratis no romper el build por esto).
function gitShortHash() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_BUILD_HASH__: JSON.stringify(gitShortHash()),
    __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
})
