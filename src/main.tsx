import './lib/utils/initLogging';
import './lib/utils/sw-safety';
import { reportBootPhase } from './lib/bootProgress';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/syntax.css'
import App from './App.tsx'

// Import memory monitor for dev debugging (exposes window.memoryMonitor)
import './lib/utils/memoryMonitor'

// Request persistent storage so the browser won't evict IndexedDB/Cache under storage pressure
navigator.storage?.persist?.();

// Main bundle parsed and executing — first boot milestone for the splash bar.
reportBootPhase('react');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
