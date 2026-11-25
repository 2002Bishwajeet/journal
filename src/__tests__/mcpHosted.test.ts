import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { createHostedApp, RECONNECT_MESSAGE, RETRY_MESSAGE, type HomebaseDeps } from '../../mcp/hosted/app';
import { sqliteKv } from '../../mcp/hosted/kv';
import { nodeListener } from '../../mcp/hosted/node';
import { isBlockedAddress, publicOnlyAgent } from '../../mcp/hosted/publicFetch';
import { safeConsole } from '../../mcp/hosted/safeConsole';
import { SCRIPT_RUNNING, SCRIPTS_BUSY, scriptSlots, workerGuest } from '../../mcp/hosted/scripts';
import { runScript } from '../../mcp/runScript';
import { checkIdentity } from '../../mcp/youauth';
import type { McpDriveDeps } from '../../mcp/createServer';
import type { McpCredentials } from '../../mcp/credentials';
import type { NoteSummary } from '@/lib/agent/tools/read';

const ORIGIN = 'https://mcp.cloudx.run';
const ISSUER = `${ORIGIN}/journal`;
const RESOURCE = `${ORIGIN}/journal/mcp`;
const IDENTITY = 'owner.example.com';
const HB_TOKEN = 'HOMEBASE-APP-TOKEN-secret';
const HB_SECRET = 'HOMEBASE-SHARED-SECRET-secret';
const CIMD_ID = 'https://client.example/oauth/client.json';
const DAY_MS = 24 * 60 * 60 * 1000;

// The mocked outside world. The hosted app wraps fetch when it is first built, so this goes in before any test runs.
const realFetch = globalThis.fetch;
let homebaseStatus = 200;
const fakeFetchImpl = async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === CIMD_ID) {
        return Response.json({
            client_id: CIMD_ID,
            client_name: 'CIMD Client',
            redirect_uris: ['http://127.0.0.1/callback'],
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
        });
    }
    if (url.host === IDENTITY) return new Response('{}', { status: homebaseStatus });
    throw new Error(`unexpected fetch ${url.href}`);
};
const fakeFetch = vi.fn(fakeFetchImpl);
vi.stubGlobal('fetch', fakeFetch);

const NOTES: NoteSummary[] = [{ id: 'n1', title: 'Note One', folderId: 'F1', tags: [], modified: '2024-01-01T00:00:00.000Z' }];

let tokenValid: boolean | null = true;
const seenCreds: McpCredentials[] = [];
const checkedIdentities: string[] = [];
const finalized: { identity: string; algorithm: string; publicKey: string; salt: string }[] = [];
const homebase: HomebaseDeps = {
    checkIdentity: async (identity) => {
        checkedIdentities.push(identity);
        return identity === IDENTITY;
    },
    finalize: async (identity, privateKey, publicKey, salt) => {
        finalized.push({ identity, algorithm: privateKey.algorithm.name, publicKey, salt });
        return { clientAuthToken: HB_TOKEN, sharedSecret: HB_SECRET };
    },
    tokenValid: async () => tokenValid,
    driveDeps: (creds) => {
        seenCreds.push(creds);
        return {
            loadGrants: async () => ({ version: 1, folders: { F1: 'read' }, notes: {} }),
            listFolders: async () => [{ id: 'F1', name: 'Folder One' }],
            // A drive call, as the real providers make it: through fetch to the identity.
            listNotes: async () => {
                const response = await fetch(`https://${IDENTITY}/api/apps/v1/drive/query/batch`);
                if (!response.ok) throw new Error(`Request failed with status code ${response.status}`);
                return NOTES;
            },
        } as unknown as McpDriveDeps;
    },
};

// run_script's worker is the hosted bundle itself, as deployed: built once for this file.
let bundle: URL;
beforeAll(async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'journal-hosted-bundle-'));
    await build({ configFile: path.resolve(import.meta.dirname, '../../mcp/vite.hosted.config.ts'), logLevel: 'silent', build: { outDir } });
    bundle = pathToFileURL(path.join(outDir, 'http.mjs'));
}, 60_000);

function setup(rateLimit?: number) {
    const kv = sqliteKv(path.join(mkdtempSync(path.join(tmpdir(), 'journal-hosted-')), 'grants.sqlite'));
    const app = createHostedApp({ origin: ORIGIN, kv, homebase, rateLimit, scriptWorker: bundle });
    const appFetch = (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init));
    return { kv, app, appFetch };
}
type Setup = ReturnType<typeof setup>;

afterEach(() => {
    homebaseStatus = 200;
    tokenValid = true;
    vi.useRealTimers();
});

/** A browser's cookies, attributes ignored. */
function cookieJar() {
    const jar = new Map<string, string>();
    return {
        take(response: Response) {
            for (const cookie of response.headers.getSetCookie()) {
                const [pair] = cookie.split(';');
                const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
                if (/max-age=0/i.test(cookie) || !value) jar.delete(name);
                else jar.set(name, value);
            }
        },
        get header() {
            return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
        },
    };
}

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
async function pkce() {
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    return { verifier, challenge };
}

