// Hosted MCP spike (#1504), questions 2 and 3: @cloudflare/workers-oauth-provider 1.3.0 on Node 26,
// issuer and resource under a path prefix, SQLite KV, node:http bridge, SSRF-safe CIMD fetch,
// the full grant flow driven by the official MCP SDK client (the code MCP Inspector runs).
//
// Not part of any build: the libraries are installed outside the repo, so the build issue decides on them.
//   npm i --prefix /tmp/oauth-spike @cloudflare/workers-oauth-provider@1.3.0 undici@8.13.1
//   node mcp/spike/oauthOnNode.mjs /tmp/oauth-spike node_modules
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { lookup as dnsLookup } from 'node:dns';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const [PKGS, JOURNAL_NM] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(p).href);

// 1. The library's only Workers import: `WorkerEntrypoint`, used only in `instanceof` checks.
registerHooks({
    resolve(specifier, context, next) {
        if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class WorkerEntrypoint {}', shortCircuit: true };
        return next(specifier, context);
    },
});

// 2. SSRF-safe global fetch, so the CIMD flag can be set honestly: every connection (each redirect hop too)
// goes through one connector that refuses non-public addresses, for IP literals and DNS answers alike.
const undici = await imp(path.join(PKGS, 'node_modules/undici/index.js'));
const blocked = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) blocked.addSubnet(a, p, 'ipv6');
// net.BlockList checks an IPv4-mapped IPv6 address (::ffff:7f00:1) against the IPv4 rules.
const isBlocked = (ip) => blocked.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
const publicLookup = (host, o, done) =>
    dnsLookup(host, { ...o, all: true }, (err, addrs) => {
        if (err) return done(err);
        const bad = addrs.find((x) => isBlocked(x.address));
        if (bad) return done(new Error(`blocked non-public address ${bad.address} for ${host}`));
        o.all ? done(null, addrs) : done(null, addrs[0].address, addrs[0].family);
    });
// net/tls skip `lookup` for an IP literal, so literals are checked here; names are checked on every DNS answer.
const baseConnect = undici.buildConnector({ lookup: publicLookup });
const publicOnly = new undici.Agent({
    connect(opts, cb) {
        const host = opts.hostname.replace(/^\[|\]$/g, '');
        if (net.isIP(host) && isBlocked(host)) return cb(new Error(`blocked non-public address ${host}`), null);
        return baseConnect(opts, cb);
    },
});
const rawFetch = globalThis.fetch; // the test client's own fetch (it talks to 127.0.0.1)
globalThis.fetch = (input, init) => undici.fetch(input, { ...init, dispatcher: publicOnly });
globalThis.Cloudflare = { compatibilityFlags: { global_fetch_strictly_public: true } };

const lib = await imp(path.join(PKGS, 'node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.js'));
const { getRequestListener } = await imp(path.join(JOURNAL_NM, '@hono/node-server/dist/index.mjs'));
const sdk = (p) => imp(path.join(JOURNAL_NM, '@modelcontextprotocol/sdk/dist/esm', p));
const { McpServer } = await sdk('server/mcp.js');
const { WebStandardStreamableHTTPServerTransport } = await sdk('server/webStandardStreamableHttp.js');
const { Client } = await sdk('client/index.js');
const { StreamableHTTPClientTransport } = await sdk('client/streamableHttp.js');
const { UnauthorizedError } = await sdk('client/auth.js');

