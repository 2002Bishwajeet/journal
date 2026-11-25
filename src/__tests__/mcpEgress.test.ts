import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { createServer, type IncomingMessage, type OutgoingHttpHeaders, type Server } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import net, { type AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { Agent, fetch as undiciFetch, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { asUpstreamCall, assertRelayed, installPublicOnlyFetch, targetUrl, viaEgressRelay, withDirectUpstream } from '../../mcp/hosted/publicFetch';

// The hosted MCP's egress relay: with MCP_EGRESS_URL and MCP_EGRESS_KEY set, every outbound request goes to the
// relay, never to its target, so no site the server fetches learns its address.

const KEY = 'k'.repeat(64);
const GATE = 'g'.repeat(48);
const RELAYED = { 'x-egress': '1' };

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
        // The relay's own refusals carry no x-egress.
        if (headers.authorization !== `Bearer ${KEY}` || headers['x-egress-gate'] !== GATE) return { status: 401, body: 'Unauthorized' };
        if (url.endsWith('/refused')) return { status: 403, body: 'Refused target' };
        if (url.endsWith('/moved')) return { status: 302, headers: { ...RELAYED, location: 'https://other.example/landed?x=1' } };
        if (url.endsWith('/relative')) return { status: 301, headers: { ...RELAYED, location: '/moved' } };
        return { status: 200, headers: { ...RELAYED, 'content-type': 'text/plain' }, body: `relayed ${url}` };
    });
    target = await listen(() => ({ status: 200, body: 'direct' }));
    viaRelay = viaEgressRelay(new Agent(), `${relay.url}/relay`, KEY, GATE);
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
            expect(headers['x-egress-gate']).toBe(GATE);
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

    it('keeps the target on its host whatever its path', async () => {
        for (const url of ['https://good.example//evil.example/x', 'https://good.example/\\evil.example/x', 'https://good.example/a/../..//evil.example/x']) {
            await (await undiciFetch(url, { dispatcher: viaRelay })).text();
        }
        expect(relay.seen.map((s) => s.headers['x-egress-url'])).toEqual(Array(3).fill('https://good.example//evil.example/x'));

        expect(targetUrl('https://good.example', '//evil.example/x')).toBe('https://good.example//evil.example/x');
        expect(targetUrl('https://good.example', '/\\evil.example/x')).toBe('https://good.example//evil.example/x');
        expect(targetUrl('https://good.example', '/a/../..//evil.example/x')).toBe('https://good.example//evil.example/x');
        expect(() => targetUrl('https://good.example', '@evil.example/x')).toThrow('Refused a request path that changes its host');
    });

    it("fails the relay's own refusals like a network error, never as the target's answer", async () => {
        const wrongKey = viaEgressRelay(new Agent(), `${relay.url}/relay`, 'wrong', GATE);
        const wrongGate = viaEgressRelay(new Agent(), `${relay.url}/relay`, KEY, 'wrong');
        for (const fetchImpl of [undiciFetch, globalThis.fetch] as (typeof fetch)[]) {
            for (const [url, dispatcher] of [
                ['https://identity.example/api', wrongKey],
                ['https://identity.example/api', wrongGate],
                ['https://identity.example/refused', viaRelay],
            ] as const) {
                await expect(fetchImpl(url, { dispatcher } as RequestInit)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/^The egress relay refused the request \((401|403)\)$/) } });
            }
        }
    });

    it('never connects to the target itself', async () => {
        await (await undiciFetch(`${target.url}/x`, { dispatcher: viaRelay })).text();
        expect(target.seen).toHaveLength(0);
        expect(relay.seen[0].headers['x-egress-url']).toBe(`${target.url}/x`);
    });

    it('keeps the key out of the error when the relay is down', async () => {
        const down = viaEgressRelay(new Agent(), 'http://127.0.0.1:1/relay', KEY, GATE);
        const error = await undiciFetch('https://identity.example/', { dispatcher: down }).then(
            () => null,
            (e: unknown) => e
        );
        expect(error).toBeInstanceOf(Error);
        const chain: string[] = [];
        for (let e: unknown = error; e instanceof Error; e = e.cause) chain.push(e.message, e.stack ?? '', JSON.stringify(e));
        expect(chain.join('\n')).not.toContain(KEY);
        expect(chain.join('\n')).not.toContain(GATE);
    });
});

/** Counts lookups of `host` by both DNS APIs until `restore()`. */
function countLookups(host: string) {
    const { lookup } = dns;
    const lookupAll = dnsPromises.lookup;
    const calls: string[] = [];
    dns.lookup = ((name: string, ...rest: never[]) => (name === host && calls.push(name), (lookup as (...args: unknown[]) => void)(name, ...rest))) as never;
    dnsPromises.lookup = ((name: string, options: never) => (name === host && calls.push(name), lookupAll(name, options))) as never;
    syncBuiltinESMExports();
    return {
        calls,
        restore() {
            dns.lookup = lookup;
            dnsPromises.lookup = lookupAll;
            syncBuiltinESMExports();
        },
    };
}

