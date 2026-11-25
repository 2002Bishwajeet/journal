// Generic OAuth-on-Node adapter: no Journal imports, so another MCP server can copy it.
import { AsyncLocalStorage } from 'node:async_hooks';
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { lookup as dnsLookupAll } from 'node:dns/promises';
import net from 'node:net';
import { Agent, buildConnector, setGlobalDispatcher, type Dispatcher } from 'undici';

// Every address a request from this server must never reach: this host, private networks, link-local
// (cloud metadata at 169.254.169.254), CGNAT, benchmarking, multicast and reserved ranges.
const blocked = new net.BlockList();
for (const [address, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 3],
] as const) {
    blocked.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
    // ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d (::127.0.0.1).
    ['::', 96],
    ['fc00::', 7],
    ['fe80::', 10],
    // Deprecated site-local.
    ['fec0::', 10],
    ['ff00::', 8],
    // NAT64 and 6to4 carry an IPv4 address inside, private ones included.
    ['64:ff9b::', 96],
    ['64:ff9b:1::', 48],
    ['2002::', 16],
] as const) {
    blocked.addSubnet(address, prefix, 'ipv6');
}

/** net.BlockList checks an IPv4-mapped IPv6 address (::ffff:7f00:1) against the IPv4 rules. */
const family = (ip: string) => (net.isIPv6(ip) ? 'ipv6' : 'ipv4');
const inList = (list: net.BlockList, ip: string) => list.check(ip, family(ip));
/** A URL's hostname without an IPv6 literal's brackets. */
const bareHost = (hostname: string) => hostname.replace(/^\[|\]$/g, '');
export const isBlockedAddress = (ip: string) => inList(blocked, ip);

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** A dispatcher whose every connection, each redirect hop too, refuses a `kind` address `refused` matches. */
function guardedAgent(refused: (ip: string) => boolean, kind: string): Agent {
    function lookup(host: string, options: LookupOptions, done: LookupCallback): void {
        dnsLookup(host, { ...options, all: true }, (err, addresses) => {
            if (err) return done(err, []);
            const bad = addresses.find((entry) => refused(entry.address));
            if (bad) return done(new Error(`blocked ${kind} address ${bad.address} for ${host}`), []);
            if (options.all) return done(null, addresses);
            done(null, addresses[0].address, addresses[0].family);
        });
    }
    const connect = buildConnector({ lookup: lookup as never });
    return new Agent({
        connect(options, callback) {
            const host = bareHost(options.hostname);
            if (net.isIP(host) && refused(host)) return callback(new Error(`blocked ${kind} address ${host}`), null);
            return connect(options, callback);
        },
    });
}

/**
 * Refuses every non-public address: IP literals here (net skips `lookup` for them), host names on every
 * DNS answer, so DNS rebinding can't get past it.
 */
export const publicOnlyAgent = guardedAgent(isBlockedAddress, 'non-public');

/**
 * `base` sending every request to the egress relay at `relayUrl` instead: the target URL in X-Egress-Url, the
 * relay's key as the Bearer token, the gate secret in X-Egress-Gate, the request's own Authorization in
 * X-Egress-Authorization, method and body unchanged. The relay answers with the target's response, a redirect as
 * it is, so fetch relays each hop again, and marks it `x-egress: 1`: an answer without it is the relay's own
 * refusal (a wrong key, a target it won't fetch), which fails like a network error rather than pass as the
 * target's. The relay is the only address this dispatcher connects to.
 */
export function viaEgressRelay(base: Dispatcher, relayUrl: string, key: string, gate: string): Dispatcher {
    const relayAt = new URL(relayUrl);
    return base.compose((dispatch) => (options, handler) => {
        const headers: string[] = [];
        for (const [name, value] of headerEntries(options.headers)) {
            const lower = name.toLowerCase();
            if (lower.startsWith('x-egress-')) continue;
            headers.push(lower === 'authorization' ? 'x-egress-authorization' : name, value);
        }
        headers.push('x-egress-url', targetUrl(String(options.origin), options.path), 'authorization', `Bearer ${key}`, 'x-egress-gate', gate);
        return dispatch({ ...options, origin: relayAt.origin, path: relayAt.pathname + relayAt.search, headers }, relayedOnly(handler));
    });
}

/**
 * The request's URL from its origin and path, by concatenation: `new URL(path, origin)` would take a path
 * starting `//` or `/\` as another host (https://good.example//evil.example/x → https://evil.example/x).
 */
export function targetUrl(origin: string, path: string): string {
    const base = new URL(origin).origin;
    const url = new URL(base + path);
    if (!path.startsWith('/') || url.origin !== base) throw new Error('Refused a request path that changes its host');
    return url.href;
}

/** `handler`, failing a response that didn't come through the relay (no `x-egress: 1`). */
function relayedOnly(handler: Dispatcher.DispatchHandler): Dispatcher.DispatchHandler {
    return {
        onRequestStart: (controller, context) => handler.onRequestStart?.(controller, context),
        onRequestUpgrade: (controller, statusCode, headers, socket) => handler.onRequestUpgrade?.(controller, statusCode, headers, socket),
        onResponseStart(controller, statusCode, headers, statusMessage) {
            if (statusCode >= 200 && headers['x-egress'] !== '1') return controller.abort(new Error(`The egress relay refused the request (${statusCode})`));
            return handler.onResponseStart?.(controller, statusCode, headers, statusMessage);
        },
        onResponseData: (controller, chunk) => handler.onResponseData?.(controller, chunk),
        onResponseEnd: (controller, trailers) => handler.onResponseEnd?.(controller, trailers),
        onResponseError: (controller, error) => handler.onResponseError?.(controller, error),
    };
}