const form = (fields: Record<string, string>) => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
});

/**
 * The browser part: the consent page, its form, Homebase's approval (mocked: it redirects to the finalize URL
 * with identity, public_key, salt and the state it was given) and the callback. Returns every hop.
 */
async function signIn({ app }: Setup, authUrl: string | URL, { identity = IDENTITY, finalizeIdentity = identity }: { identity?: string; finalizeIdentity?: string } = {}) {
    const jar = cookieJar();
    const page = await app.fetch(new Request(authUrl));
    expect(page.status).toBe(200);
    jar.take(page);
    const html = await page.text();
    const handle = /name="handle" value="([^"]+)"/.exec(html)![1];

    const post = await app.fetch(
        new Request(`${ISSUER}/authorize`, { ...form({ handle, identity, action: 'approve' }), headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header } })
    );
    expect(post.status).toBe(302);
    jar.take(post);
    const youauth = new URL(post.headers.get('location')!);

    const finalize = new URL(youauth.searchParams.get('redirect_uri')!);
    for (const [k, v] of Object.entries({ identity: finalizeIdentity, public_key: 'HB-PUBLIC-KEY', salt: 'HB-SALT', state: youauth.searchParams.get('state')! })) {
        finalize.searchParams.set(k, v);
    }
    const back = await app.fetch(new Request(finalize, { headers: { cookie: jar.header } }));
    return { html, youauth, back, finalize, jar, location: back.headers.has('location') ? new URL(back.headers.get('location')!) : null };
}

function authorizeUrl(params: Record<string, string>): string {
    return `${ISSUER}/authorize?${new URLSearchParams({ response_type: 'code', state: 'client-state', scope: 'journal', resource: RESOURCE, code_challenge_method: 'S256', ...params })}`;
}

/** A client's whole flow by hand, from the authorize URL to its tokens: the CIMD client unless told otherwise. */
async function connectCimd(s: Setup, redirectUri = 'http://127.0.0.1:51234/callback', clientId = CIMD_ID) {
    const { verifier, challenge } = await pkce();
    const signedIn = await signIn(s, authorizeUrl({ client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge }));
    const code = signedIn.location!.searchParams.get('code')!;
    const response = await s.appFetch(`${ISSUER}/oauth/token`, form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri, resource: RESOURCE }));
    expect(response.status).toBe(200);
    return { ...signedIn, tokens: (await response.json()) as OAuthTokens };
}

const refresh = (s: Setup, refreshToken: string, extra: Record<string, string> = {}) =>
    s.appFetch(`${ISSUER}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CIMD_ID, resource: RESOURCE, ...extra }));

const mcp = (s: Setup, accessToken: string, body: unknown) =>
    s.appFetch(RESOURCE, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify(body),
    });
const listNotes = (s: Setup, accessToken: string) => mcp(s, accessToken, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'list_notes', arguments: {} } });
const runScriptCall = (s: Setup, accessToken: string, code: string) =>
    mcp(s, accessToken, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'run_script', arguments: { code } } });
const registerDcr = (s: Setup, body: unknown, ip = '203.0.113.1') =>
    s.appFetch(`${ISSUER}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify(body) });

