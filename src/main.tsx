import './lib/utils/initLogging';
import './lib/utils/sw-safety';
import { reloadOnceForChunkError } from './lib/utils/chunkReload';
import { reportBootPhase } from './lib/bootProgress';
import { isPublicSharePath } from './lib/sharePath';
import { installConsoleCapture } from './lib/diagnostics/logBuffer';
import { addOriginTrialToken } from './lib/agent/modelContext';
import { installResumeRestore } from './lib/resumeRestore';
import { installReloadLog } from './lib/reloadReason';
import { logLastHang } from './lib/db/dbHealth';
import { keepPageInPlace } from './lib/keyboardViewport';
import { routeExternalLinks } from './lib/native';
import { inTauriApp } from './lib/db/databaseKey';
import { registerMacReminderScheduler } from './lib/native/macNotifications';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/syntax.css'
import App from './App.tsx'
import { BootErrorScreen } from './components/layout/SplashScreen'

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
  // Settings → Diagnostics shows these warnings and errors on a phone (#800). The log is saved
  // to the local database, which a public share page never opens.
  installConsoleCapture();
}

// Native app: external links open in an in-app browser, not in the app's web view (#1188).
routeExternalLinks();

// macOS app: the daily reminder is scheduled with UserNotifications (#1123).
registerMacReminderScheduler();

// WebMCP is a Chrome origin trial: the token must be on the page before the browser sets up the API.
addOriginTrialToken(import.meta.env.VITE_WEBMCP_OT_TOKEN);

// Logs why the page reloaded by itself, after the console capture so Diagnostics keeps it (#1368).
installReloadLog();
// The last session's database hang, in the same log (#1467).
logLastHang();

// Puts a page iOS reloaded in the background back where it was (#1187).
installResumeRestore();

// The software keyboard never scrolls the app's page, so top bars stay put (#1300).
keepPageInPlace();

// Main bundle parsed and executing — first boot milestone for the splash bar.
reportBootPhase('react');

// e2e-only readiness hooks (window.__journalE2E) — dynamic import keeps this
// out of the production bundle entirely.
if (import.meta.env.MODE === 'e2e') {
  void import('./lib/e2e/testHooks');
}

const root = createRoot(document.getElementById('root')!)
const render = () => root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Native app: the Homebase sign-in is in the OS keychain, read before anything asks for it (#1429).
if (inTauriApp()) {
  const showBootError = () => root.render(<BootErrorScreen />)
  import('./lib/native/nativeBoot')
    .then(({ prepareNativeBoot }) => prepareNativeBoot(showBootError))
    .then((ready) => ready ? render() : showBootError());
} else {
  render();
}