// 3. KV namespace on SQLite: get (text/json), put (expirationTtl/expiration/metadata), delete, list (prefix/limit/cursor).
function sqliteKv(file) {
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, metadata TEXT, expiration INTEGER)');
    const now = () => Math.floor(Date.now() / 1000);
    const LIVE = '(expiration IS NULL OR expiration > ?)';
    return {
        db,
        async get(key, opts) {
            const type = typeof opts === 'string' ? opts : (opts?.type ?? 'text');
            const row = db.prepare(`SELECT value FROM kv WHERE key = ? AND ${LIVE}`).get(key, now());
            if (!row) return null;
            if (type === 'json') return JSON.parse(row.value);
            if (type !== 'text') throw new Error(`kv.get type ${type} not shimmed`);
            return row.value;
        },
        async put(key, value, opts = {}) {
            if (typeof value !== 'string') throw new Error('kv.put: only string values are shimmed');
            const expiration = opts.expiration ?? (opts.expirationTtl ? now() + opts.expirationTtl : null);
            db.prepare('INSERT OR REPLACE INTO kv (key, value, metadata, expiration) VALUES (?, ?, ?, ?)').run(key, value, opts.metadata === undefined ? null : JSON.stringify(opts.metadata), expiration);
        },
        async delete(key) {
            db.prepare('DELETE FROM kv WHERE key = ?').run(key);
        },
        async list({ prefix = '', limit = 1000, cursor } = {}) {
            const rows = db
                .prepare(`SELECT key, metadata, expiration FROM kv WHERE substr(key, 1, ?) = ? AND key > ? AND ${LIVE} ORDER BY key LIMIT ?`)
                .all(prefix.length, prefix, cursor ?? '', now(), limit + 1);
            const page = rows.slice(0, limit);
            const done = rows.length <= limit;
            return {
                keys: page.map((r) => ({ name: r.key, ...(r.expiration ? { expiration: r.expiration } : {}), ...(r.metadata ? { metadata: JSON.parse(r.metadata) } : {}) })),
                list_complete: done,
                ...(done ? {} : { cursor: page.at(-1).key }),
            };
        },
        purgeExpired: () => db.prepare('DELETE FROM kv WHERE expiration IS NOT NULL AND expiration <= ?').run(now()),
    };
}

// 4. The deployment shape: one origin shared with other apps, Journal under /journal.
const ORIGIN = 'https://mcp.cloudx.run';
const ISSUER = `${ORIGIN}/journal`;
const RESOURCE = `${ORIGIN}/journal`;
const DB = path.join(tmpdir(), 'journal-oauth-spike.sqlite');
rmSync(DB, { force: true });

function build(kv) {
    const env = { OAUTH_KV: kv };
    const as = new lib.OAuthAuthorizationServer({
        issuer: ISSUER,
        resources: [RESOURCE],
        authorizeEndpoint: `${ISSUER}/authorize`,
        tokenEndpoint: `${ISSUER}/oauth/token`,
        clientRegistrationEndpoint: `${ISSUER}/oauth/register`,
        scopesSupported: ['journal', 'offline_access'],
        clientIdMetadataDocumentEnabled: true,
        accessTokenTTL: 3600,
    });
    const rs = new lib.OAuthResourceServer({
        resourceMetadata: { resource: RESOURCE, authorization_servers: [ISSUER], resource_name: 'Journal' },
        requiredScopes: ['journal'],
        validateToken: (e) => (resource, token) => as.validateToken(resource, token, e),
        handler: {
            async fetch(request, _env, ctx) {
                if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
                const server = new McpServer({ name: 'spike', version: '0.0.0' });
                server.registerTool('whoami', { description: 'The decrypted grant props' }, async () => ({ content: [{ type: 'text', text: JSON.stringify({ props: ctx.props, scope: ctx.auth.scope }) }] }));
                const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
                await server.connect(transport);
                return transport.handleRequest(request);
            },
        },
    });
    // The router: these are the only paths that must reach the Journal process.
    const route = async (request) => {
        const { pathname } = new URL(request.url);
        if (pathname === `${new URL(ISSUER).pathname}/authorize`) {
            // Stand-in for the consent UI (out of scope): approve at once, binding the Homebase login to the grant.
            const oauth = as.getOAuthApi(env);
            const authRequest = await oauth.parseAuthRequest(request);
            const { redirectTo } = await oauth.completeAuthorization({
                request: authRequest,
                userId: 'owner.example.com',
                metadata: {},
                scope: authRequest.scope,
                props: { identity: 'owner.example.com', clientAuthToken: 'SECRET-TOKEN', sharedSecret: 'SECRET-KEY' },
            });
            return Response.redirect(redirectTo, 302);
        }
        if (pathname === '/journal' || pathname === '/.well-known/oauth-protected-resource/journal') return rs.fetch(request, env, ctx());
        if (pathname.startsWith('/journal/') || pathname === '/.well-known/oauth-authorization-server/journal') return as.fetch(request, env, ctx());
        return new Response('not found', { status: 404 });
    };
    return { env, as, route };
}
const ctx = () => ({ waitUntil() {}, passThroughOnException() {}, props: {} });