function headerEntries(headers: Dispatcher.DispatchOptions['headers']): [string, string][] {
    if (!headers) return [];
    if (Array.isArray(headers)) {
        const pairs: [string, string][] = [];
        for (let i = 0; i < headers.length; i += 2) pairs.push([headers[i], headers[i + 1]]);
        return pairs;
    }
    const entries = Symbol.iterator in headers ? [...(headers as Iterable<[string, unknown]>)] : Object.entries(headers);
    return entries.flatMap(([name, value]) => (value === undefined ? [] : [value].flat().map((v) => [name, String(v)] as [string, string])));
}

/** Marks the MCP's own upstream API calls (Homebase for Journal), the only ones that may skip the relay. */
const upstreamCalls = new AsyncLocalStorage<true>();
export const asUpstreamCall = <T>(call: () => T): T => upstreamCalls.run(true, call);

/**
 * `fetchImpl` sending an upstream call (asUpstreamCall) direct when its host is one of `hosts` and every address
 * it resolves to is in `allowed`; everything else keeps the global dispatcher, unresolved here, so a host not
 * listed is never looked up on this machine. The direct dispatcher checks each connection's own DNS answer
 * again, so a host that rebinds after this lookup gets no direct connection.
 */
export function withDirectUpstream(fetchImpl: typeof fetch, hosts: Set<string>, allowed: net.BlockList): typeof fetch {
    const direct = guardedAgent((ip) => !inList(allowed, ip), 'non-allowed');
    return async (input, init) => {
        if (!upstreamCalls.getStore()) return fetchImpl(input, init);
        const host = bareHost(new URL(input instanceof Request ? input.url : String(input)).hostname);
        if (!hosts.has(host)) return fetchImpl(input, init);
        const addresses = net.isIP(host) ? [host] : (await dnsLookupAll(host, { all: true }).catch(() => [])).map((entry) => entry.address);
        if (!addresses.length || !addresses.every((ip) => inList(allowed, ip))) return fetchImpl(input, init);
        return fetchImpl(input, { ...init, dispatcher: direct } as RequestInit);
    };
}

/**
 * The relay from MCP_EGRESS_URL, MCP_EGRESS_KEY and MCP_EGRESS_GATE, when all are set, else null (fetch
 * directly, public addresses only). Only some of them, or a relay that isn't https:, stops the server rather
 * than go direct.
 */
function egressRelay(env: NodeJS.ProcessEnv): Dispatcher | null {
    const { MCP_EGRESS_URL: url, MCP_EGRESS_KEY: key, MCP_EGRESS_GATE: gate } = env;
    if (!url && !key && !gate) return null;
    if (!url || !key || !gate || new URL(url).protocol !== 'https:') {
        throw new Error('Set all of MCP_EGRESS_URL (https:), MCP_EGRESS_KEY and MCP_EGRESS_GATE, or none.');
    }
    return viaEgressRelay(publicOnlyAgent, url, key, gate);
}

const relay = egressRelay(process.env);

/** What every outbound request goes through: the egress relay when one is set, else publicOnlyAgent. */
export const outboundAgent: Dispatcher = relay ?? publicOnlyAgent;

const list = (value: string | undefined) => value?.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean) ?? [];

/**
 * Sends every fetch this thread makes through `agent` (Node's fetch uses undici's global dispatcher). The
 * server fetches addresses others hand it: CIMD client ids, the Homebase identity a user types, image URLs, so
 * none of them can make it call into the server or its network, and with a relay none of them learns the
 * server's address. With a relay, upstream calls to a host in MCP_DIRECT_HOSTS (comma-separated host names)
 * that resolves only to addresses in MCP_DIRECT_IPS (comma-separated) go direct.
 */
export function installPublicOnlyFetch(agent = outboundAgent): void {
    setGlobalDispatcher(agent);
    const hosts = list(process.env.MCP_DIRECT_HOSTS);
    const ips = list(process.env.MCP_DIRECT_IPS);
    if (!relay || !hosts.length || !ips.length) return;
    const allowed = new net.BlockList();
    for (const ip of ips) allowed.addAddress(ip, family(ip));
    globalThis.fetch = withDirectUpstream(globalThis.fetch, new Set(hosts), allowed);
}

/** The relay's health check, answered by the relay itself (with `x-egress: 1`) once the key and gate check out. */
export const RELAY_HEALTH_PATH = '/__health';

/**
 * Stops the server unless plain `fetch`, with a URL and with a Request, goes through the relay: asks the relay
 * for its own health check, which only a request carrying the key and gate gets.
 */
export async function assertRelayed(relayUrl: string): Promise<void> {
    const health = new URL(RELAY_HEALTH_PATH, relayUrl).href;
    for (const input of [health, new Request(health)]) {
        const response = await globalThis.fetch(input, { signal: AbortSignal.timeout(10_000) });
        await response.body?.cancel();
        if (!response.ok || response.headers.get('x-egress') !== '1') throw new Error(`The egress relay check failed (${response.status}): fetch doesn't go through the relay.`);
    }
}
