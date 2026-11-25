import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { createHostedApp } from './app';
import { sqliteKv } from './kv';
import { nodeListener } from './node';
import { installPublicOnlyFetch } from './publicFetch';

// The hosted Journal MCP (#1505): `node dist/http.mjs`, built by `npm run mcp:hosted:build` (mcp/vite.hosted.config.ts).
// Runs as mcp@journal.service behind the mcp-gateway router and tunnel (github.com/2002Bishwajeet/mcp-gateway),
// started by mcp/deploy/start. Listens on 127.0.0.1 only.
const origin = (process.env.MCP_PUBLIC_ORIGIN || process.env.JOURNAL_MCP_ORIGIN || 'https://mcp.cloudx.run').replace(/\/+$/, '');
const port = Number(process.env.PORT || 8781);
const dbPath = process.env.JOURNAL_MCP_DB || 'data/grants.sqlite';
mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });

installPublicOnlyFetch();
const kv = sqliteKv(dbPath);
setInterval(() => kv.purgeExpired(), 60 * 60 * 1000).unref();
const app = createHostedApp({ origin, kv });
createServer(nodeListener(app.fetch, origin)).listen(port, '127.0.0.1', () => {
    console.error(`Journal MCP (hosted) on 127.0.0.1:${port}, serving ${origin}/journal/mcp`);
});