let app = build(sqliteKv(DB));
// 5. node:http <-> Request/Response. The public origin is fixed here, never taken from Host or X-Forwarded-*.
const listener = getRequestListener(async (request) => {
    const url = new URL(request.url);
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
    return app.route(new Request(ORIGIN + url.pathname + url.search, { method: request.method, headers: request.headers, body, redirect: 'manual' }));
});
const httpServer = createServer(listener);
await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
const LOCAL = `http://127.0.0.1:${httpServer.address().port}`;
const localFetch = (input, init) => rawFetch(String(input instanceof Request ? input.url : input).replace(ORIGIN, LOCAL), init);
const results = {};
const log = (k, v) => {
    results[k] = v;
    console.log(`${k}:`, typeof v === 'string' ? v : JSON.stringify(v));
};

// Q2: discovery by hand.
const unauth = await localFetch(RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
log('401 status', unauth.status);
log('401 WWW-Authenticate', unauth.headers.get('www-authenticate'));
const prm = await localFetch(`${ORIGIN}/.well-known/oauth-protected-resource/journal`);
log('PRM status', prm.status);
log('PRM', await prm.json());
const asm = await localFetch(`${ORIGIN}/.well-known/oauth-authorization-server/journal`);
log('ASM status', asm.status);
const asMeta = await asm.json();
log('ASM', asMeta);
for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server', '/.well-known/openid-configuration/journal', '/journal/.well-known/openid-configuration', '/journal/.well-known/oauth-authorization-server']) {
    log(`GET ${p}`, (await localFetch(ORIGIN + p)).status);
}

// Q2 + Q3: the official SDK client does discovery, DCR, PKCE, token exchange and the MCP call.
const REDIRECT = 'http://127.0.0.1:1/callback';
const store = {};
const provider = {
    get redirectUrl() { return REDIRECT; },
    get clientMetadata() { return { client_name: 'spike-client', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }; },
    clientInformation: () => store.client,
    saveClientInformation: (c) => void (store.client = c),
    tokens: () => store.tokens,
    saveTokens: (t) => void (store.tokens = t),
    codeVerifier: () => store.verifier,
    saveCodeVerifier: (v) => void (store.verifier = v),
    redirectToAuthorization: (u) => void (store.authUrl = u),
};
const transport1 = new StreamableHTTPClientTransport(new URL(RESOURCE), { authProvider: provider, fetch: localFetch });
try {
    await new Client({ name: 'spike-client', version: '0.0.0' }).connect(transport1);
    log('sdk first connect', 'unexpectedly authorized');
} catch (e) {
    log('sdk first connect', e instanceof UnauthorizedError ? 'UnauthorizedError (expected): redirected to authorize' : `ERROR ${e.message}`);
}
log('sdk registered client (DCR)', { client_id: store.client?.client_id?.slice(0, 8) + '…', token_endpoint_auth_method: store.client?.token_endpoint_auth_method });
log('sdk authorize URL', store.authUrl?.href.replace(/code_challenge=[^&]+/, 'code_challenge=…').replace(/state=[^&]+/, 'state=…'));
const consent = await localFetch(store.authUrl, { redirect: 'manual' });
const back = new URL(consent.headers.get('location'));
log('authorize -> redirect', { status: consent.status, to: back.origin + back.pathname, iss: back.searchParams.get('iss'), hasCode: !!back.searchParams.get('code') });
await transport1.finishAuth(back.searchParams.get('code'));
log('tokens', { token_type: store.tokens.token_type, expires_in: store.tokens.expires_in, scope: store.tokens.scope, hasRefresh: !!store.tokens.refresh_token });