describe('hosted MCP: discovery', () => {
    it('challenges an unauthenticated call and publishes path-prefixed resource and authorization server metadata', async () => {
        const s = setup();
        const unauth = await s.appFetch(RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        expect(unauth.status).toBe(401);
        expect(unauth.headers.get('www-authenticate')).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/journal/mcp"`);

        const prm = await (await s.appFetch(`${ORIGIN}/.well-known/oauth-protected-resource/journal/mcp`)).json();
        expect(prm).toMatchObject({ resource: RESOURCE, authorization_servers: [ISSUER] });

        const asm = await (await s.appFetch(`${ORIGIN}/.well-known/oauth-authorization-server/journal`)).json();
        expect(asm).toMatchObject({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/authorize`,
            token_endpoint: `${ISSUER}/oauth/token`,
            registration_endpoint: `${ISSUER}/oauth/register`,
            code_challenge_methods_supported: ['S256'],
            client_id_metadata_document_supported: true,
            authorization_response_iss_parameter_supported: true,
        });
        expect(asm.token_endpoint_auth_methods_supported).toContain('none');
        expect((await s.appFetch(`${ORIGIN}/.well-known/oauth-authorization-server`)).status).toBe(404);
    });
});

describe('hosted MCP: the OAuth flow', () => {
    it('takes the official SDK client through DCR, PKCE, consent, YouAuth and tool calls, with the Homebase token kept server-side', async () => {
        const s = setup();
        const REDIRECT = 'http://127.0.0.1:43123/callback';
        const store: { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; verifier?: string; authUrl?: URL } = {};
        const provider: OAuthClientProvider = {
            redirectUrl: REDIRECT,
            clientMetadata: { client_name: 'SDK Client', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
            clientInformation: () => store.client,
            saveClientInformation: (client) => void (store.client = client),
            tokens: () => store.tokens,
            saveTokens: (tokens) => void (store.tokens = tokens),
            codeVerifier: () => store.verifier!,
            saveCodeVerifier: (verifier) => void (store.verifier = verifier),
            redirectToAuthorization: (url) => void (store.authUrl = url),
        };
        const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), { authProvider: provider, fetch: s.appFetch });
        await expect(new Client({ name: 'sdk-client', version: '0' }).connect(transport)).rejects.toBeInstanceOf(UnauthorizedError);
        expect(store.authUrl!.searchParams.get('code_challenge_method')).toBe('S256');
        expect(store.authUrl!.searchParams.get('resource')).toBe(RESOURCE);

        const { html, youauth, location } = await signIn(s, store.authUrl!);
        expect(html).toContain('SDK Client');
        expect(html).toContain('127.0.0.1');
        // The YouAuth request: the Journal MCP app on the identity the user typed, named after the client.
        expect(youauth.origin + youauth.pathname).toBe(`https://${IDENTITY}/api/owner/v1/youauth/authorize`);
        expect(youauth.searchParams.get('client_id')).toBe('9fdd7bae5e9c453e8858b775ec892aee');
        expect(youauth.searchParams.get('client_info')).toBe('Journal MCP (SDK Client)');
        expect(youauth.searchParams.get('redirect_uri')).toBe(`${ISSUER}/callback`);
        expect(finalized.at(-1)).toEqual({ identity: IDENTITY, algorithm: 'ECDH', publicKey: 'HB-PUBLIC-KEY', salt: 'HB-SALT' });

        expect(location!.origin + location!.pathname).toBe('http://127.0.0.1:43123/callback');
        expect(location!.searchParams.get('iss')).toBe(ISSUER);
        await transport.finishAuth(location!.searchParams.get('code')!);
        expect(store.tokens).toMatchObject({ token_type: expect.stringMatching(/bearer/i), refresh_token: expect.any(String) });
        expect(JSON.stringify(store.tokens)).not.toMatch(/HOMEBASE/);

        const client = new Client({ name: 'sdk-client', version: '0' });
        await client.connect(new StreamableHTTPClientTransport(new URL(RESOURCE), { authProvider: provider, fetch: s.appFetch }));
        const result = await client.callTool({ name: 'list_notes', arguments: {} });
        expect(JSON.stringify(result.content)).toContain('Note One');
        expect(seenCreds.at(-1)).toEqual({ identity: IDENTITY, clientAuthToken: HB_TOKEN, sharedSecret: HB_SECRET });
        await client.close();
    });

    it('resolves a CIMD client, shows its verified domain, takes a loopback redirect on any port and a form-urlencoded token request', async () => {
        const s = setup();
        const { html, location, tokens } = await connectCimd(s);
        expect(html).toContain('CIMD Client');
        expect(html).toContain('client.example');
        expect(location!.searchParams.get('state')).toBe('client-state');
        expect(location!.searchParams.get('iss')).toBe(ISSUER);
        expect(tokens.refresh_token).toBeTruthy();
        expect((await listNotes(s, tokens.access_token)).status).toBe(200);
    });

    it('requires PKCE with S256 and the right verifier', async () => {
        const s = setup();
        const redirect_uri = 'http://127.0.0.1:5000/callback';
        const noPkce = await s.appFetch(`${ISSUER}/authorize?${new URLSearchParams({ response_type: 'code', client_id: CIMD_ID, redirect_uri, state: 's', resource: RESOURCE })}`);
        expect(noPkce.status).toBe(400);
        expect(noPkce.headers.get('location')).toBeNull();
        const plain = await s.appFetch(authorizeUrl({ client_id: CIMD_ID, redirect_uri, code_challenge: 'x'.repeat(43), code_challenge_method: 'plain' }));
        expect(plain.status).toBe(400);

        const { challenge } = await pkce();
        const { location } = await signIn(s, authorizeUrl({ client_id: CIMD_ID, redirect_uri, code_challenge: challenge }));
        const wrong = await s.appFetch(`${ISSUER}/oauth/token`, form({ grant_type: 'authorization_code', code: location!.searchParams.get('code')!, code_verifier: (await pkce()).verifier, client_id: CIMD_ID, redirect_uri, resource: RESOURCE }));
        expect(wrong.status).toBe(400);
        expect((await wrong.json()).error).toBe('invalid_grant');
    });

    it('takes only registered redirect URIs: exact https, loopback on any port, never remote http', async () => {
        const s = setup();
        const register = (redirect_uris: string[]) =>
            s.appFetch(`${ISSUER}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Web', redirect_uris, token_endpoint_auth_method: 'none' }) });
        expect((await register(['http://evil.example/callback'])).status).toBe(400);
        // The page escapes what a client says about itself.
        const named = await (await s.appFetch(`${ISSUER}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: '<script>x</script>', redirect_uris: ['https://app.example/cb'], token_endpoint_auth_method: 'none' }) })).json();
        const page = await (await s.appFetch(authorizeUrl({ client_id: named.client_id, redirect_uri: 'https://app.example/cb', code_challenge: (await pkce()).challenge }))).text();
        expect(page).toContain('&lt;script&gt;x&lt;/script&gt;');
        expect(page).not.toContain('<script>');
        const registered = await register(['https://app.example/callback']);
        expect(registered.status).toBe(201);
        const { client_id } = await registered.json();
        const { challenge } = await pkce();
        const other = await s.appFetch(authorizeUrl({ client_id, redirect_uri: 'https://app.example/callback/other', code_challenge: challenge }));
        expect(other.status).toBe(400);
        expect(other.headers.get('location')).toBeNull();
        expect((await s.appFetch(authorizeUrl({ client_id, redirect_uri: 'https://app.example/callback', code_challenge: challenge }))).status).toBe(200);
        // CIMD registers http://127.0.0.1/callback: another loopback port is fine, another path is not.
        expect((await s.appFetch(authorizeUrl({ client_id: CIMD_ID, redirect_uri: 'http://127.0.0.1:9999/callback', code_challenge: challenge }))).status).toBe(200);
        expect((await s.appFetch(authorizeUrl({ client_id: CIMD_ID, redirect_uri: 'http://127.0.0.1:9999/other', code_challenge: challenge }))).status).toBe(400);
    });

    it('checks the resource (RFC 8707) at authorize and token, and binds the token to it', async () => {
        const s = setup();
        const { challenge } = await pkce();
        const redirect_uri = 'http://127.0.0.1:5000/callback';
        expect((await s.appFetch(authorizeUrl({ client_id: CIMD_ID, redirect_uri, code_challenge: challenge, resource: 'https://other.example/mcp' }))).status).toBe(400);
        const { tokens } = await connectCimd(s);
        const elsewhere = await refresh(s, tokens.refresh_token!, { resource: 'https://other.example/mcp' });
        expect(elsewhere.status).toBe(400);
        expect((await elsewhere.json()).error).toBe('invalid_target');
        const validated = await s.app.oauth.unwrapToken(tokens.access_token);
        expect([validated?.audience].flat()).toEqual([RESOURCE]);
    });

    it('sends a declined consent back with access_denied, state and iss', async () => {
        const s = setup();
        const { challenge } = await pkce();
        const jar = cookieJar();
        const page = await s.appFetch(authorizeUrl({ client_id: CIMD_ID, redirect_uri: 'http://127.0.0.1:5000/callback', code_challenge: challenge }));
        jar.take(page);
        const handle = /name="handle" value="([^"]+)"/.exec(await page.text())![1];
        const denied = await s.appFetch(`${ISSUER}/authorize`, { ...form({ handle, action: 'deny' }), headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header } });
        expect(denied.status).toBe(302);
        const back = new URL(denied.headers.get('location')!);
        expect(Object.fromEntries(back.searchParams)).toMatchObject({ error: 'access_denied', state: 'client-state', iss: ISSUER });
    });

    it('checks the form came from this browser before fetching anything, and asks again after a wrong identity', async () => {
        const s = setup();
        const { challenge } = await pkce();
        const jar = cookieJar();
        const page = await s.appFetch(authorizeUrl({ client_id: CIMD_ID, redirect_uri: 'http://127.0.0.1:5000/callback', code_challenge: challenge }));
        jar.take(page);
        const handleOf = (html: string) => /name="handle" value="([^"]+)"/.exec(html)![1];
        const post = (handle: string, identity: string, cookie: string) =>
            s.appFetch(`${ISSUER}/authorize`, { ...form({ handle, identity, action: 'approve' }), headers: { 'content-type': 'application/x-www-form-urlencoded', cookie } });
        const first = handleOf(await page.text());
        checkedIdentities.length = 0;
        // Another browser (no binding cookie): refused before the identity is looked up.
        expect((await post(first, IDENTITY, '')).status).toBe(400);
        expect(checkedIdentities).toEqual([]);

        const wrong = await post(first, 'not-an-identity.example', jar.header);
        expect(wrong.status).toBe(400);
        expect(checkedIdentities).toEqual(['not-an-identity.example']);
        jar.take(wrong);
        const html = await wrong.text();
        expect(html).toContain('That is not a Homebase identity: not-an-identity.example');
        // An identity with a port is refused without a lookup either.
        const ported = await post(handleOf(html), 'owner.example.com:8443', jar.header);
        expect(ported.status).toBe(400);
        expect(checkedIdentities).toEqual(['not-an-identity.example']);
        jar.take(ported);
        expect((await post(handleOf(await ported.text()), IDENTITY, jar.header)).status).toBe(302);
        // The first handle is used up.
        expect((await post(first, IDENTITY, jar.header)).status).toBe(400);
    });

    it('bounds the identity lookup: a timeout, no redirects, at most 4 KB read', async () => {
        const seen: RequestInit[] = [];
        let body = JSON.stringify({ odinId: IDENTITY });
        fakeFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
            seen.push(init!);
            return new Response(body);
        });
        try {
            expect(await checkIdentity(IDENTITY)).toBe(true);
            expect(seen[0].signal).toBeInstanceOf(AbortSignal);
            expect(seen[0].redirect).toBe('error');
            body = JSON.stringify({ odinId: IDENTITY, padding: 'x'.repeat(5000) });
            expect(await checkIdentity(IDENTITY)).toBe(false);
        } finally {
            fakeFetch.mockReset();
            fakeFetch.mockImplementation(fakeFetchImpl);
        }
    });

    it('limits registrations and consent pages per client IP, refuses a large registration, and lets clients expire after a week', async () => {
        vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
        const s = setup();
        const client = { client_name: 'Web', redirect_uris: ['https://app.example/cb'], token_endpoint_auth_method: 'none' };
        expect((await registerDcr(s, { ...client, client_name: 'x'.repeat(9000) })).status).toBe(413);
        for (let i = 1; i < 10; i++) expect((await registerDcr(s, client)).status).toBe(201);
        const limited = await registerDcr(s, client);
        expect(limited.status).toBe(429);
        expect(limited.headers.get('retry-after')).toBe('60');
        expect((await registerDcr(s, client, '198.51.100.7')).status).toBe(201);

        const rows = s.kv.db.prepare("SELECT expiration FROM kv WHERE key LIKE 'client:%'").all() as { expiration: number }[];
        expect(rows.length).toBe(10);
        for (const { expiration } of rows) expect(expiration - Date.now() / 1000).toBeCloseTo(7 * 24 * 60 * 60, -2);

        const consent = (ip: string) => s.appFetch(authorizeUrl({ client_id: CIMD_ID, redirect_uri: 'http://127.0.0.1:5000/callback', code_challenge: 'x'.repeat(43) }), { headers: { 'x-real-ip': ip } });
        for (let i = 0; i < 30; i++) expect((await consent('203.0.113.9')).status).toBe(200);
        expect((await consent('203.0.113.9')).status).toBe(429);
        expect((await s.appFetch(`${ISSUER}/authorize`, { ...form({ handle: 'h', action: 'approve' }), headers: { 'x-real-ip': '203.0.113.9' } })).status).toBe(429);
        vi.setSystemTime(Date.now() + 61_000);
        expect((await consent('203.0.113.9')).status).toBe(200);
    });

    it('refuses a callback for another identity, and a replayed state', async () => {
        const s = setup();
        const { challenge } = await pkce();
        const { location, finalize, jar } = await signIn(s, authorizeUrl({ client_id: CIMD_ID, redirect_uri: 'http://127.0.0.1:5000/callback', code_challenge: challenge }), { finalizeIdentity: 'someone-else.example.com' });
        expect(location!.searchParams.get('error')).toBe('access_denied');
        expect(location!.searchParams.get('code')).toBeNull();
        expect((await s.app.fetch(new Request(finalize, { headers: { cookie: jar.header } }))).status).toBe(400);
    });
});

