// Generic OAuth-on-Node adapter: no Journal imports, so another MCP server can copy it.
// Stands in for `cloudflare:workers`, @cloudflare/workers-oauth-provider's only Workers import (aliased in
// the MCP's vite and vitest configs). The library uses WorkerEntrypoint only in `instanceof` checks.
export class WorkerEntrypoint {}

// The library enables CIMD only under this Workers flag, which promises a fetch that can't reach private
// addresses. Set here because the library reads it as it loads, and this module loads first; the promise
// is kept by publicFetch.ts, which the entry point (e.g. mcp/hosted/main.ts) installs before it serves anything.
(globalThis as { Cloudflare?: unknown }).Cloudflare = { compatibilityFlags: { global_fetch_strictly_public: true } };
