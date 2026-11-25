import { createServer } from 'node:http';
import { createHostedApp } from './app';
import { sqliteKv } from './kv';
import { nodeListener } from './node';
import { installPublicOnlyFetch } from './publicFetch';

// The hosted Journal MCP (#1505): `node dist/http.mjs`, built by `npm run mcp:hosted:build` (mcp/vite.hosted.config.ts).
// Listens on 127.0.0.1 only; the router and the Cloudflare Tunnel in front of it are in mcp/deploy/ and mcp/README.md.
const origin = (process.env.JOURNAL_MCP_ORIGIN || 'https://mcp.cloudx.run').replace(/\/+$/, '');
const port = Number(process.env.PORT || 8791);
const dbPath = process.env.JOURNAL_MCP_DB;
if (!dbPath) {
    console.error('Set JOURNAL_MCP_DB to the SQLite file that keeps the grants.');
    process.exit(1);
}

installPublicOnlyFetch();
const kv = sqliteKv(dbPath);
setInterval(() => kv.purgeExpired(), 60 * 60 * 1000).unref();
const app = createHostedApp({ origin, kv });
createServer(nodeListener(app.fetch, origin)).listen(port, '127.0.0.1', () => {
    console.error(`Journal MCP (hosted) on 127.0.0.1:${port}, serving ${origin}/journal/mcp`);
});
