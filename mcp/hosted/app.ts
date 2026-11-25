import { AsyncLocalStorage } from 'node:async_hooks';
import {
    OAuthAuthorizationServer,
    OAuthResourceServer,
    authorizationErrorRedirect,
    type AuthRequest,
    type OAuthResourceContext,
} from '@cloudflare/workers-oauth-provider';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createEccPair, hasValidToken } from '@homebase-id/js-lib/auth';
import { getDomainFromUrl } from '@homebase-id/js-lib/helpers';
import { createJournalMcpServer, type McpDriveDeps } from '../createServer';
import type { McpCredentials } from '../credentials';
import { createClient } from '../client';
import { createDriveDeps } from '../drive';
import { MCP_PATH } from '../http';
import { loadImage } from '../imageSource';
import { runScript } from '../runScript';
import { buildAuthUrl, checkIdentity, finalizeYouAuth } from '../youauth';
import type { SqliteKv } from './kv';
import { PAGE_CSP, consentPage, messagePage } from './pages';
import { scriptSlots, workerGuest } from './scripts';

/** What the hosted server needs from Homebase: replaced by fakes in tests. */
export interface HomebaseDeps {
    checkIdentity(identity: string): Promise<boolean>;
    finalize(identity: string, privateKey: CryptoKey, publicKey: string, salt: string): Promise<{ clientAuthToken: string; sharedSecret: string }>;
    /** false once the owner revoked the app (Homebase answers 401/403), null when it can't tell. */
    tokenValid(creds: McpCredentials): Promise<boolean | null>;
    driveDeps(creds: McpCredentials): McpDriveDeps;
}

const realHomebase: HomebaseDeps = {
    checkIdentity,
    finalize: finalizeYouAuth,
    tokenValid: (creds) => hasValidToken(createClient(creds)),
    driveDeps: createDriveDeps,
};

export interface HostedOptions {
    /** The public origin, e.g. https://mcp.cloudx.run. Every URL is built from it, never from Host. */
    origin: string;
    kv: SqliteKv;
    homebase?: Partial<HomebaseDeps>;
    /** MCP requests per user per minute. */
    rateLimit?: number;
    /** The module run_script's worker starts on: the hosted bundle itself (mcp/hosted/main.ts). */
    scriptWorker: URL;
}

const BASE = '/journal';
const AUTHORIZE_PATH = `${BASE}/authorize`;
const CALLBACK_PATH = `${BASE}/callback`;
const REVOKE_PATH = `${BASE}/revoke`;
const REGISTER_PATH = `${BASE}/oauth/register`;
const PRM_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;
const ASM_PATH = `/.well-known/oauth-authorization-server${BASE}`;
const DAY = 24 * 60 * 60;
/** Per client IP per minute: dynamic client registrations, and consent pages and forms. */
const REGISTER_LIMIT = 10;
const AUTHORIZE_LIMIT = 30;
/** Larger than any real client's registration. */
const MAX_REGISTRATION_BYTES = 8 * 1024;
/** How long a token Homebase turned away must keep failing before its grant is revoked. */
const REVOKE_AFTER_MS = 60_000;

/** What the upstream (Homebase) transaction keeps, sealed under its `state`, for the callback. */
interface Upstream {
    identity: string;
    privateKey: JsonWebKey;
}

/** The identity of the grant serving the current MCP request, and whether Homebase turned its token away. */
const grantContext = new AsyncLocalStorage<{ identity: string; rejected: boolean }>();
let watchingFetch = false;

/**
 * Wraps the global fetch once, to notice a 401 or 403 from the identity of the grant whose MCP request
 * made the call: the drive providers swallow some failures, so their errors can't be relied on for it.
 */
function watchHomebaseRejections(): void {
    if (watchingFetch) return;
    watchingFetch = true;
    const inner = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const response = await inner(input, init);
        const grant = grantContext.getStore();
        if (grant && (response.status === 401 || response.status === 403)) {
            const url = input instanceof Request ? input.url : String(input);
            if (new URL(url).host === grant.identity) grant.rejected = true;
        }
        return response;
    };
}

export const RETRY_MESSAGE =
    'Homebase turned this request away. Try again in a minute; if it keeps failing, Journal will ask you to reconnect this connector.';

