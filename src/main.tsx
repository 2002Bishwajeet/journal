import './lib/utils/sw-safety';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Import memory monitor for dev debugging (exposes window.memoryMonitor)
import './lib/utils/memoryMonitor'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
