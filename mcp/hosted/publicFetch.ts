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
 * relay's key as the Bearer token, the request's own Authorization in X-Egress-Authorization, method and body
 * unchanged. The relay answers with the target's response, a redirect as it is, so fetch relays each hop again.
 * The relay is the only address this dispatcher connects to.
 */
export function viaEgressRelay(base: Dispatcher, relayUrl: string, key: string): Dispatcher {
    const relayAt = new URL(relayUrl);
    return base.compose((dispatch) => (options, handler) => {
        const headers: string[] = [];
        for (const [name, value] of headerEntries(options.headers)) {
            const lower = name.toLowerCase();
            if (lower.startsWith('x-egress-')) continue;
            headers.push(lower === 'authorization' ? 'x-egress-authorization' : name, value);
        }
        headers.push('x-egress-url', new URL(options.path, options.origin).href, 'authorization', `Bearer ${key}`);
        return dispatch({ ...options, origin: relayAt.origin, path: relayAt.pathname + relayAt.search, headers }, handler);
    });
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
 * `fetchImpl` sending an upstream call (asUpstreamCall) direct when every address its host resolves to is in
 * `allowed`; everything else keeps the global dispatcher. The direct dispatcher checks each connection's own
 * DNS answer again, so a host that rebinds after this lookup gets no direct connection.
 */
export function withDirectUpstream(fetchImpl: typeof fetch, allowed: net.BlockList): typeof fetch {
    const direct = guardedAgent((ip) => !inList(allowed, ip), 'non-allowed');
    return async (input, init) => {
        if (!upstreamCalls.getStore()) return fetchImpl(input, init);
        const host = bareHost(new URL(input instanceof Request ? input.url : String(input)).hostname);
        const addresses = net.isIP(host) ? [host] : (await dnsLookupAll(host, { all: true }).catch(() => [])).map((entry) => entry.address);
        if (!addresses.length || !addresses.every((ip) => inList(allowed, ip))) return fetchImpl(input, init);
        return fetchImpl(input, { ...init, dispatcher: direct } as RequestInit);
    };
}

/**
 * The relay from MCP_EGRESS_URL and MCP_EGRESS_KEY, when both are set, else null (fetch directly, public
 * addresses only). One without the other, or a relay that isn't https:, stops the server rather than go direct.
 */
function egressRelay(env: NodeJS.ProcessEnv): Dispatcher | null {
    const { MCP_EGRESS_URL: url, MCP_EGRESS_KEY: key } = env;
    if (!url && !key) return null;
    if (!url || !key || new URL(url).protocol !== 'https:') throw new Error('Set both MCP_EGRESS_URL (https:) and MCP_EGRESS_KEY, or neither.');
    return viaEgressRelay(publicOnlyAgent, url, key);
}

const relay = egressRelay(process.env);

/** What every outbound request goes through: the egress relay when one is set, else publicOnlyAgent. */
export const outboundAgent: Dispatcher = relay ?? publicOnlyAgent;

/**
 * Sends every fetch this process makes through `outboundAgent` (Node's fetch uses undici's global
 * dispatcher). The server fetches addresses others hand it: CIMD client ids, the Homebase identity a user
 * types, image URLs, so none of them can make it call into the server or its network, and with a relay none
 * of them learns the server's address. With a relay, MCP_DIRECT_IPS (comma-separated addresses) lets upstream
 * calls to a host resolving only to those addresses go direct.
 */
export function installPublicOnlyFetch(): void {
    setGlobalDispatcher(outboundAgent);
    const ips = process.env.MCP_DIRECT_IPS?.split(',').map((ip) => ip.trim()).filter(Boolean) ?? [];
    if (!relay || !ips.length) return;
    const allowed = new net.BlockList();
    for (const ip of ips) allowed.addAddress(ip, family(ip));
    globalThis.fetch = withDirectUpstream(globalThis.fetch, allowed);
}