export const RECONNECT_MESSAGE =
    'Journal lost access to your notes: the Journal MCP app was removed or its access revoked on your Homebase identity. Reconnect this Journal connector (sign in again) to keep using it.';

/** The hosted server refuses file paths: they would be files on this box, not the user's. */
async function loadRemoteImage(image: string) {
    if (!image.startsWith('data:')) throw new Error('The hosted Journal server cannot read files: pass the image as a base64 data: URI.');
    return loadImage(image);
}

const html = (body: string, status: number, headers = new Headers()) => {
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    headers.append('Content-Security-Policy', PAGE_CSP);
    return new Response(body, { status, headers });
};
const redirect = (location: string, headers = new Headers()) => {
    headers.set('Location', location);
    return new Response(null, { status: 302, headers });
};
const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const tooMany = () => new Response('Too many requests', { status: 429, headers: { 'Retry-After': '60' } });
/** Set by the gateway from Cf-Connecting-IP on every request (mcp-gateway docs/ARCHITECTURE.md). */
const clientIp = (request: Request) => request.headers.get('x-real-ip') || 'unknown';

/**
 * At most `limit` calls per key in a fixed minute, in memory: a restart resets it, which is fine for
 * a limit meant to stop a runaway agent or a flood. Windows over a minute old are swept once a minute.
 */
function rateLimiter(limit: number) {
    const windows = new Map<string, { start: number; count: number }>();
    let swept = Date.now();
    return (key: string): boolean => {
        const now = Date.now();
        if (now - swept >= 60_000) {
            for (const [k, w] of windows) if (now - w.start >= 60_000) windows.delete(k);
            swept = now;
        }
        const window = windows.get(key);
        if (!window || now - window.start >= 60_000) {
            windows.set(key, { start: now, count: 1 });
            return true;
        }
        return ++window.count <= limit;
    };
}

/**
 * The hosted Journal MCP (#1505): an OAuth 2.1 authorization server toward MCP clients (discovery, CIMD and DCR,
 * PKCE S256, RFC 8707 resource, RFC 9207 iss, rotating refresh tokens with an idle TTL; all of it
 * @cloudflare/workers-oauth-provider's) and a Homebase app toward the user's identity. The consent page signs the
 * user in to Homebase with YouAuth; the app token it gets back is the grant's props, which the library stores
 * encrypted under a per-grant key that only the grant's own tokens unwrap. The client never sees the Homebase
 * token, and Homebase never sees the client's.
 */
