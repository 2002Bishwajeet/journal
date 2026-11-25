import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { createServer, type IncomingMessage, type OutgoingHttpHeaders, type Server } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import net, { type AddressInfo } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { asUpstreamCall, viaEgressRelay, withDirectUpstream } from '../../mcp/hosted/publicFetch';

// The hosted MCP's egress relay: with MCP_EGRESS_URL and MCP_EGRESS_KEY set, every outbound request goes to the
// relay, never to its target, so no site the server fetches learns its address.

const KEY = 'k'.repeat(64);

interface Seen {
    method: string;
    headers: IncomingMessage['headers'];
    body: string;
}

async function listen(answer: (seen: Seen) => { status: number; headers?: OutgoingHttpHeaders; body?: string }) {
    const seen: Seen[] = [];
    const server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const one = { method: req.method!, headers: req.headers, body: Buffer.concat(chunks).toString() };
        seen.push(one);
        const { status, headers, body } = answer(one);
        res.writeHead(status, headers).end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { server, seen, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

let relay: Awaited<ReturnType<typeof listen>>;
let target: Awaited<ReturnType<typeof listen>>;
let viaRelay: ReturnType<typeof viaEgressRelay>;

beforeAll(async () => {
    relay = await listen(({ headers }) => {
        const url = headers['x-egress-url'] as string;
        if (url.endsWith('/moved')) return { status: 302, headers: { location: 'https://other.example/landed?x=1' } };
        if (url.endsWith('/relative')) return { status: 301, headers: { location: '/moved' } };
        return { status: 200, headers: { 'content-type': 'text/plain' }, body: `relayed ${url}` };
    });
    target = await listen(() => ({ status: 200, body: 'direct' }));
    viaRelay = viaEgressRelay(new Agent(), `${relay.url}/relay`, KEY);
});
afterAll(async () => {
    await close(relay.server);
    await close(target.server);
});
afterEach(() => {
    relay.seen.length = 0;
    target.seen.length = 0;
});

describe('hosted MCP: egress relay', () => {
    it('sends each request to the relay with its target, the key and the request itself, Node fetch and undici fetch alike', async () => {
        for (const fetchImpl of [undiciFetch, globalThis.fetch] as (typeof fetch)[]) {
            const response = await fetchImpl('https://identity.example/api/v2/drive?q=1', {
                method: 'POST',
                headers: { authorization: 'Bearer app-token', 'content-type': 'application/json', 'x-egress-url': 'https://evil.example/' },
                body: '{"a":1}',
                dispatcher: viaRelay,
            } as RequestInit);
            expect(await response.text()).toBe('relayed https://identity.example/api/v2/drive?q=1');
        }
        expect(relay.seen).toHaveLength(2);
        for (const { method, headers, body } of relay.seen) {
            expect(method).toBe('POST');
            expect(headers.authorization).toBe(`Bearer ${KEY}`);
            expect(headers['x-egress-url']).toBe('https://identity.example/api/v2/drive?q=1');
            expect(headers['x-egress-authorization']).toBe('Bearer app-token');
            expect(headers['content-type']).toBe('application/json');
            expect(headers.host).toBe(new URL(relay.url).host);
            expect(body).toBe('{"a":1}');
        }
    });

    it('relays every redirect hop again, a relative one included', async () => {
        const response = await undiciFetch('https://first.example/relative', { dispatcher: viaRelay });
        expect(await response.text()).toBe('relayed https://other.example/landed?x=1');
        expect(relay.seen.map((s) => s.headers['x-egress-url'])).toEqual(['https://first.example/relative', 'https://first.example/moved', 'https://other.example/landed?x=1']);
    });

    it('never connects to the target itself', async () => {
        await (await undiciFetch(`${target.url}/x`, { dispatcher: viaRelay })).text();
        expect(target.seen).toHaveLength(0);
        expect(relay.seen[0].headers['x-egress-url']).toBe(`${target.url}/x`);
    });

    it('keeps the key out of the error when the relay is down', async () => {
        const down = viaEgressRelay(new Agent(), 'http://127.0.0.1:1/relay', KEY);
        const error = await undiciFetch('https://identity.example/', { dispatcher: down }).then(
            () => null,
            (e: unknown) => e
        );
        expect(error).toBeInstanceOf(Error);
        const chain: string[] = [];
        for (let e: unknown = error; e instanceof Error; e = e.cause) chain.push(e.message, e.stack ?? '', JSON.stringify(e));
        expect(chain.join('\n')).not.toContain(KEY);
    });
});

describe('hosted MCP: egress settings', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });
    const load = () => import('../../mcp/hosted/publicFetch');

    const withEnv = (url: string, key: string) => {
        vi.stubEnv('MCP_EGRESS_URL', url);
        vi.stubEnv('MCP_EGRESS_KEY', key);
        return load();
    };

    it('fetches directly, public addresses only, without a relay', async () => {
        const { outboundAgent, publicOnlyAgent } = await withEnv('', '');
        expect(outboundAgent).toBe(publicOnlyAgent);
    });

    it('fetches only through the relay with one', async () => {
        const { outboundAgent, publicOnlyAgent } = await withEnv('https://relay.example/', KEY);
        expect(outboundAgent).not.toBe(publicOnlyAgent);
    });

    it.each([
        ['https://relay.example/', ''],
        ['', KEY],
        ['http://relay.example/', KEY],
    ])('refuses to start with MCP_EGRESS_URL=%j and half a setting', async (url, key) => {
        await expect(withEnv(url, key)).rejects.toThrow('Set both MCP_EGRESS_URL (https:) and MCP_EGRESS_KEY, or neither.');
    });

    it('fetches images through the relay', async () => {
        const dispatchers: unknown[] = [];
        vi.doMock('undici', async (importOriginal) => ({
            ...(await importOriginal<typeof import('undici')>()),
            fetch: async (_url: string, init: { dispatcher: unknown }) => {
                dispatchers.push(init.dispatcher);
                return new Response(null, { status: 404 });
            },
        }));
        const { outboundAgent } = await withEnv('https://relay.example/', KEY);
        const { fetchImage } = await import('../../mcp/hosted/images');
        await expect(fetchImage('https://127.0.0.1/cat.png')).rejects.toThrow('answered 404');
        expect(dispatchers).toEqual([outboundAgent]);
        vi.doUnmock('undici');
    });
});