describe('hosted MCP: plain fetch goes through the relay', () => {
    let before: ReturnType<typeof getGlobalDispatcher>;
    beforeAll(() => {
        before = getGlobalDispatcher();
    });
    afterEach(() => setGlobalDispatcher(before));

    it('on the main thread, a URL and a Request alike, without looking the target up', async () => {
        const lookups = countLookups('identity.example');
        try {
            installPublicOnlyFetch(viaRelay);
            expect(await (await fetch('https://identity.example/a')).text()).toBe('relayed https://identity.example/a');
            expect(await (await fetch(new Request('https://identity.example/b', { method: 'POST', body: 'x' }))).text()).toBe('relayed https://identity.example/b');
            expect(relay.seen.map((s) => [s.method, s.headers['x-egress-url']])).toEqual([
                ['GET', 'https://identity.example/a'],
                ['POST', 'https://identity.example/b'],
            ]);
            expect(lookups.calls).toEqual([]);
        } finally {
            lookups.restore();
        }
    });

    it('on a worker thread', async () => {
        const module = pathToFileURL(new URL('../../mcp/hosted/publicFetch.ts', import.meta.url).pathname).href;
        const code = `
            const { parentPort, workerData } = require('node:worker_threads');
            (async () => {
                const { Agent } = await import('undici');
                const { installPublicOnlyFetch, viaEgressRelay } = await import(workerData.module);
                installPublicOnlyFetch(viaEgressRelay(new Agent(), workerData.relay, workerData.key, workerData.gate));
                const answers = [await (await fetch('https://identity.example/w')).text(), await (await fetch(new Request('https://identity.example/r'))).text()];
                parentPort.postMessage(answers);
            })();`;
        const worker = new Worker(code, { eval: true, workerData: { module, relay: `${relay.url}/relay`, key: KEY, gate: GATE } });
        const answers = await new Promise((resolve, reject) => worker.once('message', resolve).once('error', reject));
        await worker.terminate();
        expect(answers).toEqual(['relayed https://identity.example/w', 'relayed https://identity.example/r']);
    });

    it('checks at startup that it does, and fails when it does not', async () => {
        installPublicOnlyFetch(viaRelay);
        await expect(assertRelayed(relay.url)).resolves.toBeUndefined();
        expect(relay.seen.map((s) => s.headers['x-egress-url'])).toEqual([`${relay.url}/__health`, `${relay.url}/__health`]);

        // Not relayed: the relay itself answers a request without the key, with no x-egress.
        setGlobalDispatcher(new Agent());
        await expect(assertRelayed(relay.url)).rejects.toThrow("The egress relay check failed (401): fetch doesn't go through the relay.");
    });
});

describe('hosted MCP: egress settings', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });
    const load = () => import('../../mcp/hosted/publicFetch');

    const withEnv = (url: string, key: string, gate = GATE) => {
        vi.stubEnv('MCP_EGRESS_URL', url);
        vi.stubEnv('MCP_EGRESS_KEY', key);
        vi.stubEnv('MCP_EGRESS_GATE', gate);
        return load();
    };

    it('fetches directly, public addresses only, without a relay', async () => {
        const { outboundAgent, publicOnlyAgent } = await withEnv('', '', '');
        expect(outboundAgent).toBe(publicOnlyAgent);
    });

    it('fetches only through the relay with one', async () => {
        const { outboundAgent, publicOnlyAgent } = await withEnv('https://relay.example/', KEY);
        expect(outboundAgent).not.toBe(publicOnlyAgent);
    });

    it.each([
        ['https://relay.example/', '', GATE],
        ['', KEY, GATE],
        ['https://relay.example/', KEY, ''],
        ['', '', GATE],
        ['http://relay.example/', KEY, GATE],
    ])('refuses to start with MCP_EGRESS_URL=%j and only part of a setting', async (url, key, gate) => {
        await expect(withEnv(url, key, gate)).rejects.toThrow('Set all of MCP_EGRESS_URL (https:), MCP_EGRESS_KEY and MCP_EGRESS_GATE, or none.');
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

describe('hosted MCP: direct upstream hosts (MCP_DIRECT_HOSTS, MCP_DIRECT_IPS)', () => {
    const allowed = new net.BlockList();
    allowed.addAddress('127.0.0.1');
    // Stands in for Node's fetch with the relay as its global dispatcher.
    const fetchVia = withDirectUpstream(
        (input, init) => undiciFetch(input as string, { dispatcher: viaRelay, ...init } as never) as never,
        new Set(['127.0.0.1', 'identity.example', 'rebind.example']),
        allowed
    );
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

    it("goes direct through Node's own fetch too, whichever undici it bundles", async () => {
        const nodeFetch = withDirectUpstream(globalThis.fetch, new Set(['127.0.0.1']), allowed);
        expect(await asUpstreamCall(async () => (await nodeFetch(`${target.url}/api`)).text())).toBe('direct');
    });

    it('relays an upstream call to a host not listed without looking it up', async () => {
        const lookups = countLookups('unlisted.example');
        try {
            expect(await asUpstreamCall(() => answer('https://unlisted.example/api'))).toBe('relayed https://unlisted.example/api');
            expect(lookups.calls).toEqual([]);
        } finally {
            lookups.restore();
        }
    });

    it('relays an upstream call to a listed host that resolves to an address not allowed', async () => {
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