const callWhoami = async () => {
    const client = new Client({ name: 'spike-client', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(RESOURCE), { authProvider: provider, fetch: localFetch }));
    const r = await client.callTool({ name: 'whoami', arguments: {} });
    await client.close();
    return JSON.parse(r.content[0].text);
};
log('MCP tool sees decrypted props', await callWhoami());

// Refresh: the token endpoint by hand, then the new access token works and the old refresh token is rotated.
const refresh = async (refreshToken) =>
    localFetch(asMeta.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: store.client.client_id, resource: RESOURCE }),
    });
const oldRefresh = store.tokens.refresh_token;
const r1 = await refresh(oldRefresh);
const refreshed = await r1.json();
log('refresh', { status: r1.status, newAccess: refreshed.access_token !== store.tokens.access_token, rotated: refreshed.refresh_token !== oldRefresh });
store.tokens = refreshed;
log('MCP after refresh', await callWhoami());

// Persistence: a fresh process-equivalent (new KV handle, new provider objects) still accepts the token.
app = build(sqliteKv(DB));
log('MCP after restart (same SQLite file)', await callWhoami());

// Storage: secrets and props never appear in clear.
const dump = app.env.OAUTH_KV.db.prepare('SELECT key, value FROM kv').all();
log('KV rows', dump.map((r) => r.key.replace(/:[^:]{12,}/g, ':…')));
log('KV holds props in clear?', dump.some((r) => r.value.includes('SECRET-TOKEN') || r.value.includes('SECRET-KEY')));
log('KV holds access token in clear?', dump.some((r) => r.value.includes(store.tokens.access_token) || r.key.includes(store.tokens.access_token)));

// KV listing through the helpers (prefix + cursor paging, grant metadata).
const oauth = app.as.getOAuthApi(app.env);
const grants = await oauth.listUserGrants('owner.example.com');
log('listUserGrants', { count: grants.items.length, scope: grants.items[0]?.scope, client: grants.items[0]?.clientId?.slice(0, 8) + '…' });
await localFetch(asMeta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'second', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }) });
const page1 = await oauth.listClients({ limit: 1 });
const page2 = await oauth.listClients({ limit: 1, cursor: page1.cursor });
log('listClients paging (limit 1)', { page1: page1.items.map((c) => c.clientName), cursor: !!page1.cursor, page2: page2.items.map((c) => c.clientName), done: page2.cursor === undefined });
await oauth.revokeGrant(grants.items[0].id, 'owner.example.com');
const afterRevoke = await localFetch(RESOURCE, { method: 'POST', headers: { authorization: `Bearer ${store.tokens.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
log('after revokeGrant', afterRevoke.status);

// TTL: an expired row is gone for get and list.
await app.env.OAUTH_KV.put('ttl:test', 'x', { expiration: Math.floor(Date.now() / 1000) - 1 });
log('expired row get/list', { get: await app.env.OAUTH_KV.get('ttl:test'), list: (await app.env.OAUTH_KV.list({ prefix: 'ttl:' })).keys.length });

// The public-only fetch itself: why each private target fails.
for (const u of ['https://127.0.0.1/', 'https://localhost/', 'https://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'https://127.0.0.1.nip.io/', 'https://[::ffff:127.0.0.1]/', 'https://vscode.dev/oauth/client-metadata.json']) {
    try {
        const res = await globalThis.fetch(u);
        log(`fetch ${u}`, `NOT BLOCKED: ${res.status}`);
    } catch (e) {
        log(`fetch ${u}`, e.cause?.message ?? e.message);
    }
}
// CIMD: a URL client_id is fetched through the public-only fetch.
for (const clientId of ['https://127.0.0.1/client.json', 'https://localhost/client.json', 'https://10.0.0.1/client.json', 'https://[::1]/client.json', 'https://vscode.dev/oauth/client-metadata.json']) {
    try {
        const info = await oauth.lookupClient(clientId);
        log(`CIMD ${clientId}`, info ? { client_name: info.clientName, redirect_uris: info.redirectUris } : null);
    } catch (e) {
        log(`CIMD ${clientId}`, `rejected: ${e.message}${e.cause ? ` (cause: ${e.cause.message ?? e.cause})` : ''}`);
    }
}

httpServer.close();
