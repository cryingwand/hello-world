import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './carrel.css'
import './styles.css'

// Carrel picks its colours from two attributes on <html>. The role comes from the main process
// (the preload), not from the page. The Stage ignores the theme, and the app is dark-only for now.
const SPACE = { launcher: 'everyday', vault: 'vault', stage: 'stage' } as const
const role = window.api.role
if (role) {
  document.documentElement.dataset.space = SPACE[role]
  if (role !== 'stage') document.documentElement.dataset.theme = 'dark'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