describe('hosted MCP: refresh tokens', () => {
    it('rotates them, answers invalid_grant for a dead one, and slides the idle lifetime', async () => {
        vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
        const s = setup();
        const { tokens: t0 } = await connectCimd(s);
        const r1 = await refresh(s, t0.refresh_token!);
        expect(r1.status).toBe(200);
        const t1 = (await r1.json()) as OAuthTokens;
        expect(t1.refresh_token).not.toBe(t0.refresh_token);
        expect(t1.access_token).not.toBe(t0.access_token);
        expect((await listNotes(s, t1.access_token)).status).toBe(200);
        const t2 = (await (await refresh(s, t1.refresh_token!)).json()) as OAuthTokens;
        const replayed = await refresh(s, t0.refresh_token!);
        expect(replayed.status).toBe(400);
        expect((await replayed.json()).error).toBe('invalid_grant');
        expect((await (await refresh(s, 'not-a-token')).json()).error).toBe('invalid_grant');

        // 20 + 20 days: past the first 30 days, alive because it was used in between.
        vi.setSystemTime(Date.now() + 20 * DAY_MS);
        const r3 = await refresh(s, t2.refresh_token!);
        expect(r3.status).toBe(200);
        const t3 = (await r3.json()) as OAuthTokens;
        vi.setSystemTime(Date.now() + 20 * DAY_MS);
        const r4 = await refresh(s, t3.refresh_token!);
        expect(r4.status).toBe(200);
        const t4 = (await r4.json()) as OAuthTokens;
        // 31 days idle: gone.
        vi.setSystemTime(Date.now() + 31 * DAY_MS);
        const idle = await refresh(s, t4.refresh_token!);
        expect(idle.status).toBe(400);
        expect((await idle.json()).error).toBe('invalid_grant');
    });
});

