import './lib/utils/initLogging';
import './lib/utils/sw-safety';
import { reloadOnceForChunkError } from './lib/utils/chunkReload';
import { reportBootPhase } from './lib/bootProgress';
import { isPublicSharePath } from './lib/sharePath';
import { prewarmDatabase } from './lib/dbPrewarm';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/syntax.css'
import App from './App.tsx'

// Vite fires this when a lazy-loaded chunk fails to fetch/import (stale deploy,
// missing asset). Recover with a single reload instead of an unhandled rejection.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnceForChunkError()) {
    event.preventDefault();
  }
});

// Import memory monitor for dev debugging (exposes window.memoryMonitor)
import './lib/utils/memoryMonitor'

// Request persistent storage so the browser won't evict IndexedDB/Cache under storage pressure.
// A public share page never touches IndexedDB, so skip it there.
if (!isPublicSharePath(location.pathname)) {
  navigator.storage?.persist?.();
}

// Main bundle parsed and executing — first boot milestone for the splash bar.
reportBootPhase('react');

// A stored login means the DB will be needed: start its WASM fetch/compile now
// instead of after the auth round-trip. No-op on share pages and for visitors.
prewarmDatabase(location.pathname);

// e2e-only readiness hooks (window.__journalE2E) — dynamic import keeps this
// out of the production bundle entirely.
if (import.meta.env.MODE === 'e2e') {
  void import('./lib/e2e/testHooks');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
