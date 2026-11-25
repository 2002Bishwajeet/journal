import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { MCP_PATH } from '../http';
import { createHostedApp } from './app';
import { purgeUploads, uploadsDb } from './images';
import { sqliteKv } from './kv';
import { nodeListener } from './node';

// The hosted Journal MCP's main thread (#1505), started by mcp/hosted/main.ts.
// Runs behind a reverse proxy. Listens on 127.0.0.1 only.
const origin = (process.env.MCP_PUBLIC_ORIGIN || process.env.JOURNAL_MCP_ORIGIN || 'https://mcp.cloudx.run').replace(/\/+$/, '');
const port = Number(process.env.PORT || 8781);
const dbPath = process.env.JOURNAL_MCP_DB || 'data/grants.sqlite';
// Owner-only files, grants.sqlite included, however the server was started.
process.umask(0o077);
mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });

const kv = sqliteKv(dbPath);
// Image uploads (#1506) in their own file next to the grants.
const uploads = uploadsDb(join(dirname(dbPath), 'uploads.sqlite'));
setInterval(() => {
    kv.purgeExpired();
    purgeUploads(uploads);
}, 10 * 60 * 1000).unref();
// In the bundle, this module's URL is the bundle: main.ts runs it as the script worker off the main thread.
const app = createHostedApp({ origin, kv, uploads, scriptWorker: new URL(import.meta.url) });
const server = createServer(nodeListener(app.fetch, origin, [MCP_PATH], app.opensLargeBody, app.validBearer));
// A client gets 30 s to send a whole request, 10 s for its headers: a slow upload can't hold its buffer open.
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(port, '127.0.0.1', () => {
    console.error(`Journal MCP (hosted) on 127.0.0.1:${port}, serving ${origin}${MCP_PATH}`);
});