describe('hosted MCP: revocation', () => {
    it('revokes the grant once Homebase still turns the app token away a minute later, and tells the agent to reconnect', async () => {
        vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
        const s = setup();
        const { tokens } = await connectCimd(s);
        homebaseStatus = 401;
        tokenValid = false;
        const answer = (text: string) => ({ jsonrpc: '2.0', id: 7, result: { content: [{ type: 'text', text }], isError: true } });
        expect(await (await listNotes(s, tokens.access_token)).json()).toEqual(answer(RETRY_MESSAGE));
        vi.setSystemTime(Date.now() + 30_000);
        expect(await (await listNotes(s, tokens.access_token)).json()).toEqual(answer(RETRY_MESSAGE));
        vi.setSystemTime(Date.now() + 31_000);
        const response = await listNotes(s, tokens.access_token);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(answer(RECONNECT_MESSAGE));
        expect((await listNotes(s, tokens.access_token)).status).toBe(401);
        expect((await (await refresh(s, tokens.refresh_token!)).json()).error).toBe('invalid_grant');
    });

    it('forgets a failure once a call gets through again', async () => {
        vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
        const s = setup();
        const { tokens } = await connectCimd(s);
        homebaseStatus = 401;
        tokenValid = false;
        expect(JSON.stringify(await (await listNotes(s, tokens.access_token)).json())).toContain(RETRY_MESSAGE);
        homebaseStatus = 200;
        tokenValid = true;
        expect(JSON.stringify(await (await listNotes(s, tokens.access_token)).json())).toContain('Note One');
        vi.setSystemTime(Date.now() + 120_000);
        homebaseStatus = 401;
        tokenValid = false;
        expect(JSON.stringify(await (await listNotes(s, tokens.access_token)).json())).toContain(RETRY_MESSAGE);
    });

    it('keeps the grant for a 403 when the app token is still valid', async () => {
        const s = setup();
        const { tokens } = await connectCimd(s);
        homebaseStatus = 403;
        tokenValid = true;
        const response = await listNotes(s, tokens.access_token);
        expect(JSON.stringify(await response.json())).not.toContain(RECONNECT_MESSAGE);
        homebaseStatus = 200;
        expect(JSON.stringify(await (await listNotes(s, tokens.access_token)).json())).toContain('Note One');
    });

    it('deletes the grant on /journal/revoke with its access token', async () => {
        const s = setup();
        const { tokens } = await connectCimd(s);
        expect((await s.appFetch(`${ISSUER}/revoke`, { method: 'POST' })).status).toBe(401);
        expect((await s.appFetch(`${ISSUER}/revoke`, { method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}` } })).status).toBe(200);
        expect((await listNotes(s, tokens.access_token)).status).toBe(401);
    });

    it('limits MCP requests per user, across their clients', async () => {
        const s = setup(2);
        const { tokens } = await connectCimd(s);
        const { client_id } = await (await registerDcr(s, { client_name: 'Other', redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' })).json();
        const { tokens: other } = await connectCimd(s, 'http://127.0.0.1:5000/callback', client_id);
        expect((await listNotes(s, tokens.access_token)).status).toBe(200);
        expect((await listNotes(s, other.access_token)).status).toBe(200);
        const limited = await listNotes(s, tokens.access_token);
        expect(limited.status).toBe(429);
        expect(limited.headers.get('retry-after')).toBe('60');
    });
});

// The library's key derivation (deriveKeyFromToken in @cloudflare/workers-oauth-provider 1.3.0): AES-KW from HMAC(token).
const WRAPPING_KEY_HMAC_KEY = new Uint8Array([34, 126, 38, 134, 141, 241, 225, 109, 128, 112, 234, 23, 151, 91, 71, 166, 130, 24, 250, 135, 40, 174, 222, 133, 181, 29, 74, 217, 150, 202, 202, 67]);
async function tryDecrypt(candidate: string, wrapped: string, encryptedProps: string): Promise<unknown> {
    try {
        const hmac = await crypto.subtle.importKey('raw', WRAPPING_KEY_HMAC_KEY, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const raw = await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(candidate));
        const wrapping = await crypto.subtle.importKey('raw', raw, { name: 'AES-KW' }, false, ['unwrapKey']);
        const key = await crypto.subtle.unwrapKey('raw', Buffer.from(wrapped, 'base64'), wrapping, { name: 'AES-KW' }, { name: 'AES-GCM' }, false, ['decrypt']);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, Buffer.from(encryptedProps, 'base64'));
        return JSON.parse(new TextDecoder().decode(plain));
    } catch {
        return null;
    }
}

describe('hosted MCP: the grant store', () => {
    it("holds no Homebase token or OAuth token in clear, and nothing in it decrypts a grant's props", async () => {
        const s = setup();
        const { tokens } = await connectCimd(s);
        const rows = s.kv.db.prepare('SELECT key, value, metadata FROM kv').all() as { key: string; value: string; metadata: string | null }[];
        const dump = JSON.stringify(rows);
        for (const secret of [HB_TOKEN, HB_SECRET, tokens.access_token, tokens.refresh_token!]) expect(dump).not.toContain(secret);

        // Every string the database holds, and every wrapped key and sealed props in it.
        const strings = new Set<string>();
        const wrappedKeys = new Set<string>();
        const sealedProps = new Set<string>();
        const walk = (value: unknown, name = ''): void => {
            if (typeof value === 'string') {
                strings.add(value);
                if (/wrapped/i.test(name)) wrappedKeys.add(value);
                if (name === 'encryptedProps') sealedProps.add(value);
            } else if (value && typeof value === 'object') {
                for (const [k, v] of Object.entries(value)) walk(v, k);
            }
        };
        for (const row of rows) {
            for (const part of [row.key, ...row.key.split(':')]) strings.add(part);
            for (const text of [row.value, row.metadata]) {
                if (!text) continue;
                strings.add(text);
                try {
                    walk(JSON.parse(text));
                } catch {
                    // Not JSON: a sealed transaction.
                }
            }
        }
        expect(wrappedKeys.size).toBeGreaterThan(0);
        expect(sealedProps.size).toBeGreaterThan(0);

        const attempts: Promise<unknown>[] = [];
        for (const candidate of strings) for (const wrapped of wrappedKeys) for (const sealed of sealedProps) attempts.push(tryDecrypt(candidate, wrapped, sealed));
        expect((await Promise.all(attempts)).every((result) => result === null)).toBe(true);

        // The same attempt with the client's token opens it: the token is the missing piece.
        const withToken: unknown[] = [];
        for (const wrapped of wrappedKeys) for (const sealed of sealedProps) withToken.push(await tryDecrypt(tokens.access_token, wrapped, sealed));
        expect(withToken).toContainEqual({ identity: IDENTITY, clientAuthToken: HB_TOKEN, sharedSecret: HB_SECRET });
    });
});

describe('hosted MCP: node bridge and outbound fetch', () => {
    it('builds the URL from the fixed origin, never Host, and answers 413 to an oversized body', async () => {
        const seen: string[] = [];
        const server = createServer(
            nodeListener(
                async (request) => {
                    seen.push(request.url);
                    return new Response('ok', { headers: [['set-cookie', 'a=1'], ['set-cookie', 'b=2']] });
                },
                ORIGIN,
                { smallLimit: 1024 }
            )
        );
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address() as AddressInfo;
        const send = (body: string, host = 'evil.example') =>
            new Promise<{ status?: number; cookies?: string[] }>((resolve, reject) => {
                const req = httpRequest({ host: '127.0.0.1', port, path: '/journal/mcp?x=1', method: 'POST', headers: { host } }, (res) => {
                    res.resume();
                    resolve({ status: res.statusCode, cookies: res.headers['set-cookie'] });
                });
                req.on('error', reject);
                req.end(body);
            });
        expect(await send('small')).toEqual({ status: 200, cookies: ['a=1', 'b=2'] });
        expect(seen).toEqual([`${ORIGIN}/journal/mcp?x=1`]);
        expect((await send('x'.repeat(2048))).status).toBe(413);
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('refuses non-public addresses, IPv4-mapped and resolved names included', async () => {
        for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '::1', '::ffff:127.0.0.1', 'fd00::1']) expect(isBlockedAddress(ip)).toBe(true);
        // NAT64 and 6to4, which wrap an IPv4 address (here 127.0.0.1 and 10.0.0.1).
        for (const ip of ['64:ff9b::7f00:1', '64:ff9b:1::a00:1', '2002:7f00:1::1']) expect(isBlockedAddress(ip)).toBe(true);
        for (const ip of ['1.1.1.1', '2606:4700:4700::1111']) expect(isBlockedAddress(ip)).toBe(false);

        const server = createServer((_req, res) => res.end('reached'));
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address() as AddressInfo;
        for (const host of ['127.0.0.1', 'localhost']) {
            // Node's fetch takes undici's dispatcher, as installPublicOnlyFetch sets it globally.
            await expect(realFetch(`http://${host}:${port}/`, { dispatcher: publicOnlyAgent } as RequestInit)).rejects.toThrow();
        }
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('reads a large body only for a Bearer request to the MCP path, and none at all for one without a token', async () => {
        const seen: { url: string; size: number }[] = [];
        const server = createServer(
            nodeListener(
                async (request) => {
                    seen.push({ url: new URL(request.url).pathname, size: (await request.arrayBuffer()).byteLength });
                    return new Response('ok');
                },
                ORIGIN,
                { bearerPaths: ['/journal/mcp'], limit: 4096, smallLimit: 1024 }
            )
        );
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address() as AddressInfo;
        const send = (path: string, body: string, headers: Record<string, string> = {}) =>
            new Promise<number | undefined>((resolve, reject) => {
                const req = httpRequest({ host: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
                    res.resume();
                    resolve(res.statusCode);
                });
                req.on('error', reject);
                req.end(body);
            });
        const body = 'x'.repeat(2048);
        expect(await send('/journal/mcp', body, { authorization: 'Bearer t' })).toBe(200);
        expect(await send('/journal/mcp', body)).toBe(200);
        expect(await send('/journal/oauth/token', body, { authorization: 'Bearer t' })).toBe(413);
        expect(await send('/journal/mcp', 'x'.repeat(5000), { authorization: 'Bearer t' })).toBe(413);
        expect(seen).toEqual([
            { url: '/journal/mcp', size: 2048 },
            { url: '/journal/mcp', size: 0 },
        ]);
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
});

describe('hosted MCP: the grant store queries', () => {
    it('lists a prefix through the primary key index, and only that prefix', async () => {
        const { kv } = setup();
        for (const key of ['grant:a:1', 'grant:a:2', 'grant:b:1', 'grant;x', 'token:a']) await kv.put(key, '{}');
        expect((await kv.list({ prefix: 'grant:a:' })).keys.map((k) => k.name)).toEqual(['grant:a:1', 'grant:a:2']);
        expect((await kv.list({ prefix: 'grant:', limit: 2 })).cursor).toBe('grant:a:2');
        expect((await kv.list({ prefix: 'grant:', cursor: 'grant:a:2' })).keys.map((k) => k.name)).toEqual(['grant:b:1']);
        expect((await kv.list()).keys).toHaveLength(5);
        const prepare = vi.spyOn(kv.db, 'prepare');
        await kv.list({ prefix: 'grant:' });
        const sql = prepare.mock.calls[0][0];
        prepare.mockRestore();
        const plan = kv.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('grant:', 'grant;', '', 0, 10) as { detail: string }[];
        expect(plan.map((row) => row.detail).join(' ')).toMatch(/SEARCH kv USING (COVERING )?INDEX sqlite_autoindex_kv_1 \(key>\? AND key<\?\)/);
    });
});

describe('hosted MCP: run_script off the main thread', () => {
    it('runs a script in the worker, its journal calls served by the drive, and stops an endless loop at 3 s of CPU', async () => {
        const s = setup();
        const { tokens } = await connectCimd(s);
        const ran = await (await runScriptCall(s, tokens.access_token, `console.log(await journal.listNotes())`)).json();
        expect(JSON.stringify(ran.result.content)).toContain('Note One');
        expect(ran.result.isError).toBe(false);

        // The main thread keeps serving while the script spins.
        let ticks = 0;
        const timer = setInterval(() => ticks++, 100);
        const spun = await (await runScriptCall(s, tokens.access_token, 'for (;;) {}')).json();
        clearInterval(timer);
        expect(spun.result.isError).toBe(true);
        expect(JSON.stringify(spun.result.content)).toContain('Script stopped: it used more than 3 s of CPU time.');
        expect(ticks).toBeGreaterThan(20);
    });

    it("notices Homebase turning a script's calls away, as it does a tool's", async () => {
        const s = setup();
        const { tokens } = await connectCimd(s);
        homebaseStatus = 401;
        tokenValid = false;
        const answer = await (await runScriptCall(s, tokens.access_token, `await journal.listNotes()`)).json();
        expect(JSON.stringify(answer)).toContain(RETRY_MESSAGE);
    });

    it('terminates a worker that runs past the wall-clock limit', async () => {
        const guest = workerGuest(bundle, { cpuMs: 60_000, wallMs: 500, perUser: 1, total: 2 });
        const started = performance.now();
        const result = await runScript({} as never, 'for (;;) {}', false, guest);
        expect(result.error).toBe('Script stopped: it ran for more than 0.5 s.');
        expect(performance.now() - started).toBeLessThan(3000);
    });

    it('takes one run per user and two in all, and says why it turned one away', async () => {
        const admit = scriptSlots({ cpuMs: 0, wallMs: 0, perUser: 1, total: 2 });
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        const a = admit('a', () => held);
        await expect(admit('a', async () => 1)).rejects.toThrow(SCRIPT_RUNNING);
        const b = admit('b', () => held);
        await expect(admit('c', async () => 1)).rejects.toThrow(SCRIPTS_BUSY);
        release();
        await Promise.all([a, b]);
        expect(await admit('a', async () => 'again')).toBe('again');
    });
});

describe('hosted MCP: logging', () => {
    it('prints strings, never an object or error that could hold the Homebase token', () => {
        const lines: string[] = [];
        const out = safeConsole((stream, line) => lines.push(`${stream}: ${line}`));
        const axiosError = Object.assign(new Error(`Request failed for ${HB_TOKEN}`), {
            name: 'AxiosError',
            config: { headers: { bx0900: HB_TOKEN } },
            request: { _header: `bx0900: ${HB_TOKEN}` },
        });
        out.error('[odin-js]', axiosError, { dsr: { headers: { bx0900: HB_TOKEN } } }, 404, true, undefined);
        out.log('started');
        expect(lines).toEqual(['stderr: [odin-js] [AxiosError] [Object] 404 true [undefined]', 'stdout: started']);
        expect(lines.join('\n')).not.toContain(HB_TOKEN);
    });
});
