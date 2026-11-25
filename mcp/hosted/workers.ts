// Stands in for `cloudflare:workers`, @cloudflare/workers-oauth-provider's only Workers import (aliased in
// mcp/vite.hosted.config.ts and vitest.config.ts). The library uses WorkerEntrypoint only in `instanceof` checks.
export class WorkerEntrypoint {}

// The library enables CIMD only under this Workers flag, which promises a fetch that can't reach private
// addresses. Set here because the library reads it as it loads, and this module loads first; the promise
// is kept by mcp/hosted/publicFetch.ts, which mcp/hosted/main.ts installs before it serves anything.
(globalThis as { Cloudflare?: unknown }).Cloudflare = { compatibilityFlags: { global_fetch_strictly_public: true } };
