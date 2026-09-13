import './lib/utils/initLogging';
import './lib/utils/sw-safety';
import { reportBootPhase } from './lib/bootProgress';
import { isPublicSharePath } from './lib/utils';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/syntax.css'
import App from './App.tsx'

// Import memory monitor for dev debugging (exposes window.memoryMonitor)
import './lib/utils/memoryMonitor'

// Main bundle parsed and executing — first boot milestone for the splash bar.
reportBootPhase('react');

// A public share page reads one note over the network and nothing else, so it
// skips both of these: no local database to warm, nothing to keep offline.
if (!isPublicSharePath()) {
    // Request persistent storage so the browser won't evict IndexedDB/Cache under storage pressure
    navigator.storage?.persist?.();

    // Warm-start PGlite. Every query sits behind AuthGuard, so without this the
    // 8.8 MB WASM fetch/compile only begins after the auth round-trip resolves.
    // getDatabase() is an idempotent cached promise, so the first real query just
    // awaits this already-running boot. A failure clears that cached promise, so
    // the real query path re-inits and surfaces its own error — this catch only
    // exists to keep the fire-and-forget call from raising an unhandled rejection.
    import('./lib/db/pglite').then((m) => m.getDatabase()).catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