describe('hosted MCP: direct upstream addresses (MCP_DIRECT_IPS)', () => {
    const allowed = new net.BlockList();
    allowed.addAddress('127.0.0.1');
    // Stands in for Node's fetch with the relay as its global dispatcher.
    const fetchVia = withDirectUpstream((input, init) => undiciFetch(input as string, { dispatcher: viaRelay, ...init } as never) as never, allowed);
    const answer = async (url: string) => (await fetchVia(url)).text();
    const port = () => new URL(target.url).port;

    const { lookup } = dns;
    const lookupAll = dnsPromises.lookup;
    /** `host` resolves to `first` for the direct-or-relay check, then to `connect` when the connection is made. */
    function resolveTo(host: string, first: string, connect: string) {
        dnsPromises.lookup = ((name: string, options: never) => (name === host ? Promise.resolve([{ address: first, family: 4 }]) : lookupAll(name, options))) as never;
        dns.lookup = ((name: string, options: unknown, done: (err: null, addresses: dns.LookupAddress[]) => void) =>
            name === host ? done(null, [{ address: connect, family: 4 }]) : lookup(name, options as never, done as never)) as never;
        syncBuiltinESMExports();
    }
    afterEach(() => {
        dns.lookup = lookup;
        dnsPromises.lookup = lookupAll;
        syncBuiltinESMExports();
    });

    it('sends an upstream call to an allowed address direct, and nothing else', async () => {
        expect(await asUpstreamCall(() => answer(`${target.url}/api`))).toBe('direct');
        expect(relay.seen).toHaveLength(0);
        expect(target.seen).toHaveLength(1);

        // Not an upstream call (a CIMD document): the relay, though the address is allowed.
        expect(await answer(`${target.url}/client.json`)).toBe(`relayed ${target.url}/client.json`);
        expect(target.seen).toHaveLength(1);
    });

    it('relays an upstream call to a host that resolves to an address not allowed', async () => {
        resolveTo('identity.example', '127.0.0.2', '127.0.0.2');
        expect(await asUpstreamCall(() => answer(`http://identity.example:${port()}/api`))).toBe(`relayed http://identity.example:${port()}/api`);
        expect(target.seen).toHaveLength(0);
    });

    it('resolves a name to an allowed address direct, and refuses one that rebinds before connecting', async () => {
        resolveTo('identity.example', '127.0.0.1', '127.0.0.1');
        expect(await asUpstreamCall(() => answer(`http://identity.example:${port()}/api`))).toBe('direct');
        expect(target.seen).toHaveLength(1);

        resolveTo('rebind.example', '127.0.0.1', '127.0.0.2');
        await expect(asUpstreamCall(() => answer(`http://rebind.example:${port()}/api`))).rejects.toMatchObject({
            cause: { message: 'blocked non-allowed address 127.0.0.2 for rebind.example' },
        });
        expect(target.seen).toHaveLength(1);
        expect(relay.seen).toHaveLength(0);
    });
});