export function createHostedApp({ origin, kv, homebase: homebaseOverrides, rateLimit = 120, scriptWorker }: HostedOptions) {
    const homebase = { ...realHomebase, ...homebaseOverrides };
    const issuer = `${origin}${BASE}`;
    const resource = `${origin}${MCP_PATH}`;
    const env = { OAUTH_KV: kv };
    const ctx = () => ({ waitUntil() {}, passThroughOnException() {}, props: {} });
    watchHomebaseRejections();

    const as = new OAuthAuthorizationServer({
        issuer,
        resources: [resource],
        authorizeEndpoint: `${origin}${AUTHORIZE_PATH}`,
        tokenEndpoint: `${issuer}/oauth/token`,
        clientRegistrationEndpoint: `${issuer}/oauth/register`,
        scopesSupported: ['journal', 'offline_access'],
        clientIdMetadataDocumentEnabled: true,
        // Unauthenticated DCR fills the store: a client unused for a week registers again.
        clientRegistrationTTL: 7 * DAY,
        accessTokenTTL: 60 * 60,
        // Sliding: each refresh moves a grant's end to 30 days after it, so a connector in use never expires.
        refreshTokenTTL: 30 * DAY,
        refreshTokenIdleTTL: 30 * DAY,
    });
    const oauth = as.getOAuthApi(env);

    const rs = new OAuthResourceServer<typeof env, McpCredentials>({
        resourceMetadata: { resource, authorization_servers: [issuer], resource_name: 'Journal' },
        requiredScopes: ['journal'],
        validateToken: () => (res, token) => as.validateToken(res, token, env),
        handler: { fetch: (request, _env, context) => serveMcp(request, context) },
    });

    /** Deletes the grant an access token belongs to; false when the token is unknown. */
    async function revokeGrantOf(token: string): Promise<boolean> {
        const summary = await oauth.unwrapToken(token);
        if (!summary) return false;
        await oauth.revokeGrant(summary.grantId, summary.userId);
        return true;
    }

    const allowMcp = rateLimiter(rateLimit);
    const allowRegister = rateLimiter(REGISTER_LIMIT);
    const allowAuthorize = rateLimiter(AUTHORIZE_LIMIT);
    const admitScript = scriptSlots();
    const scriptGuest = workerGuest(scriptWorker);

    async function serveMcp(request: Request, context: OAuthResourceContext<McpCredentials>): Promise<Response> {
        if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
        // Per user, so registering more clients doesn't buy more requests.
        const user = context.auth.userId ?? '';
        if (!allowMcp(user)) return tooMany();
        const creds = context.props;
        const body: unknown = await request
            .clone()
            .json()
            .catch(() => null);
        const grant = { identity: creds.identity, rejected: false };

        const response = await grantContext.run(grant, async () => {
            // Stateless, as mcp/http.ts: a fresh server and transport per POST.
            const server = createJournalMcpServer(() => homebase.driveDeps(creds), undefined, loadRemoteImage, (deps, code, dryRun) =>
                admitScript(user, () => runScript(deps, code, dryRun, scriptGuest))
            );
            const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
            await server.connect(transport);
            try {
                return await transport.handleRequest(request);
            } finally {
                await server.close();
            }
        });

        // A 401/403 can also be one call the app may not make, or a Homebase hiccup: only an app token that
        // verifytoken calls dead, and still dead a minute later, ends the grant.
        const suspectKey = `hosted:suspect:${user}|${context.auth.clientId}`;
        const since = Number(await kv.get(suspectKey));
        if (!grant.rejected || (await homebase.tokenValid(creds)) !== false) {
            if (since) await kv.delete(suspectKey);
            return response;
        }
        if (!since) await kv.put(suspectKey, String(Date.now()), { expirationTtl: DAY });
        if (!since || Date.now() - since < REVOKE_AFTER_MS) return answerEach(body, RETRY_MESSAGE);
        await revokeGrantOf(context.auth.token);
        await kv.delete(suspectKey);
        return answerEach(body, RECONNECT_MESSAGE);
    }

    /** `text` as the tool error answering each request in a JSON-RPC message or batch. */
    function answerEach(body: unknown, text: string): Response {
        const requests = (Array.isArray(body) ? body : [body]).filter(
            (m): m is { id: string | number } => typeof m === 'object' && m !== null && 'id' in m && 'method' in m
        );
        const answers = requests.map(({ id }) => ({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } }));
        return Response.json(Array.isArray(body) ? answers : answers[0]);
    }

    /** GET: the consent page. POST: its form, which goes on to the user's Homebase identity or back to the client. */
    async function authorize(request: Request): Promise<Response> {
        if (!allowAuthorize(clientIp(request))) return tooMany();
        if (request.method === 'GET') {
            let authRequest: AuthRequest;
            try {
                authRequest = await oauth.parseAuthRequest(request);
            } catch (e) {
                // Never redirected: the redirect URI itself may be the problem.
                return html(messagePage('This connection request is not valid', message(e)), 400);
            }
            const consent = await oauth.describeConsent(authRequest);
            const { handle, headers } = await oauth.beginConsent(authRequest);
            return html(consentPage(consent, handle, AUTHORIZE_PATH), 200, headers);
        }
        if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });

        const form = await request.formData();
        const handle = String(form.get('handle') ?? '');
        try {
            if (form.get('action') === 'deny') return new Response(null, { status: 302, headers: (await oauth.denyConsent(request, handle)).headers });

            // The handle and this browser's binding cookie first: nothing is fetched for a form posted from elsewhere.
            const approved = await oauth.approveConsent(request, handle);
            const consent = await oauth.describeConsent(approved.request);
            const identity = (getDomainFromUrl(String(form.get('identity') ?? '').trim()) ?? '').toLowerCase();
            // A port means a dev box, never a hosted user's identity.
            if (identity.includes(':') || !(await homebase.checkIdentity(identity))) {
                // The handle is used up: a fresh consent page, so fixing a typo still works.
                const again = await oauth.beginConsent(approved.request);
                const headers = new Headers(approved.headers);
                again.headers.forEach((value, name) => (name === 'set-cookie' ? headers.append(name, value) : headers.set(name, value)));
                const problem = `That is not a Homebase identity: ${identity || '(empty)'}. Check the address and try again.`;
                return html(consentPage(consent, again.handle, AUTHORIZE_PATH, problem), 400, headers);
            }
            const { clientName } = consent;
            const ecc = await createEccPair();
            const upstream: Upstream = { identity, privateKey: await crypto.subtle.exportKey('jwk', ecc.privateKey) };
            // The key pair waits under the state, sealed, single-use, for 10 minutes (the library's transaction).
            const { state, headers } = await oauth.beginUpstream(approved.request, { data: upstream, headers: approved.headers });
            const friendlyName = `Journal MCP (${clientName.slice(0, 60)})`;
            return redirect(await buildAuthUrl(identity, `${origin}${CALLBACK_PATH}`, ecc.publicKey, friendlyName, state), headers);
        } catch (e) {
            return html(messagePage('This connection request expired', `${message(e)} Start again from your app.`), 400);
        }
    }

    /** Homebase's finalize redirect: finish the key exchange, then the client's grant. */
    async function callback(request: Request): Promise<Response> {
        let resumed: Awaited<ReturnType<typeof oauth.finishUpstream<Upstream>>>;
        try {
            resumed = await oauth.finishUpstream<Upstream>(request);
        } catch (e) {
            return html(messagePage('This sign-in expired', `${message(e)} Start again from your app.`), 400);
        }
        const params = new URL(request.url).searchParams;
        const publicKey = params.get('public_key');
        const salt = params.get('salt');
        const { identity } = resumed.data;
        const fail = (code: 'access_denied' | 'server_error', description: string) =>
            redirect(authorizationErrorRedirect(resumed.request, code, description), resumed.headers);
        if (!publicKey || !salt) return fail('access_denied', 'The Homebase sign-in was not approved');
        if (params.get('identity')?.toLowerCase() !== identity) return fail('access_denied', 'The Homebase sign-in came back for another identity');

        let tokens: { clientAuthToken: string; sharedSecret: string };
        try {
            const privateKey = await crypto.subtle.importKey('jwk', resumed.data.privateKey, { name: 'ECDH', namedCurve: 'P-384' }, false, ['deriveKey', 'deriveBits']);
            tokens = await homebase.finalize(identity, privateKey, publicKey, salt);
        } catch {
            return fail('server_error', 'The Homebase sign-in could not be finished');
        }
        const props: McpCredentials = { identity, ...tokens };
        const { redirectTo } = await oauth.completeAuthorization({
            request: resumed.request,
            // userId may not hold ':', which an identity with a port has.
            userId: encodeURIComponent(identity),
            metadata: {},
            scope: resumed.request.scope,
            props,
        });
        return redirect(redirectTo, resumed.headers);
    }

    /** Disconnect: POST with the connector's access token as a Bearer, and its grant is gone. */
    async function revoke(request: Request): Promise<Response> {
        if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
        const token = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
        if (!token || !(await revokeGrantOf(token))) return Response.json({ error: 'invalid_token' }, { status: 401 });
        return Response.json({ revoked: true });
    }

    return {
        oauth,
        async fetch(request: Request): Promise<Response> {
            const { pathname } = new URL(request.url);
            if (pathname === AUTHORIZE_PATH) return authorize(request);
            if (pathname === CALLBACK_PATH) return callback(request);
            if (pathname === REVOKE_PATH) return revoke(request);
            if (pathname === MCP_PATH || pathname === PRM_PATH) return rs.fetch(request, env, ctx());
            if (pathname === REGISTER_PATH) {
                if (!allowRegister(clientIp(request))) return tooMany();
                // Checked here, before the library parses it: what it stores is what the client sent.
                if ((await request.clone().arrayBuffer()).byteLength > MAX_REGISTRATION_BYTES) return new Response('Registration too large', { status: 413 });
            }
            if (pathname.startsWith(`${BASE}/oauth/`) || pathname === ASM_PATH) return as.fetch(request, env, ctx());
            return new Response('Not found', { status: 404 });
        },
    };
}
