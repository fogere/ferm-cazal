import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initBugReporter } from './services/bugReporter'

// Doit s'installer le plus tôt possible pour capturer même les erreurs
// au tout début du chargement de l'app.
initBugReporter()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
