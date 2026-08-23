import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'

// En el nivel más externo posible -- para atrapar cualquier excepción que
// ocurra en la reconciliación de React, sin importar en qué pantalla pasó
// ni si el usuario está logueado todavía. Ver ErrorBoundary.jsx.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
