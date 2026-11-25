import { isMainThread } from 'node:worker_threads';
import { installPublicOnlyFetch } from './publicFetch';
import { installSafeConsole } from './safeConsole';

// The hosted Journal MCP (#1505): `node dist/http.mjs`, built by `npm run mcp:hosted:build` (mcp/vite.hosted.config.ts).
// The bundle is also run_script's worker (mcp/hosted/scripts.ts starts it on its own file), so it stays one file;
// each half is imported only on its own thread.
// Both threads: no secret in a log line, and no fetch to a non-public address (none at all off the main thread).
installSafeConsole();
if (isMainThread) {
    installPublicOnlyFetch();
    await import('./server');
} else {
    // run_script's sandbox fetches nothing (and has no relay settings): a fetch there fails rather than go direct.
    globalThis.fetch = () => Promise.reject(new Error('No network on the script worker'));
    await import('./scriptWorker');
}
